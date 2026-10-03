// Sky dome: horizon-to-zenith gradient, a sun disc and glow, and an aerial-
// perspective lift at the horizon. Merged from the sailing lab's sky and
// waterfall-falls' (they were nearly line-for-line the same; falls added the
// horizon haze, harbor drew at the far plane so it never clips). The sun disc
// is real HDR, so it blooms; the gradient can be authored linear or display.
import * as THREE from 'three';
import { modeGlsl, OUTPUT_GLSL, type ColorMode } from '../shading.js';

export interface SkyOptions {
  zenith?: THREE.ColorRepresentation;
  horizon?: THREE.ColorRepresentation;
  sunColor?: THREE.ColorRepresentation;
  sunDirection?: THREE.Vector3;
  /** Gradient falloff: horizon colour holds longer as this drops (0.55 in both games). */
  gradient?: number;
  /** Disc sharpness (falls 350, harbor 900) and its HDR intensity. */
  sunSharpness?: number;
  sunIntensity?: number;
  /** Wide glow around the sun: sharpness and strength. */
  glowSharpness?: number;
  glow?: number;
  /** Desaturating lift toward the horizon colour near the horizon (falls 0.5). */
  haze?: number;
  colorMode?: ColorMode;
  radius?: number;
}

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(o: SkyOptions = {}) {
    const mode = o.colorMode ?? 'linear';
    this.material = new THREE.ShaderMaterial({
      name: 'gamekit.sky',
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(o.zenith ?? 0x5aa6dc) },
        uHorizon: { value: new THREE.Color(o.horizon ?? 0xcfe9f5) },
        uSunColor: { value: new THREE.Color(o.sunColor ?? 0xfff0d0) },
        uSunDir: { value: (o.sunDirection ?? new THREE.Vector3(0.3, 0.6, -0.7)).clone().normalize() },
        uGradient: { value: o.gradient ?? 0.55 },
        uSunSharp: { value: o.sunSharpness ?? 600 },
        uSunIntensity: { value: o.sunIntensity ?? 3 },
        uGlowSharp: { value: o.glowSharpness ?? 12 },
        uGlow: { value: o.glow ?? 0.25 },
        uHaze: { value: o.haze ?? 0.5 },
        gkExposure: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize( position );
          vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          gl_Position = p.xyww; // on the far plane: never clips, never occludes
        }`,
      fragmentShader: modeGlsl(mode) + /* glsl */ `
        uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunColor; uniform vec3 uSunDir;
        uniform float uGradient; uniform float uSunSharp; uniform float uSunIntensity;
        uniform float uGlowSharp; uniform float uGlow; uniform float uHaze;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize( vDir );
          float h = max( dir.y, 0.0 );
          vec3 sky = mix( uHorizon, uZenith, pow( h, uGradient ) );
          float s = max( dot( dir, uSunDir ), 0.0 );
          sky += uSunColor * pow( s, uGlowSharp ) * uGlow;
          sky = mix( sky, uHorizon, pow( 1.0 - h, 6.0 ) * uHaze );
          vec3 col = toScene( sky ) + uSunColor * pow( s, uSunSharp ) * uSunIntensity;
          gl_FragColor = vec4( col, 1.0 );
          ${OUTPUT_GLSL}
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(o.radius ?? 1000, 32, 16), this.material);
    this.mesh.name = 'gamekit.sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.userData.gamekitUnbent = true; // the sky is at infinity; never bend it
    this.mesh.onBeforeRender = (_r, _s, camera) => { this.mesh.position.copy(camera.position); this.mesh.updateMatrixWorld(); };
  }

  get uniforms() {
    return this.material.uniforms;
  }

  /** Keep in step with the pipeline's exposure when colorMode is 'display'. */
  set exposure(e: number) {
    this.material.uniforms.gkExposure.value = e;
  }
}
