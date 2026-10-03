// Seeded randomness with named streams. Each stream is an independent sfc32
// generator whose seed is a hash of (root seed, stream name), so adding draws
// to one system ("weather") never shifts the numbers another ("loot") sees.

/** cyrb53-style string hash to a 32-bit pair; stable across platforms. */
export function hashString(s: string, seed = 0): [number, number] {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}

export type RngState = [number, number, number, number];

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | string, stream = '') {
    const [h1, h2] = hashString(`${seed}\u0000${stream}`);
    const [h3, h4] = hashString(`${stream}\u0000${seed}`, 0x9e3779b9);
    this.a = h1; this.b = h2; this.c = h3; this.d = h4 | 1;
    for (let i = 0; i < 12; i++) this.u32(); // warm up
  }

  /** Uniform 32-bit unsigned integer. */
  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[Math.floor(this.next() * items.length)];
  }

  /** Standard normal via Box–Muller (uses two draws every call). */
  normal(mean = 0, sd = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Fisher–Yates in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  getState(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  setState(s: RngState): void {
    [this.a, this.b, this.c, this.d] = s;
  }
}

/** A root seed handing out one independent stream per name. */
export class RngStreams {
  private readonly streams = new Map<string, Rng>();
  constructor(readonly seed: number | string) {}

  stream(name: string): Rng {
    let r = this.streams.get(name);
    if (!r) this.streams.set(name, (r = new Rng(this.seed, name)));
    return r;
  }

  /** Snapshot every stream (for hashing, save games, rewinds). */
  getState(): Record<string, RngState> {
    const out: Record<string, RngState> = {};
    for (const [k, r] of [...this.streams].sort(([a], [b]) => (a < b ? -1 : 1))) out[k] = r.getState();
    return out;
  }

  setState(state: Record<string, RngState>): void {
    for (const [k, s] of Object.entries(state)) this.stream(k).setState(s);
  }
}
