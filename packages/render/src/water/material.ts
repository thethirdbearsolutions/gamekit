// Water surface material. Merged from the sailing lab's harbor water and
// waterfall-falls' pool; where they differed, the better one won:
//  - swell: the shared WaveSet (Gerstner; steepness 0 is harbor's sine swell),
//    so physics and drawing agree; fades as the water shoals (harbor);
//  - depth from a baked elevation texture (harbor): shallows tint, shore foam
//    and shoaling sit exactly where the ground is (falls faked a radial rim);
//  - ripples: value-noise relief fading with distance (harbor; falls' trig sums
//    tile visibly and shimmer far off);
//  - fresnel toward a reflection colour, Blinn sun glint (both), as real HDR;
//  - fog from three's scene fog (both hand-copied fog settings into uniforms);
//  - hooks for game-specific looks (falls' rainbow plume and fall streaks).
import * as THREE from 'three';
import { FOG_GLSL, modeGlsl, modeUniforms, NOISE_GLSL, OUTPUT_GLSL, fogUniforms, type ColorMode } from '../shading.js';
import { wavesGlsl, waveUniforms, type WaveSet } from './waves.js';

export interface WaterOptions {
  waves: WaveSet;
  /** Ground elevation (elevationTexture()); omit for uniformly deep water. */
  elevation?: { texture: THREE.Texture; bounds: THREE.Vector4 };
  /** Depth assumed where there is no elevation data (m). */
  defaultDepth?: number;
  deep?: THREE.ColorRepresentation;
  mid?: THREE.ColorRepresentation;
  shallow?: THREE.ColorRepresentation;
  /** Depths (m) where shallow→mid starts, mid is reached, deep is reached. */
  depthRamp?: [number, number, number];
  reflect?: THREE.ColorRepresentation;
  fresnel?: { min?: number; max?: number; power?: number };
  sunDirection?: THREE.Vector3;
  sunColor?: THREE.ColorRepresentation;
  glint?: { sharpness?: number; intensity?: number };
  ripples?: { scale?: number; strength?: number; shade?: number; fadeNear?: number; fadeFar?: number };
  foam?: { color?: THREE.ColorRepresentation; amount?: number; depth?: number };
  /** Opacity in the shallows and in the deep. */
  alpha?: [number, number];
  /** Wave shoaling: no waves at `none` m deep, full by `full` m. */
  shoaling?: [number, number];
  colorMode?: ColorMode;
  /** Game-specific GLSL. Define `vec3 waterExtra( vec3 col, vec3 world, vec3 n, vec3 v, float depth )`
   *  (base colour, before fog) and/or `vec3 waterExtraHdr( vec3 world, vec3 n, vec3 v, float depth )`
   *  (added as scene-linear HDR). */
  extra?: { glsl: string; base?: boolean; hdr?: boolean; uniforms?: Record<string, THREE.IUniform> };
}

const VERT = /* glsl */ `
uniform sampler2D uElev; uniform vec4 uElevBounds; uniform float uDefaultDepth; uniform vec2 uShoal;
varying vec3 vWorld; varying vec2 vRest; varying float vShoal; varying float vSurface;
float gkElevation( vec2 xz, float surface ) {
#ifdef USE_ELEVATION
  vec2 uv = ( xz - uElevBounds.xy ) / uElevBounds.zw;
  if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) return surface - uDefaultDepth;
  return textureLod( uElev, uv, 0.0 ).r;
#else
  return surface - uDefaultDepth;
#endif
}
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vRest = w.xz; vSurface = w.y;
  float depth = w.y - gkElevation( w.xz, w.y );
  float u = clamp( ( depth - uShoal.x ) / ( uShoal.y - uShoal.x ), 0.0, 1.0 );
  vShoal = u * u * ( 3.0 - 2.0 * u );
  w.xyz += gkWaveDisplace( w.xz, uWaveTime ) * vShoal;
#ifdef GAMEKIT_BEND
  vBendCut = 0.0;
  w = bendWorld( w );
#endif
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uElev; uniform vec4 uElevBounds; uniform float uDefaultDepth;
uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uShallow; uniform vec3 uDepthRamp; uniform vec3 uReflect;
uniform vec3 uFresnel; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec2 uGlint;
uniform vec4 uRipple; uniform vec2 uRippleFade; uniform vec3 uFoamColor; uniform vec2 uFoam; uniform vec2 uAlpha;
varying vec3 vWorld; varying vec2 vRest; varying float vShoal; varying float vSurface;
float gkRipples( vec2 p, float t ) {
  return gkNoise( p * 0.35 + vec2( t * 0.25, t * 0.11 ) ) * 0.5
       + gkNoise( p * 0.9 - vec2( t * 0.17, -t * 0.31 ) ) * 0.3
       + gkNoise( p * 2.3 + vec2( -t * 0.6, t * 0.4 ) ) * 0.2;
}
void main() {
  float t = uWaveTime;
  float depth = uDefaultDepth;
#ifdef USE_ELEVATION
  vec2 uv = ( vRest - uElevBounds.xy ) / uElevBounds.zw;
  if ( uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0 ) depth = vSurface - texture2D( uElev, uv ).r;
  if ( depth < -0.05 ) discard;
#endif
  vec3 V = normalize( cameraPosition - vWorld );
  float dist = length( cameraPosition - vWorld );
  // Swell normal (fades with shoaling), then ripple relief fading with distance.
  vec3 n = normalize( mix( vec3( 0.0, 1.0, 0.0 ), gkWaveNormal( vRest, t ), vShoal ) );
  vec2 rp = vRest * uRipple.x;
  float e = 0.6;
  float h0 = gkRipples( rp, t );
  float near = 1.0 - smoothstep( uRippleFade.x, uRippleFade.y, dist );
  n = normalize( n + vec3( -( gkRipples( rp + vec2( e, 0.0 ), t ) - h0 ), 0.0, -( gkRipples( rp + vec2( 0.0, e ), t ) - h0 ) ) * uRipple.y * near );

  vec3 base = mix( uShallow, uMid, smoothstep( uDepthRamp.x, uDepthRamp.y, depth ) );
  base = mix( base, uDeep, smoothstep( uDepthRamp.y, uDepthRamp.z, depth ) );
  float f = mix( uFresnel.x, uFresnel.y, pow( 1.0 - max( dot( n, V ), 0.0 ), uFresnel.z ) );
  vec3 col = mix( base, uReflect, f );
  col *= mix( 1.0, 0.88 + 0.24 * mix( 0.5, h0, near ), uRipple.z );
  float foam = ( 1.0 - smoothstep( 0.0, uFoam.y, depth ) ) * smoothstep( 0.45, 0.7, h0 + 0.2 * sin( t * 1.3 + depth * 14.0 ) );
  col = mix( col, uFoamColor, foam * uFoam.x );
#ifdef WATER_EXTRA
  col = waterExtra( col, vWorld, n, V, depth );
#endif
  float fog = gkFogFactor( dist );
  vec3 glint = uSunColor * pow( max( dot( n, normalize( V + uSunDir ) ), 0.0 ), uGlint.x ) * uGlint.y;
  vec3 hdr = vec3( 0.0 );
#ifdef WATER_EXTRA_HDR
  hdr += waterExtraHdr( vWorld, n, V, depth );
#endif
  float alpha = max( mix( uAlpha.x, uAlpha.y, smoothstep( 0.2, 7.0, depth ) ), foam * 0.9 * uFoam.x );
#ifdef GK_DISPLAY_MODE
  // As the display-tuned original: the glint clips to its hue, the overflow blooms.
  vec3 outCol = toSceneHdr( mix( col + glint, gkFogColorDisplay(), fog ) );
#else
  vec3 outCol = mix( col, fogColor, fog ) + glint * ( 1.0 - fog );
#endif
  gl_FragColor = vec4( outCol + hdr * ( 1.0 - fog ), mix( alpha, 1.0, fog ) );
  ${OUTPUT_GLSL}
}`;

