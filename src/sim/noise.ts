import { hash3 } from './rng';

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lattice(seed: number, x: number, z: number): number {
  return hash3(x, z, seed) / 4294967296;
}

/** Smooth 2D value noise in [0, 1), deterministic per seed. */
export function valueNoise(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const tz = smooth(z - z0);
  const a = lattice(seed, x0, z0);
  const b = lattice(seed, x0 + 1, z0);
  const c = lattice(seed, x0, z0 + 1);
  const d = lattice(seed, x0 + 1, z0 + 1);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

/** Fractal (multi-octave) value noise in roughly [0, 1). */
export function fbm(seed: number, x: number, z: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(seed + i * 1013, x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
