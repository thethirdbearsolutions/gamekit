// Curved world for three's WebGL materials. Gameplay stays straight; drawing
// bends. Compared with chaotic-attack's bend.ts this keeps the proven chunk
// patches (so three's own shadow depth materials bend too, and shadows stay
// under what casts them) and adds:
//  - culling: each object's bounds are bent too, so things round a curve
//    aren't culled by where they'd be on the straight (and shadows likewise);
//  - safety: patched chunks only bend under GAMEKIT_BEND, which is defined
//    as the declarations are injected, so a material we miss draws straight
//    instead of failing to compile;
//  - per-material onBeforeCompile hooks are chained, not overwritten;
//  - custom ShaderMaterials opt in by calling bendWorld() themselves.
import * as THREE from 'three';
import { bendGlsl } from './glsl.js';
import { BendPath, type PathConfig } from './path.js';

export interface CurvedWorldOptions extends PathConfig {
  /** GLSL defining `vec4 bendPre( vec4 w )`, run on world positions before
   *  the bend: game-specific warps (chaotic-attack's road widening) go here. */
  pre?: string;
  /** Extra bounds radius factor for bent objects (default 1.25). */
  boundsSlack?: number;
}

const PATCHES: [chunk: string, find: string, replace: string][] = [
  ['project_vertex', 'mvPosition = modelViewMatrix * mvPosition;',
    '#ifdef GAMEKIT_BEND\n\tvBendCut = 0.0;\n\tmvPosition = viewMatrix * bendWorld( modelMatrix * mvPosition );\n#else\n\tmvPosition = modelViewMatrix * mvPosition;\n#endif'],
  ['worldpos_vertex', 'worldPosition = modelMatrix * worldPosition;',
    'worldPosition = modelMatrix * worldPosition;\n#ifdef GAMEKIT_BEND\n\tworldPosition = bendWorld( worldPosition );\n#endif'],
  ['normal_vertex', 'vNormal = normalize( transformedNormal );',
    `vNormal = normalize( transformedNormal );
#ifdef GAMEKIT_BEND
	vNormal = normalize( mat3( viewMatrix ) * bendNormal( transpose( mat3( viewMatrix ) ) * vNormal, -( modelMatrix * vec4( position, 1.0 ) ).z ) );
#endif`],
];

let active: CurvedWorld | null = null;

export class CurvedWorld {
  readonly path: BendPath;
  readonly uniforms: { uBendPath: { value: Float32Array }; uBendCut: { value: number }; uBendDrop: { value: number } };
  private readonly declare: string;
  private readonly slack: number;
  private readonly _sphere = new THREE.Sphere();
  private readonly _inv = new THREE.Matrix4();

  /** Install once, before the first shader compiles. */
  static install(opts: CurvedWorldOptions = {}): CurvedWorld {
    if (active) return active;
    return (active = new CurvedWorld(opts));
  }

  private constructor(opts: CurvedWorldOptions) {
    this.path = new BendPath(opts);
    this.slack = opts.boundsSlack ?? 1.25;
    this.uniforms = { uBendPath: { value: this.path.data }, uBendCut: { value: this.path.cut }, uBendDrop: { value: 0 } };
    this.declare = `#define GAMEKIT_BEND\n${opts.pre ? '#define GAMEKIT_BEND_PRE\n' : ''}${bendGlsl(this.path.samples, this.path.step)}${opts.pre ?? ''}\n`;
    const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
    for (const [name, find, replace] of PATCHES) {
      if (!chunks[name].includes(find)) console.warn(`[gamekit/curved] three changed ${name}; it will draw unbent`);
      else chunks[name] = chunks[name].replace(find, replace);
    }
    const sprite = THREE.ShaderLib.sprite;
    sprite.vertexShader = sprite.vertexShader.replace('vec4 mvPosition = modelViewMatrix[ 3 ];',
      '#ifdef GAMEKIT_BEND\n\tvBendCut = 0.0;\n\tvec4 mvPosition = viewMatrix * bendWorld( modelMatrix[ 3 ] );\n#else\n\tvec4 mvPosition = modelViewMatrix[ 3 ];\n#endif');
    const proto = THREE.Material.prototype as THREE.Material;
    const world = this;
    proto.onBeforeCompile = function (this: THREE.Material, shader) { world.inject(shader); };
  }