export function createWaterMaterial(o: WaterOptions): THREE.ShaderMaterial {
  const c = (v: THREE.ColorRepresentation | undefined, d: THREE.ColorRepresentation) => new THREE.Color(v ?? d);
  const deep = c(o.deep, 0x1b5578);
  const ramp = o.depthRamp ?? [0.3, 4, 16];
  const fr = o.fresnel ?? {};
  const rp = o.ripples ?? {};
  const fm = o.foam ?? {};
  const defines: Record<string, string> = {};
  if (o.elevation) defines.USE_ELEVATION = '';
  if (o.extra?.base) defines.WATER_EXTRA = '';
  if (o.extra?.hdr) defines.WATER_EXTRA_HDR = '';
  const wu = waveUniforms(o.waves);
  return new THREE.ShaderMaterial({
    name: 'gamekit.water',
    transparent: true,
    depthWrite: false,
    fog: true,
    defines,
    uniforms: {
      ...fogUniforms(),
      ...wu,
      ...(o.extra?.uniforms ?? {}),
      ...modeUniforms(),
      uElev: { value: o.elevation?.texture ?? null },
      uElevBounds: { value: o.elevation?.bounds ?? new THREE.Vector4(0, 0, 1, 1) },
      uDefaultDepth: { value: o.defaultDepth ?? 30 },
      uShoal: { value: new THREE.Vector2(...(o.shoaling ?? [0.5, 6])) },
      uDeep: { value: deep },
      uMid: { value: c(o.mid, o.deep ?? 0x2a8aa6) },
      uShallow: { value: c(o.shallow, o.mid ?? o.deep ?? 0x63d2c6) },
      uDepthRamp: { value: new THREE.Vector3(...ramp) },
      uReflect: { value: c(o.reflect, 0xcfe9f5) },
      uFresnel: { value: new THREE.Vector3(fr.min ?? 0.02, fr.max ?? 0.6, fr.power ?? 3) },
      uSunDir: { value: (o.sunDirection ?? new THREE.Vector3(0.3, 0.6, -0.7)).clone().normalize() },
      uSunColor: { value: c(o.sunColor, 0xfff2d9) },
      uGlint: { value: new THREE.Vector2(o.glint?.sharpness ?? 200, o.glint?.intensity ?? 4) },
      uRipple: { value: new THREE.Vector4(rp.scale ?? 1, rp.strength ?? 1.6, rp.shade ?? 1, 0) },
      uRippleFade: { value: new THREE.Vector2(rp.fadeNear ?? 120, rp.fadeFar ?? 700) },
      uFoamColor: { value: c(fm.color, 0xf6f9ff) },
      uFoam: { value: new THREE.Vector2(fm.amount ?? 0.7, fm.depth ?? 0.35) },
      uAlpha: { value: new THREE.Vector2(...(o.alpha ?? [0.38, 0.9])) },
    },
    vertexShader: wavesGlsl() + VERT,
    fragmentShader: [modeGlsl(o.colorMode ?? 'linear'), wavesGlsl(), NOISE_GLSL, FOG_GLSL, o.extra?.glsl ?? '', FRAG].join('\n'),
  });
}
