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
import { displayFogInstalled } from './display-fog.js';
import { pass, type FullscreenPass } from './fullscreen.js';
import { DisplayOverlay, type OverlayOptions } from './overlay.js';

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
  /** Display-space pass for content made for three's direct path (see
   *  overlay.ts). `{ transparent: true }` sends every transparent material. */
  display?: OverlayOptions;
}

const TONEMAP: Record<ToneMap, string> = {
  agx: 'AgXToneMapping( c )', aces: 'ACESFilmicToneMapping( c )', neutral: 'NeutralToneMapping( c )',
  linear: 'LinearToneMapping( c )', none: 'c * toneMappingExposure',
};

const THREE_TONEMAP: Record<ToneMap, THREE.ToneMapping> = {
  agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping,
  linear: THREE.LinearToneMapping, none: THREE.NoToneMapping,
};

const COMPOSITE = /* glsl */ `
#define toneMappingExposure uExposure
#include <common>
#include <tonemapping_pars_fragment>
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tBloom2; uniform float bloomStrength; uniform bool dither; varying vec2 vUv;
void main() {
  vec3 c = texture2D( tScene, vUv ).rgb + ( texture2D( tBloom, vUv ).rgb + texture2D( tBloom2, vUv ).rgb ) * bloomStrength;
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
  /** Display-space pass, when enabled with the `display` option. */
  readonly overlay: DisplayOverlay | null;
  /** False when this device can't render to half-float targets; render()
   *  then falls back to three's direct path with the same tone mapping. */
  readonly supported: boolean;
  dither: boolean;
  pixelRatio: number;
  private sceneRT!: THREE.WebGLRenderTarget;
  private srcRT: THREE.WebGLRenderTarget | null = null;
  private second?: BloomChain;
  private readonly samples: number;
  private composite!: FullscreenPass;
  private compiledFor = '';
  private readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  private readonly black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private readonly size = new THREE.Vector2();
  private warned = false;

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
    this.overlay = opts.display ? new DisplayOverlay(opts.display) : null;
    this.black.needsUpdate = true;
    const ext = renderer.extensions;
    this.supported = renderer.capabilities.isWebGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    // The final pass does tone mapping and encoding; the canvas gets it as is.
    if (this.supported) renderer.toneMapping = THREE.NoToneMapping;
    renderer.getSize(this.size);
    this.setSize(this.size.x, this.size.y);
  }

  /** Make an object (and its children) bloom (selective/both; and display-
   *  pass objects through their gkOverlayOut glow in any mode). */
  selectBloom(obj: THREE.Object3D, on = true): void {
    obj.traverse((o) => (on ? o.layers.enable(this.bloomLayer) : o.layers.disable(this.bloomLayer)));
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * this.pixelRatio));
    const h = Math.max(1, Math.round(height * this.pixelRatio));
    if (this.sceneRT && this.sceneRT.width === w && this.sceneRT.height === h) return;
    this.sceneRT?.dispose();
    this.srcRT?.dispose();
    this.srcRT = null; // allocated on first use: only selective bloom and display-pass glow need it
    if (!this.supported) return;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true });
    this.bloom.setSize(w, h);
    if (this.second) this.second.setSize(w, h);
  }

  /** The linear HDR scene texture from the last render (for custom passes). */
  get sceneTexture(): THREE.Texture {
    return this.sceneRT.texture;
  }

  /** Render the frame; to the canvas by default, or into `target` (display-
   *  encoded, for captures and tests). */
  render(target: THREE.WebGLRenderTarget | null = null): void {
    const { renderer, scene, camera, overlay } = this;
    if (!this.supported) return this.renderDirect(target);
    if (!this.warned && displayFogInstalled() && this.toneMapping !== 'aces') {
      this.warned = true;
      console.warn('[gamekit/render] installDisplayFog reproduces three\'s ACES path; this pipeline uses ' + this.toneMapping);
    }
    overlay?.partition(scene);
    renderer.toneMappingExposure = this.exposure; // read by installDisplayFog's chunk
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear();
    if (overlay) overlay.withoutItems(() => renderer.render(scene, camera));
    else renderer.render(scene, camera);

    let a: THREE.Texture = this.black;
    let b: THREE.Texture = this.black;
    if (this.bloomMode !== 'off' && this.bloomStrength > 0) {
      const glow = !!overlay && overlay.glowing(this.bloomLayer).length > 0;
      const selected = this.bloomMode !== 'threshold' || glow;
      if (selected) this.renderSelected();
      if (this.bloomMode === 'threshold') {
        a = this.bloom.render(renderer, this.sceneRT.texture, true);
        if (glow) b = this.secondChain().render(renderer, this.srcRT!.texture, false);
      } else {
        a = this.bloom.render(renderer, this.srcRT!.texture, false);
        if (this.bloomMode === 'both') b = this.secondChain().render(renderer, this.sceneRT.texture, true);
      }
    }
    this.compositeTo(target, a, b);
    if (overlay?.active) overlay.draw(renderer, scene, camera, target, this.exposure);
  }

  /** No half-float targets: three's own tone mapping, straight to the output. */
  private renderDirect(target: THREE.WebGLRenderTarget | null): void {
    const r = this.renderer;
    r.toneMapping = THREE_TONEMAP[this.toneMapping];
    r.toneMappingExposure = this.exposure;
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
  }

  private secondChain(): BloomChain {
    const b = (this.second ??= new BloomChain({ levels: this.bloom.levels }));
    Object.assign(b, { threshold: this.bloom.threshold, knee: this.bloom.knee, radius: this.bloom.radius });
    if (!b.sized(this.sceneRT.width, this.sceneRT.height)) b.setSize(this.sceneRT.width, this.sceneRT.height);
    return b;
  }

  /** Bloom source: bloom-layer objects with their own materials (display-pass
   *  ones emitting their gkOverlayOut glow), occluded by the rest of the
   *  scene drawn depth-only. Nothing is swapped, so custom shaders keep their look. */
  private renderSelected(): void {
    const { renderer, scene, camera, overlay } = this;
    this.srcRT ??= new THREE.WebGLRenderTarget(this.sceneRT.width, this.sceneRT.height, { type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true });
    const mask = camera.layers.mask;
    const bg = scene.background;
    const override = scene.overrideMaterial;
    const shadows = renderer.shadowMap.autoUpdate;
    const autoClear = renderer.autoClear;
    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    const lights: THREE.Object3D[] = [];
    scene.traverse((o) => { if ((o as THREE.Light).isLight && !o.layers.isEnabled(this.bloomLayer)) { lights.push(o); o.layers.enable(this.bloomLayer); } });
    try {
      renderer.shadowMap.autoUpdate = false;
      scene.background = null;
      renderer.setRenderTarget(this.srcRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      scene.overrideMaterial = this.depthOnly;
      camera.layers.mask = mask & ~(1 << this.bloomLayer);
      if (overlay) overlay.withoutItems(() => renderer.render(scene, camera));
      else renderer.render(scene, camera);
      scene.overrideMaterial = override;
      camera.layers.mask = 1 << this.bloomLayer;
      renderer.autoClear = false;
      if (overlay) overlay.renderGlow(renderer, scene, camera, this.bloomLayer, true);
      else renderer.render(scene, camera);
    } finally {
      camera.layers.mask = mask;
      scene.background = bg;
      scene.overrideMaterial = override;
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = shadows;
      renderer.setClearColor(clearColor, clearAlpha);
      for (const l of lights) l.layers.disable(this.bloomLayer);
    }
  }

  private compositeTo(target: THREE.WebGLRenderTarget | null, a: THREE.Texture, b: THREE.Texture): void {
    if (this.toneMapping !== this.compiledFor) {
      this.composite?.dispose();
      this.composite = pass(COMPOSITE.replace('TONEMAP', TONEMAP[this.toneMapping]), {
        tScene: { value: null }, tBloom: { value: null }, tBloom2: { value: null }, bloomStrength: { value: 0 }, uExposure: { value: 1 }, dither: { value: true },
      });
      this.compiledFor = this.toneMapping;
    }
    const u = this.composite.material.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = a;
    u.tBloom2.value = b;
    u.bloomStrength.value = this.bloomMode === 'off' ? 0 : this.bloomStrength;
    u.uExposure.value = this.exposure;
    u.dither.value = this.dither;
    this.composite.render(this.renderer, target);
  }

  dispose(): void {
    this.sceneRT?.dispose();
    this.srcRT?.dispose();
    this.bloom.dispose();
    this.second?.dispose();
    this.composite?.dispose();
    this.depthOnly.dispose();
    this.overlay?.dispose();
  }
}
