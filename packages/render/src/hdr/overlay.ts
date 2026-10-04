// Display-space pass. Some content was made for three's direct path: raw
// shaders tuned as display colours (neon rainbows that bypass tone mapping)
// and translucent effects blended on screen. In a linear-HDR pipeline it
// cannot look the same: ACES can't produce saturated primaries above ~65%
// brightness, and blending in light makes thin veils read as solid.
//
// So it doesn't go through the HDR pass. After tone mapping, the pipeline
// fills the depth buffer with the opaque scene and draws these objects on
// top through three's own direct path (its tone mapping, its sRGB, its fog,
// its blending, its transparent sorting): exactly how they looked before.
// They can still feed bloom: shaders that use gkOverlayOut() emit a glow
// colour when the pipeline renders its bloom source.
import * as THREE from 'three';

/** Shared uniform: 1 while the pipeline renders overlay objects into the
 *  bloom source, 0 when drawing them for real. */
export const overlayPass = { value: 0 };

/** GLSL for display-pass shaders: end with
 *  `gl_FragColor = gkOverlayOut( col, alpha, glow );` where `glow` is the
 *  scene-linear light this object adds to bloom (vec3( 0.0 ) for none). */
export const OVERLAY_GLSL = /* glsl */ `
uniform float gkOverlayPass;
#define gkOverlayOut( col, a, glow ) ( gkOverlayPass > 0.5 ? vec4( glow, a ) : vec4( col, a ) )
`;

export const overlayUniforms = () => ({ gkOverlayPass: overlayPass });

type Renderable = THREE.Object3D & { material?: THREE.Material | THREE.Material[] };

export interface OverlayOptions {
  /** Objects on this layer always go to the display pass (default 11). */
  layer?: number;
  /** Also send every transparent material there (default false). */
  transparent?: boolean;
  /** three's tone mapping for the display pass (what the content was made for). */
  toneMapping?: THREE.ToneMapping;
}

export class DisplayOverlay {
  readonly layer: number;
  transparent: boolean;
  toneMapping: THREE.ToneMapping;
  /** Display-pass objects found by the last partition(). */
  readonly items: Renderable[] = [];
  /** Opaque scene objects (depth pre-pass). */
  private readonly rest: Renderable[] = [];
  /** Transparent objects that stay in the HDR pass (hidden from the depth pass). */
  private readonly skip: Renderable[] = [];
  private readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });

  constructor(o: OverlayOptions = {}) {
    this.layer = o.layer ?? 11;
    this.transparent = o.transparent ?? false;
    this.toneMapping = o.toneMapping ?? THREE.ACESFilmicToneMapping;
  }

  /** Put an object (and its children) in the display pass. */
  add(obj: THREE.Object3D, on = true): void {
    obj.traverse((o) => (on ? o.layers.enable(this.layer) : o.layers.disable(this.layer)));
  }

  /** Sort visible renderables into display-pass and the rest. */
  partition(scene: THREE.Object3D): void {
    this.items.length = 0;
    this.rest.length = 0;
    this.skip.length = 0;
    scene.traverseVisible((o) => {
      const r = o as Renderable;
      if (!r.material || (o as THREE.Light).isLight) return;
      const mats = [r.material].flat();
      const display = o.layers.isEnabled(this.layer) || (this.transparent && mats.some((m) => m.transparent));
      (display ? this.items : mats.some((m) => m.transparent) ? this.skip : this.rest).push(r);
    });
  }

  get active(): boolean {
    return this.items.length > 0;
  }

  /** Run `f` with only `show` visible among the partitioned renderables. */
  private only(show: Renderable[], f: () => void): void {
    const keep = new Set(show);
    const hidden: Renderable[] = [];
    for (const list of [this.items, this.rest, this.skip]) for (const o of list) if (!keep.has(o)) { o.visible = false; hidden.push(o); }
    try { f(); } finally { for (const o of hidden) o.visible = true; }
  }

  /** Hide display-pass objects while `f` renders the HDR scene. */
  withoutItems(f: () => void): void {
    for (const o of this.items) o.visible = false;
    try { f(); } finally { for (const o of this.items) o.visible = true; }
  }

  /** Render display-pass objects into the current target as bloom sources:
   *  only those on `bloomLayer`, emitting their gkOverlayOut glow. */
  renderGlow(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, bloomLayer: number, withSelected = false): void {
    overlayPass.value = 1;
    try {
      // The camera's layer mask already narrows to bloom-layer objects; with
      // `withSelected`, ordinary selected objects draw too (their own colour).
      if (withSelected) renderer.render(scene, camera);
      else this.only(this.glowing(bloomLayer), () => renderer.render(scene, camera));
    } finally {
      overlayPass.value = 0;
    }
  }

  glowing(bloomLayer: number): Renderable[] {
    return this.items.filter((o) => o.layers.isEnabled(bloomLayer));
  }

  /** After the tone-mapped composite: opaque depth, then the display pass
   *  through three's direct path. `target` null is the canvas (exact;
   *  three only tone maps built-in materials there). */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null, exposure: number): void {
    const bg = scene.background;
    const override = scene.overrideMaterial;
    const autoClear = renderer.autoClear;
    const shadows = renderer.shadowMap.autoUpdate;
    const tm = renderer.toneMapping;
    const tmx = renderer.toneMappingExposure;
    try {
      scene.background = null;
      renderer.autoClear = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(target);
      renderer.clearDepth();
      scene.overrideMaterial = this.depthOnly;
      this.only(this.rest, () => renderer.render(scene, camera));
      scene.overrideMaterial = override;
      renderer.toneMapping = this.toneMapping;
      renderer.toneMappingExposure = exposure;
      this.only(this.items, () => renderer.render(scene, camera));
    } finally {
      scene.background = bg;
      scene.overrideMaterial = override;
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = shadows;
      renderer.toneMapping = tm;
      renderer.toneMappingExposure = tmx;
    }
  }

  dispose(): void {
    this.depthOnly.dispose();
  }
}
