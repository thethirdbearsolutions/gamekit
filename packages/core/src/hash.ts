// Deterministic state hashing. Values are walked in a canonical order (object
// keys sorted; Map/Set entries in insertion order) and numbers are hashed by
// their exact float64 bits, so two runs agree only if they agree bit-for-bit.

const buf = new DataView(new ArrayBuffer(8));

export class Hasher {
  // Two independent 32-bit FNV-1a lanes give a 64-bit digest.
  private h1 = 0x811c9dc5;
  private h2 = 0x050c5d1f;

  byte(b: number): this {
    this.h1 = Math.imul(this.h1 ^ (b & 0xff), 0x01000193);
    this.h2 = Math.imul(this.h2 ^ (b & 0xff), 0x01000193) ^ (this.h2 >>> 15);
    return this;
  }

  u32(n: number): this {
    return this.byte(n).byte(n >>> 8).byte(n >>> 16).byte(n >>> 24);
  }

  f64(n: number): this {
    // Treat -0 and 0, and every NaN, as equal: they can't affect play.
    buf.setFloat64(0, n === 0 ? 0 : Number.isNaN(n) ? NaN : n, true);
    return this.u32(buf.getUint32(0, true)).u32(buf.getUint32(4, true));
  }

  str(s: string): this {
    this.u32(s.length);
    for (let i = 0; i < s.length; i++) this.u32(s.charCodeAt(i));
    return this;
  }

  value(v: unknown): this {
    if (v === null || v === undefined) return this.byte(v === null ? 1 : 2);
    switch (typeof v) {
      case 'number': return this.byte(3).f64(v);
      case 'boolean': return this.byte(v ? 4 : 5);
      case 'string': return this.byte(6).str(v);
      case 'bigint': return this.byte(7).str(v.toString());
      case 'function': case 'symbol': return this;
    }
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const arr = v as unknown as ArrayLike<number>;
      this.byte(8).u32(arr.length);
      for (let i = 0; i < arr.length; i++) this.f64(Number(arr[i]));
      return this;
    }
    if (Array.isArray(v)) {
      this.byte(9).u32(v.length);
      for (const x of v) this.value(x);
      return this;
    }
    if (v instanceof Map) {
      this.byte(10).u32(v.size);
      for (const [k, x] of v) this.value(k).value(x);
      return this;
    }
    if (v instanceof Set) {
      this.byte(11).u32(v.size);
      for (const x of v) this.value(x);
      return this;
    }
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => typeof o[k] !== 'function').sort();
    this.byte(12).u32(keys.length);
    for (const k of keys) this.str(k).value(o[k]);
    return this;
  }

  digest(): string {
    return (this.h1 >>> 0).toString(16).padStart(8, '0') + (this.h2 >>> 0).toString(16).padStart(8, '0');
  }
}

/** 64-bit hex digest of any plain state (objects, arrays, typed arrays, Map, Set). */
export function hashState(state: unknown): string {
  return new Hasher().value(state).digest();
}

/** Quantise before hashing when a value is allowed to differ in its last bits. */
export const quantize = (n: number, step = 1e-6): number => Math.round(n / step) * step;
