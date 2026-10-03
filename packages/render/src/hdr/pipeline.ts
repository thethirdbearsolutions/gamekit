// Linear-HDR pipeline. The scene renders once into a half-float target in
// scene-linear light (three applies no tone mapping or sRGB encoding when
// drawing into a render target, built-in or custom material alike). Bloom is
// added in that same linear space, and only then are exposure, tone mapping
// (AgX / ACES / Neutral) and the sRGB transfer applied, once, in a final pass.
//
// FALLS-49's class of bug comes from breaking that order: tone mapping or
// gamma inside some materials but not others, bloom on already-tone-mapped
// LDR (so everything near white blooms and contrast flattens), or selective
// bloom done by swapping every other material to black, which loses custom
// shaders' uniforms and look. See docs/render/hdr.md.
import * as THREE from 'three';
import { BloomChain, type BloomOptions } from './bloom.js';
import { pass, type FullscreenPass } from './fullscreen.js';

export type ToneMap = 'agx' | 'aces' | 'neutral' | 'linear' | 'none';
export type BloomMode = 'off' | 'threshold' | 'selective' | 'both';

export interface HdrOptions {
  toneMapping?: ToneMap;
  exposure?: number;
  /** MSAA samples for the scene target (default 4; 0 off). */
  samples?: number;
  bloom?: BloomOptions & { mode?: BloomMode; strength?: number; layer?: number };
  /** Render-target pixel ratio (default renderer's). */
  pixelRatio?: number;
  /** Add ±0.5/255 noise before quantising, to hide banding in skies and fog. */
  dither?: boolean;
}

const TONEMAP: Record<ToneMap, string> = {
  agx: 'AgXToneMapping( c )', aces: 'ACESFilmicToneMapping( c )', neutral: 'NeutralToneMapping( c )',
  linear: 'LinearToneMapping( c )', none: 'c * toneMappingExposure',
};

const COMPOSITE = /* glsl */ `
#define toneMappingExposure uExposure
#include <common>
#include <tonemapping_pars_fragment>
uniform sampler2D tScene; uniform sampler2D tBloom; uniform float bloomStrength; uniform bool dither; varying vec2 vUv;
void main() {
  vec3 c = texture2D( tScene, vUv ).rgb + texture2D( tBloom, vUv ).rgb * bloomStrength;
  c = TONEMAP;
  vec4 o = sRGBTransferOETF( vec4( c, 1.0 ) );
  if ( dither ) o.rgb += ( rand( gl_FragCoord.xy ) - 0.5 ) / 255.0;
  gl_FragColor = o;
}`;

export class HdrPipeline {
  toneMapping: ToneMap;
  exposure: number;
  bloomMode: BloomMode;
  bloomStrength: number;
  /** Objects on this layer bloom in 'selective' / 'both' mode (default 10). */
  readonly bloomLayer: number;
  readonly bloom: BloomChain;
  private sceneRT!: THREE.WebGLRenderTarget;
  private bloomSrcRT!: THREE.WebGLRenderTarget;
  private readonly samples: number;
  private composite!: FullscreenPass;
  private compiledFor = '';
  private readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  private readonly black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private readonly size = new THREE.Vector2();
  dither: boolean;
  pixelRatio: number;

  constructor(readonly renderer: THREE.WebGLRenderer, readonly scene: THREE.Scene, public camera: THREE.Camera, opts: HdrOptions = {}) {
    this.toneMapping = opts.toneMapping ?? 'agx';
    this.exposure = opts.exposure ?? 1;
    this.samples = opts.samples ?? 4;
    this.bloomMode = opts.bloom?.mode ?? 'threshold';
    this.bloomStrength = opts.bloom?.strength ?? 0.6;
    this.bloomLayer = opts.bloom?.layer ?? 10;
    this.bloom = new BloomChain(opts.bloom);
    this.dither = opts.dither ?? true;
    this.pixelRatio = opts.pixelRatio ?? renderer.getPixelRatio();
    this.black.needsUpdate = true;
    // The final pass does tone mapping and encoding; the canvas gets it as is.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.getSize(this.size);
    this.setSize(this.size.x, this.size.y);
  }

