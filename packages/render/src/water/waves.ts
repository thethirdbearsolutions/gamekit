// One wave definition for physics and shaders. A sum of Gerstner (trochoidal)
// waves: surface points move in circles, so crests sharpen and troughs
// flatten as steepness rises. `displace` and the GLSL in wavesGlsl() are the
// same sums; `heightAt` inverts the horizontal motion so a boat sampling
// (x, z) gets the height of the surface actually drawn over (x, z).

export interface Wave {
  /** Direction of travel, radians (0 = +x, π/2 = +z). */
  direction: number;
  wavelength: number;
  /** Crest height above rest (m). */
  amplitude: number;
  /** 0..1: how much points move sideways (1 = cusped crests). Default 0.6. */
  steepness?: number;
  /** Phase speed (m/s); default deep-water dispersion √(g/k). */
  speed?: number;
  phase?: number;
}

export const MAX_WAVES = 8;
const G = 9.81;

/** Packed for uniforms: per wave vec4(dirX, dirZ, k, amplitude) and vec4(ω, Q, phase, 0). */
export interface PackedWaves { a: Float32Array; b: Float32Array; count: number }

export class WaveSet {
  readonly packed: PackedWaves = { a: new Float32Array(MAX_WAVES * 4), b: new Float32Array(MAX_WAVES * 4), count: 0 };

  constructor(waves: Wave[] = []) {
    this.set(waves);
  }

  set(waves: Wave[]): void {
    if (waves.length > MAX_WAVES) throw new Error(`WaveSet: at most ${MAX_WAVES} waves`);
    const { a, b } = this.packed;
    a.fill(0); b.fill(0);
    // Keep the sum of Q·k·A ≤ 1 so the surface never loops over itself.
    let qka = 0;
    const ks = waves.map((w) => (2 * Math.PI) / w.wavelength);
    waves.forEach((w, i) => { qka += (w.steepness ?? 0.6) * ks[i] * w.amplitude; });
    const qScale = qka > 1 ? 1 / qka : 1;
    waves.forEach((w, i) => {
      const k = ks[i];
      const omega = (w.speed ?? Math.sqrt(G / k)) * k;
      a.set([Math.cos(w.direction), Math.sin(w.direction), k, w.amplitude], i * 4);
      b.set([omega, (w.steepness ?? 0.6) * qScale, w.phase ?? 0, 0], i * 4);
    });
    this.packed.count = waves.length;
  }

  /** Where the rest point (x, 0, z) is at time t: offset {x, y, z}. */
  displace(x: number, z: number, t: number, out = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
    const { a, b, count } = this.packed;
    out.x = 0; out.y = 0; out.z = 0;
    for (let i = 0; i < count; i++) {
      const dx = a[i * 4], dz = a[i * 4 + 1], k = a[i * 4 + 2], amp = a[i * 4 + 3];
      const th = k * (dx * x + dz * z) - b[i * 4] * t + b[i * 4 + 2];
      const q = b[i * 4 + 1] / k;
      const c = Math.cos(th);
      out.x += q * dx * c * (amp * k);
      out.z += q * dz * c * (amp * k);
      out.y += amp * Math.sin(th);
    }
    return out;
  }

