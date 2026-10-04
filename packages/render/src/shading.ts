// Small GLSL pieces shared by the sky and water materials.
import * as THREE from 'three';
import { displayToSceneGlsl } from './hdr/display.js';

/** 'linear': colours are scene-linear (the default; what new shaders should do).
 *  'display': colours were tuned as display values for a raw shader drawn
 *  straight to the canvas (no tone mapping, no sRGB encoding: waterfall-falls);
 *  the base result is converted with gkDisplayToScene so the look survives
 *  the HDR pipeline unchanged.
 *  'untonemapped': linear colours from a shader that sRGB-encoded but never
 *  tone mapped (it had colorspace_fragment but not tonemapping_fragment: the
 *  sailing lab); same idea, encoded first. */
export type ColorMode = 'linear' | 'display' | 'untonemapped';

export const NOISE_GLSL = /* glsl */ `
float gkHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float gkNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gkHash( i ), gkHash( i + vec2( 1, 0 ) ), u.x ), mix( gkHash( i + vec2( 0, 1 ) ), gkHash( i + vec2( 1, 1 ) ), u.x ), u.y );
}`;

/** Fog factor by distance using three's own fog uniforms (Fog or FogExp2),
 *  so custom materials match the scene fog without copying its settings. */
export const FOG_GLSL = /* glsl */ `
#ifdef USE_FOG
uniform vec3 fogColor;
#ifdef FOG_EXP2
uniform float fogDensity;
float gkFogFactor( float d ) { return 1.0 - exp( - fogDensity * fogDensity * d * d ); }
#else
uniform float fogNear; uniform float fogFar;
float gkFogFactor( float d ) { return smoothstep( fogNear, fogFar, d ); }
#endif
#else
const vec3 fogColor = vec3( 0.0 );
float gkFogFactor( float d ) { return 0.0; }
#endif
// The fog colour as three's direct path saw it: sRGB-encoded on the canvas
// (TONE_MAPPING defined), linear in a render target (encode it here), so
// display-mode materials fog the same in and out of the pipeline.
vec3 gkFogColorDisplay() {
#ifdef TONE_MAPPING
  return fogColor;
#else
  vec3 c = max( fogColor, 0.0 );
  return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
#endif
}`;

/** Header for a fragment shader in either colour mode. `toScene(c)` converts
 *  the base colour; HDR terms are added after it. */
export function modeGlsl(mode: ColorMode): string {
  if (mode === 'linear') return '#define toScene( c ) ( c )\n#define toSceneHdr( c ) ( c )\n';
  const enc = mode === 'untonemapped'
    ? 'vec3 gkEncode( vec3 c ) { c = max( c, 0.0 ); return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) ); }\n'
    : '#define gkEncode( c ) ( c )\n';
  return `${displayToSceneGlsl()}\nuniform float gkHdrGain;\n${enc}#define GK_DISPLAY_MODE\n` +
    '#define toScene( c ) gkDisplayToScene( gkEncode( c ) )\n#define toSceneHdr( c ) gkDisplayToSceneHdr( gkEncode( c ), gkHdrGain )\n';
}

/** Uniforms every mode-aware material carries. In 'display' mode highlights
 *  are added in display space as the original shader did (so they keep
 *  their clipped, saturated hue) and only what passes 1.0 becomes HDR,
 *  scaled by gkHdrGain. */
export const modeUniforms = (exposure = 1, hdrGain = 1.5) => ({ gkExposure: { value: exposure }, gkHdrGain: { value: hdrGain } });

/** Ends a fragment shader so it also renders right without the pipeline. */
export const OUTPUT_GLSL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

export const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