  /** Make an object (and its children) bloom in selective mode. */
  selectBloom(obj: THREE.Object3D, on = true): void {
    obj.traverse((o) => (on ? o.layers.enable(this.bloomLayer) : o.layers.disable(this.bloomLayer)));
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * this.pixelRatio));
    const h = Math.max(1, Math.round(height * this.pixelRatio));
    this.sceneRT?.dispose();
    this.bloomSrcRT?.dispose();
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true });
    this.bloomSrcRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true });
    this.bloom.setSize(w, h);
  }

  /** The linear HDR scene texture from the last render (for custom passes). */
  get sceneTexture(): THREE.Texture {
    return this.sceneRT.texture;
  }

  /** Render the frame; to the canvas by default, or into `target` (display-
   *  encoded, for captures and tests). */
  render(target: THREE.WebGLRenderTarget | null = null): void {
    const { renderer, scene, camera } = this;
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear();
    renderer.render(scene, camera);
    let bloomTex: THREE.Texture = this.black;
    let bloomTex2: THREE.Texture = this.black;
    if (this.bloomMode !== 'off' && this.bloomStrength > 0) {
      if (this.bloomMode === 'threshold') bloomTex = this.bloom.render(renderer, this.sceneRT.texture, true);
      else {
        this.renderSelected();
        bloomTex = this.bloom.render(renderer, this.bloomSrcRT.texture, false);
        // 'both': the scene's own highlights bloom too, through a second chain.
        if (this.bloomMode === 'both') bloomTex2 = this.highlights().render(renderer, this.sceneRT.texture, true);
      }
    }
    this.compositeTo(target, bloomTex, bloomTex2);
  }

  private bothChain?: BloomChain;
  private highlights(): BloomChain {
    const b = (this.bothChain ??= new BloomChain({ levels: this.bloom.levels }));
    Object.assign(b, { threshold: this.bloom.threshold, knee: this.bloom.knee, radius: this.bloom.radius });
    if (!b.sized(this.sceneRT.width, this.sceneRT.height)) b.setSize(this.sceneRT.width, this.sceneRT.height);
    return b;
  }

  /** Draw only bloom-layer objects, with their own materials, occluded by the
   *  rest of the scene drawn depth-only. */
  private renderSelected(): void {
    const { renderer, scene, camera } = this;
    const mask = camera.layers.mask;
    const bg = scene.background;
    const override = scene.overrideMaterial;
    const shadows = renderer.shadowMap.autoUpdate;
    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    const lights: THREE.Object3D[] = [];
    scene.traverse((o) => { if ((o as THREE.Light).isLight && !o.layers.isEnabled(this.bloomLayer)) { lights.push(o); o.layers.enable(this.bloomLayer); } });
    try {
      renderer.shadowMap.autoUpdate = false;
      scene.background = null;
      renderer.setRenderTarget(this.bloomSrcRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      scene.overrideMaterial = this.depthOnly;
      camera.layers.mask = mask & ~(1 << this.bloomLayer);
      renderer.render(scene, camera);
      scene.overrideMaterial = override;
      camera.layers.mask = 1 << this.bloomLayer;
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = autoClear;
    } finally {
      camera.layers.mask = mask;
      scene.background = bg;
      scene.overrideMaterial = override;
      renderer.shadowMap.autoUpdate = shadows;
      renderer.setClearColor(clearColor, clearAlpha);
      for (const l of lights) l.layers.disable(this.bloomLayer);
    }
  }

  private compositeTo(target: THREE.WebGLRenderTarget | null, bloomTex: THREE.Texture, bloomTex2: THREE.Texture): void {
    const key = `${this.toneMapping}|${this.bloomMode}`;
    if (key !== this.compiledFor) {
      this.composite?.dispose();
      const both = this.bloomMode === 'both';
      const src = COMPOSITE.replace('TONEMAP', TONEMAP[this.toneMapping])
        .replace('uniform float bloomStrength;', `uniform float bloomStrength;${both ? ' uniform sampler2D tBloom2;' : ''}`)
        .replace('texture2D( tBloom, vUv ).rgb * bloomStrength', both ? '( texture2D( tBloom, vUv ).rgb + texture2D( tBloom2, vUv ).rgb ) * bloomStrength' : 'texture2D( tBloom, vUv ).rgb * bloomStrength');
      this.composite = pass(src, { tScene: { value: null }, tBloom: { value: null }, tBloom2: { value: this.black }, bloomStrength: { value: 0 }, uExposure: { value: 1 }, dither: { value: true } });
      this.compiledFor = key;
    }
    const u = this.composite.material.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = bloomTex;
    u.tBloom2.value = bloomTex2;
    u.bloomStrength.value = this.bloomMode === 'off' ? 0 : this.bloomStrength;
    u.uExposure.value = this.exposure;
    u.dither.value = this.dither;
    this.composite.render(this.renderer, target);
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.bloomSrcRT.dispose();
    this.bloom.dispose();
    this.bothChain?.dispose();
    this.composite?.dispose();
    this.depthOnly.dispose();
  }
}