  /** Surface height over world (x, z) at time t. */
  heightAt(x: number, z: number, t: number, iterations = 4): number {
    // Fixed-point: find the rest point whose displaced position lands on (x, z).
    let px = x, pz = z;
    const d = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < iterations; i++) {
      this.displace(px, pz, t, d);
      px = x - d.x;
      pz = z - d.z;
    }
    return this.displace(px, pz, t, d).y;
  }

  /** Unit normal of the surface above rest point (x, z): the exact cross
   *  product of the displaced surface's tangents (GPU Gems' shortcut drops
   *  cross terms and is a degree or two off once waves are summed). */
  normalAt(x: number, z: number, t: number): { x: number; y: number; z: number } {
    const { a, b, count } = this.packed;
    let xx = 1, xy = 0, xz = 0, zx = 0, zy = 0, zz = 1;
    for (let i = 0; i < count; i++) {
      const dx = a[i * 4], dz = a[i * 4 + 1], k = a[i * 4 + 2], amp = a[i * 4 + 3];
      const th = k * (dx * x + dz * z) - b[i * 4] * t + b[i * 4 + 2];
      const wa = k * amp, q = b[i * 4 + 1];
      const S = Math.sin(th), C = Math.cos(th);
      xx -= q * wa * dx * dx * S; xy += wa * dx * C; xz -= q * wa * dx * dz * S;
      zx -= q * wa * dx * dz * S; zy += wa * dz * C; zz -= q * wa * dz * dz * S;
    }
    // n = ∂P/∂z × ∂P/∂x
    const nx = zy * xz - zz * xy, ny = zz * xx - zx * xz, nz = zx * xy - zy * xx;
    const n = Math.hypot(nx, ny, nz);
    return { x: nx / n, y: ny / n, z: nz / n };
  }

  /** A plausible sea from wind: `count` waves spread ±spread around `direction`. */
  static wind(opts: { direction: number; wavelength: number; amplitude: number; count?: number; spread?: number; steepness?: number; seed?: number }): WaveSet {
    const n = opts.count ?? 4;
    const spread = opts.spread ?? 0.6;
    let s = (opts.seed ?? 1) >>> 0;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const waves: Wave[] = [];
    for (let i = 0; i < n; i++) {
      const f = 1 / (1 + i * 0.6);
      waves.push({ direction: opts.direction + (rnd() * 2 - 1) * spread, wavelength: opts.wavelength * f, amplitude: opts.amplitude * f,
        steepness: opts.steepness, phase: rnd() * Math.PI * 2 });
    }
    return new WaveSet(waves);
  }
}

/** GLSL: uniforms and gkWaveDisplace / gkWaveNormal, same sums as WaveSet. */
export function wavesGlsl(): string {
  return /* glsl */ `
uniform vec4 uWaveA[ ${MAX_WAVES} ];
uniform vec4 uWaveB[ ${MAX_WAVES} ];
uniform int uWaveCount;
uniform float uWaveTime;
vec3 gkWaveDisplace( vec2 p, float t ) {
  vec3 o = vec3( 0.0 );
  for ( int i = 0; i < ${MAX_WAVES}; i++ ) {
    if ( i >= uWaveCount ) break;
    vec4 a = uWaveA[ i ]; vec4 b = uWaveB[ i ];
    float th = a.z * dot( a.xy, p ) - b.x * t + b.z;
    float c = cos( th );
    o.xz += ( b.y / a.z ) * a.xy * c * ( a.w * a.z );
    o.y += a.w * sin( th );
  }
  return o;
}
vec3 gkWaveNormal( vec2 p, float t ) {
  vec3 tx = vec3( 1.0, 0.0, 0.0 );
  vec3 tz = vec3( 0.0, 0.0, 1.0 );
  for ( int i = 0; i < ${MAX_WAVES}; i++ ) {
    if ( i >= uWaveCount ) break;
    vec4 a = uWaveA[ i ]; vec4 b = uWaveB[ i ];
    float th = a.z * dot( a.xy, p ) - b.x * t + b.z;
    float wa = a.z * a.w;
    float qs = b.y * wa * sin( th );
    float c = wa * cos( th );
    tx += vec3( -qs * a.x * a.x, c * a.x, -qs * a.x * a.y );
    tz += vec3( -qs * a.x * a.y, c * a.y, -qs * a.y * a.y );
  }
  return normalize( cross( tz, tx ) );
}
`;
}

/** Uniform objects to merge into a ShaderMaterial; share them across materials. */
export function waveUniforms(set: WaveSet) {
  return {
    uWaveA: { value: set.packed.a },
    uWaveB: { value: set.packed.b },
    uWaveCount: { value: set.packed.count },
    uWaveTime: { value: 0 },
  };
}
