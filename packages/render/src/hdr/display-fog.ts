// three applies fog AFTER tone mapping and sRGB encoding when it draws to the
// canvas (fog_fragment comes last in every built-in shader), so fog colours
// and the fog blend are effectively display-referred. In a linear-HDR
// pipeline the same chunk runs before tone mapping, the blend happens in
// linear light, and everything in the distance turns hazier and lighter.
//
// installDisplayFog() makes built-in materials fog the way three's direct
// path does whenever they draw without tone mapping (i.e. into the
// pipeline's target): encode to display, blend with the fog colour, convert
// back to scene-linear. Games that move onto HdrPipeline keep their fog;
// new content can skip this and author fog in linear.
import * as THREE from 'three';
import { ACES_INV_GLSL } from './display.js';

// Own names (gkFog*) so a material that also includes displayToSceneGlsl()
// never sees a symbol twice. Exposure comes from three's own
// toneMappingExposure uniform, which HdrPipeline keeps equal to its exposure.
const FOG_PARS = /* glsl */ `
uniform float toneMappingExposure;
const mat3 GK_FOG_IN = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
const mat3 GK_FOG_OUT = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
vec3 gkFogOetf( vec3 c ) { return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) ); }
vec3 gkFogToDisplay( vec3 c ) {
  c = GK_FOG_IN * ( c * toneMappingExposure / 0.6 );
  c = ( c * ( c + 0.0245786 ) - 0.000090537 ) / ( c * ( 0.983729 * c + 0.4329510 ) + 0.238081 );
  return gkFogOetf( clamp( GK_FOG_OUT * c, 0.0, 1.0 ) );
}
vec3 gkFogToScene( vec3 d ) {
  vec3 c = clamp( d, 0.0, 0.985 );
  c = mix( pow( c * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), c * 0.0773993808, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
  vec3 y = clamp( ${ACES_INV_GLSL.out} * c, 0.0, 0.985 );
  vec3 A = 0.983729 * y - 1.0, B = 0.432951 * y - 0.0245786, C = 0.238081 * y + 0.000090537;
  vec3 v = ( -B - sqrt( B * B - 4.0 * A * C ) ) / ( 2.0 * A );
  return max( ${ACES_INV_GLSL.in} * v, 0.0 ) * 0.6 / toneMappingExposure;
}`;

let installed = false;

/** Whether installDisplayFog() has run (HdrPipeline warns if it isn't ACES). */
export const displayFogInstalled = () => installed;

/** Patch three's fog chunks once, before materials compile. Valid with ACES
 *  (what three's direct path used); exposure follows the pipeline. Fogged
 *  surfaces are near-neutral, so the inverse's gamut limit doesn't bite. */
export function installDisplayFog(): void {
  if (installed) return;
  installed = true;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  const find = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );';
  if (!chunks.fog_fragment.includes(find) || !chunks.fog_pars_fragment.includes('#ifdef USE_FOG')) {
    console.warn('[gamekit/render] three changed its fog chunks; installDisplayFog skipped (fog will blend in linear)');
    return;
  }
  chunks.fog_pars_fragment = chunks.fog_pars_fragment.replace('#ifdef USE_FOG', `#if defined( USE_FOG ) && ! defined( TONE_MAPPING )\n${FOG_PARS}\n#endif\n#ifdef USE_FOG`);
  chunks.fog_fragment = chunks.fog_fragment.replace(find, `#ifdef TONE_MAPPING
	${find}
#else
	// three hands fogColor over sRGB-encoded for the canvas, linear for targets.
	if ( fogFactor > 0.0 ) gl_FragColor.rgb = gkFogToScene( mix( gkFogToDisplay( gl_FragColor.rgb ), gkFogOetf( max( fogColor, 0.0 ) ), fogFactor ) );
#endif`);
}
