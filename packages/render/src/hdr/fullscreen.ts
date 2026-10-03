// One full-screen triangle, shared by every pass.
import * as THREE from 'three';

const geometry = new THREE.BufferGeometry()
  .setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3))
  .setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FULLSCREEN_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

export class FullscreenPass {
  readonly mesh: THREE.Mesh;
  constructor(readonly material: THREE.ShaderMaterial) {
    material.depthTest = false;
    material.depthWrite = false;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, camera);
  }
  dispose(): void {
    this.material.dispose();
  }
}

export function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}): FullscreenPass {
  return new FullscreenPass(new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VS, fragmentShader, uniforms, defines, toneMapped: false }));
}
