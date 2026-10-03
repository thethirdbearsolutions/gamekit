// Bloom in linear HDR: a dual-filter mip chain (13-tap downsample, 3×3 tent
// upsample, as in Jimenez's "Next Generation Post Processing in Call of Duty")
// over a source that is either the bright part of the scene (soft-knee
// threshold on true HDR values) or only the objects you select, drawn with
// their own materials. Nothing here touches scene materials, so custom
// shaders keep their look.
import * as THREE from 'three';
import { pass, type FullscreenPass } from './fullscreen.js';

const PREFILTER = /* glsl */ `
uniform sampler2D tSrc; uniform float threshold; uniform float knee; varying vec2 vUv;
void main() {
  vec3 c = texture2D( tSrc, vUv ).rgb;
  float br = max( c.r, max( c.g, c.b ) );
  float soft = clamp( br - threshold + knee, 0.0, 2.0 * knee );
  soft = soft * soft / ( 4.0 * knee + 1e-5 );
  float w = max( soft, br - threshold ) / max( br, 1e-5 );
  // Clamp fireflies so a single hot pixel can't flood the chain.
  gl_FragColor = vec4( min( c * w, vec3( 64.0 ) ), 1.0 );
}`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
vec3 s( vec2 o ) { return texture2D( tSrc, vUv + o * texel ).rgb; }
void main() {
  vec3 a = s( vec2( -2, 2 ) ), b = s( vec2( 0, 2 ) ), c = s( vec2( 2, 2 ) );
  vec3 d = s( vec2( -2, 0 ) ), e = s( vec2( 0, 0 ) ), f = s( vec2( 2, 0 ) );
  vec3 g = s( vec2( -2, -2 ) ), h = s( vec2( 0, -2 ) ), i = s( vec2( 2, -2 ) );
  vec3 j = s( vec2( -1, 1 ) ), k = s( vec2( 1, 1 ) ), l = s( vec2( -1, -1 ) ), m = s( vec2( 1, -1 ) );
  vec3 col = e * 0.125 + ( a + c + g + i ) * 0.03125 + ( b + d + f + h ) * 0.0625 + ( j + k + l + m ) * 0.125;
  gl_FragColor = vec4( col, 1.0 );
}`;

const UP = /* glsl */ `
uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 texel; uniform float radius; varying vec2 vUv;
vec3 s( vec2 o ) { return texture2D( tSrc, vUv + o * texel * radius ).rgb; }
void main() {
  vec3 col = s( vec2( 0 ) ) * 4.0 + ( s( vec2( -1, 0 ) ) + s( vec2( 1, 0 ) ) + s( vec2( 0, -1 ) ) + s( vec2( 0, 1 ) ) ) * 2.0
    + s( vec2( -1, -1 ) ) + s( vec2( 1, -1 ) ) + s( vec2( -1, 1 ) ) + s( vec2( 1, 1 ) );
  gl_FragColor = vec4( texture2D( tBase, vUv ).rgb + col / 16.0, 1.0 );
}`;

export interface BloomOptions {
  /** Mip levels (default 6). */
  levels?: number;
  /** Scene-linear brightness (before exposure) where threshold bloom starts (default 1). */
  threshold?: number;
  knee?: number;
  /** Upsample spread (default 1). */
  radius?: number;
}

const rt = (w: number, h: number) => new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
});

export class BloomChain {
  readonly levels: number;
  threshold: number;
  knee: number;
  radius: number;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private readonly prefilter: FullscreenPass;
  private readonly downPass: FullscreenPass;
  private readonly upPass: FullscreenPass;

  constructor(opts: BloomOptions = {}) {
    this.levels = opts.levels ?? 6;
    this.threshold = opts.threshold ?? 1;
    this.knee = opts.knee ?? 0.5;
    this.radius = opts.radius ?? 1;
    this.prefilter = pass(PREFILTER, { tSrc: { value: null }, threshold: { value: 1 }, knee: { value: 0.5 } });
    this.downPass = pass(DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
    this.upPass = pass(UP, { tSrc: { value: null }, tBase: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1 } });
  }

  sized(width: number, height: number): boolean {
    return this.down[0]?.width === Math.max(1, width >> 1) && this.down[0]?.height === Math.max(1, height >> 1);
  }

  setSize(width: number, height: number): void {
    this.dispose(false);
    let w = Math.max(1, width >> 1), h = Math.max(1, height >> 1);
    for (let i = 0; i < this.levels; i++) {
      this.down.push(rt(w, h));
      this.up.push(rt(w, h));
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
  }

  /** Blur `source` (linear HDR); returns the half-res bloom texture.
   *  `thresholded` false skips the bright-pass (selective sources). */
  render(renderer: THREE.WebGLRenderer, source: THREE.Texture, thresholded: boolean): THREE.Texture {
    const u = this.prefilter.material.uniforms;
    u.tSrc.value = source;
    u.threshold.value = thresholded ? this.threshold : 0;
    u.knee.value = thresholded ? this.knee : 0;
    this.prefilter.render(renderer, this.down[0]);
    const d = this.downPass.material.uniforms;
    for (let i = 1; i < this.levels; i++) {
      d.tSrc.value = this.down[i - 1].texture;
      d.texel.value.set(1 / this.down[i - 1].width, 1 / this.down[i - 1].height);
      this.downPass.render(renderer, this.down[i]);
    }
    const up = this.upPass.material.uniforms;
    up.radius.value = this.radius;
    let src = this.down[this.levels - 1].texture;
    for (let i = this.levels - 2; i >= 0; i--) {
      up.tSrc.value = src;
      up.tBase.value = this.down[i].texture;
      up.texel.value.set(1 / this.down[i + 1].width, 1 / this.down[i + 1].height);
      this.upPass.render(renderer, this.up[i]);
      src = this.up[i].texture;
    }
    return src;
  }

  dispose(passes = true): void {
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.down = [];
    this.up = [];
    if (passes) for (const p of [this.prefilter, this.downPass, this.upPass]) p.dispose();
  }
}
