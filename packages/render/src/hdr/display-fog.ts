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
import { displayToSceneGlsl } from './display.js';

const ACES_FORWARD = /* glsl */ `
vec3 gkSceneToDisplay( vec3 c ) {
  const mat3 IN = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 OUT = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  c = IN * ( c * gkExposure / 0.6 );
  c = ( c * ( c + 0.0245786 ) - 0.000090537 ) / ( c * ( 0.983729 * c + 0.4329510 ) + 0.238081 );
  c = clamp( OUT * c, 0.0, 1.0 );
  return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
}`;

let installed: { exposure: number } | null = null;

/** Patch three's fog chunks once, before materials compile. `exposure` must
 *  match the pipeline's (ACES only, as in three's direct path). */
export function installDisplayFog(exposure = 1): void {
  if (installed) { installed.exposure = exposure; return; }
  installed = { exposure };
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  const pars = displayToSceneGlsl().replace('uniform float gkExposure;', `#ifndef GK_EXPOSURE_DECLARED\n#define GK_EXPOSURE_DECLARED\nconst float gkExposure = ${exposure.toFixed(6)};\n#endif`);
  chunks.fog_pars_fragment = chunks.fog_pars_fragment.replace('#ifdef USE_FOG', `#if defined( USE_FOG ) && ! defined( TONE_MAPPING )\n${pars}\n${ACES_FORWARD}\n#endif\n#ifdef USE_FOG`);
  const find = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );';
  if (!chunks.fog_fragment.includes(find)) {
    console.warn('[gamekit/render] three changed fog_fragment; installDisplayFog skipped');
    return;
  }
  chunks.fog_fragment = chunks.fog_fragment.replace(find, `#ifdef TONE_MAPPING
	${find}
#else
	// three hands fogColor over sRGB-encoded for the canvas, linear for targets.
	if ( fogFactor > 0.0 ) gl_FragColor.rgb = gkDisplayToScene( mix( gkSceneToDisplay( gl_FragColor.rgb ), sRGBTransferOETF( vec4( fogColor, 1.0 ) ).rgb, fogFactor ) );
#endif`);
}
