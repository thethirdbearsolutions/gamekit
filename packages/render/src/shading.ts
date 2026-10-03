// Small GLSL pieces shared by the sky and water materials.
import * as THREE from 'three';
import { displayToSceneGlsl } from './hdr/display.js';

/** 'linear': colours are scene-linear (the default; what new shaders should do).
 *  'display': colours were tuned as display values for a raw shader drawn
 *  straight to the canvas; the base result is converted with
 *  gkDisplayToScene so the look survives the HDR pipeline unchanged. */
export type ColorMode = 'linear' | 'display';

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
#endif`;

/** Header for a fragment shader in either colour mode. `toScene(c)` converts
 *  the base colour; HDR terms are added after it. */
export function modeGlsl(mode: ColorMode): string {
  return mode === 'display' ? `${displayToSceneGlsl()}\n#define toScene( c ) gkDisplayToScene( c )\n` : '#define toScene( c ) ( c )\n';
}

/** Ends a fragment shader so it also renders right without the pipeline. */
export const OUTPUT_GLSL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

export const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
