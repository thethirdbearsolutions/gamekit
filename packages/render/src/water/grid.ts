// Ocean geometry from the sailing lab: one square grid whose spacing grows
// with distance from the centre (dense under the camera, sparse at the
// horizon), carried along with the camera in snapped steps so vertices
// don't swim across the waves.
import * as THREE from 'three';

export function oceanGrid(size = 3000, segments = 220, power = 2.2): THREE.BufferGeometry {
  const n = segments + 1;
  const pos = new Float32Array(n * n * 3);
  const warp = (u: number) => Math.sign(u) * Math.pow(Math.abs(u), power) * (size / 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      pos[k] = warp((i / segments) * 2 - 1);
      pos[k + 2] = warp((j / segments) * 2 - 1);
    }
  }
  const idx = new Uint32Array(segments * segments * 6);
  let p = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      idx.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], p);
      p += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), (size / 2) * Math.SQRT2);
  return g;
}

/** Move a grid mesh under the camera in `snap`-metre steps. */
export function followCamera(mesh: THREE.Object3D, camera: THREE.Vector3, snap = 4): void {
  mesh.position.x = Math.round(camera.x / snap) * snap;
  mesh.position.z = Math.round(camera.z / snap) * snap;
}

/** Bake ground elevation into a half-float texture for WaterMaterial's
 *  depth (shallows colour, foam at the shoreline, wave shoaling). */
export function elevationTexture(heightAt: (x: number, z: number) => number, bounds: { minX: number; minZ: number; size: number },
  resolution = 256): { texture: THREE.DataTexture; bounds: THREE.Vector4 } {
  const data = new Uint16Array(resolution * resolution);
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const x = bounds.minX + ((i + 0.5) / resolution) * bounds.size;
      const z = bounds.minZ + ((j + 0.5) / resolution) * bounds.size;
      data[j * resolution + i] = THREE.DataUtils.toHalfFloat(heightAt(x, z));
    }
  }
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RedFormat, THREE.HalfFloatType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, bounds: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.size, bounds.size) };
}
