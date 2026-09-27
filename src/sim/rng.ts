/**
 * Small, fast, seedable PRNG (mulberry32). Everything in `src/sim` draws randomness from here so a
 * seed plus the same inputs always reproduces the same simulation.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Uniform integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Current internal state, for saving and restoring a stream. */
  get seedState(): number {
    return this.state;
  }
}

/** Mixes integers into a well-distributed 32-bit hash (for stateless per-cell randomness). */
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A fresh random 32-bit seed from the platform's crypto source (only used outside the sim). */
export function randomSeed(): number {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