  /** Push path changes to the GPU (call after editing path / drop / cut). */
  sync(): void {
    this.uniforms.uBendCut.value = this.path.cut;
    this.uniforms.uBendDrop.value = this.path.drop;
  }

  /** Add the declarations and shared uniforms to a shader that bends.
   *  Materials with their own onBeforeCompile must call this from it. */
  inject(shader: THREE.WebGLProgramParametersWithUniforms): void {
    const vs = shader.vertexShader;
    const bends = /#include <(project_vertex|worldpos_vertex)>/.test(vs) || vs.includes('bendWorld(') || vs.includes('#ifdef GAMEKIT_BEND');
    if (!bends || vs.includes('uBendPath')) return;
    shader.vertexShader = this.declare + vs;
    Object.assign(shader.uniforms, this.uniforms);
    const main = /void\s+main\s*\(\s*\)\s*\{/;
    shader.fragmentShader = shader.fragmentShader.replace(main, 'varying float vBendCut;\nvoid main() {\n\tif ( vBendCut > 0.5 ) discard;');
  }

  /** Chain onto a material that has its own onBeforeCompile. */
  attach(material: THREE.Material): void {
    const own = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile') ? material.onBeforeCompile : null;
    if (!own) return;
    material.onBeforeCompile = (shader, renderer) => { own.call(material, shader, renderer); this.inject(shader); };
  }

  /** Draw this subtree straight (placed by hand where the path says), shadows too. */
  unbent(root: THREE.Object3D): void {
    root.traverse((o) => {
      o.userData.gamekitUnbent = true;
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.customDepthMaterial = unbentDepth();
      m.customDistanceMaterial = unbentDistance();
      for (const mat of [m.material].flat()) { mat.defines = { ...(mat.defines ?? {}), NO_BEND: '' }; mat.needsUpdate = true; }
    });
  }

  /** Bend culling bounds to match the drawing. Call each frame after
   *  scene.updateMatrixWorld() (the renderer calls that only at render time,
   *  so call it yourself first). Works for the camera and the shadow maps. */
  updateBounds(root: THREE.Object3D): void {
    root.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!g || o.userData.gamekitUnbent || !o.frustumCulled) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const sphere = this.bentSphere(g.boundingSphere!, o.matrixWorld, this._sphere);
      // Object-space copy: three ≤ r170 reads object.boundingSphere in Frustum.intersectsObject.
      const local = ((o as any).boundingSphere ??= new THREE.Sphere()) as THREE.Sphere;
      local.copy(sphere).applyMatrix4(this._inv.copy(o.matrixWorld).invert());
      local.radius = sphere.radius / Math.max(1e-6, o.matrixWorld.getMaxScaleOnAxis());
      const world = (o.userData.gamekitBounds ??= new THREE.Sphere()) as THREE.Sphere;
      world.copy(sphere);
      if (!o.userData.gamekitCull) {
        o.userData.gamekitCull = true;
        o.intersectsFrustum = (f: THREE.Frustum) => f.intersectsSphere(o.userData.gamekitBounds);
      }
    });
  }

  /** World-space sphere around where `local` (in an object with `matrix`) is drawn. */
  bentSphere(local: THREE.Sphere, matrix: THREE.Matrix4, out = new THREE.Sphere()): THREE.Sphere {
    out.copy(local).applyMatrix4(matrix);
    const c = out.center;
    const b = this.path.bend(c.x, c.y, c.z);
    // Along-track lengths stretch by (1 + x·k) away from the path's centre line.
    const k = this.maxTurnRate();
    out.radius = out.radius * this.slack * (1 + Math.abs(c.x) * k) + 0.01;
    c.set(b.x, b.y, b.z);
    return out;
  }

  private maxTurnRate(): number {
    const v = this.path.data;
    let k = 0;
    for (let i = 0; i < this.path.samples - 1; i++) k = Math.max(k, Math.abs(v[i * 3 + 5] - v[i * 3 + 2]) / this.path.step);
    return k;
  }
}

let _ud: THREE.MeshDepthMaterial | null = null;
let _udist: THREE.MeshDistanceMaterial | null = null;
const unbentDepth = () => (_ud ??= Object.assign(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), { defines: { NO_BEND: '' } }));
const unbentDistance = () => (_udist ??= Object.assign(new THREE.MeshDistanceMaterial(), { defines: { NO_BEND: '' } }));
