import { fbm, valueNoise } from './noise';
import { Rng } from './rng';

/**
 * Terrain for a wild world: a flat square of ground with ponds and streams. Only the water mask is
 * generated; it is fully determined by the seed and never stored.
 *
 * Cells are indexed `(x + half) + (z + half) * size` for world cells x, z in [-half, half).
 */
export interface Terrain {
  size: number;
  half: number;
  /** 1 where the ground cell is water. */
  water: Uint8Array;
  /** Count of water cells. */
  waterCells: number;
}

export interface TerrainOptions {
  /** Radius around the origin kept dry so players start on land. */
  dryRadius?: number;
}

export function cellIndex(size: number, x: number, z: number): number {
  const half = size >> 1;
  return x + half + (z + half) * size;
}

export function inGround(size: number, x: number, z: number): boolean {
  const half = size >> 1;
  return x >= -half && x < half && z >= -half && z < half;
}

export function generateTerrain(size: number, seed: number, opts: TerrainOptions = {}): Terrain {
  const half = size >> 1;
  const dry = opts.dryRadius ?? 28;
  const water = new Uint8Array(size * size);
  const rng = new Rng(seed ^ 0x51ed270b);
  const noiseSeed = seed ^ 0x2545f491;

  const stamp = (x: number, z: number) => {
    if (x < -half || x >= half || z < -half || z >= half) return;
    if (x * x + z * z < dry * dry) return;
    water[x + half + (z + half) * size] = 1;
  };

  const pond = (cx: number, cz: number, r: number) => {
    const reach = Math.ceil(r * 1.3);
    for (let z = Math.floor(cz - reach); z <= cz + reach; z++) {
      for (let x = Math.floor(cx - reach); x <= cx + reach; x++) {
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        const edge = r * (0.72 + 0.56 * valueNoise(noiseSeed, x / 6, z / 6));
        if (d < edge) stamp(x, z);
      }
    }
  };

  // A starter pond in front of the default view (towards -z), so water is visible right away.
  const a0 = rng.range(-0.6, 0.6);
  const d0 = dry + rng.range(22, 34);
  pond(Math.round(Math.sin(a0) * -d0 * 0.6), Math.round(-Math.cos(a0) * d0), rng.range(8, 12));

  // Scattered ponds, kept away from the dry spawn area.
  const count = Math.max(4, Math.round((size * size) / 40000));
  for (let i = 0; i < count; i++) {
    const r = rng.range(5, 18);
    const cx = rng.range(-half + r + 4, half - r - 4);
    const cz = rng.range(-half + r + 4, half - r - 4);
    if (Math.hypot(cx, cz) < dry + r + 6) continue;
    pond(cx, cz, r);
  }

  // Streams: meandering courses from one side of the map to the other.
  const streams = Math.max(1, Math.round(size / 600));
  for (let i = 0; i < streams; i++) {
    const alongX = rng.chance(0.5); // flows along x (from west to east) or along z
    const offset0 = rng.range(-half * 0.7, half * 0.7);
    const drift = rng.range(-half * 0.4, half * 0.4);
    const bendAmp = rng.range(half * 0.08, half * 0.18);
    const bendFreq = rng.range(1.2, 2.6);
    const phase = rng.range(0, Math.PI * 2);
    const steps = size * 3;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const along = -half + t * size;
      const wiggle = (fbm(noiseSeed + 311 + i, t * 7, i * 3.7, 3) - 0.5) * half * 0.22;
      const across = offset0 + drift * t + bendAmp * Math.sin(2 * Math.PI * bendFreq * t + phase) + wiggle;
      const x = alongX ? along : across;
      const z = alongX ? across : along;
      const w = 1.2 + 1.8 * fbm(noiseSeed + 77, x / 40, z / 40, 2);
      const r = Math.ceil(w);
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) if (dx * dx + dz * dz <= w * w) stamp(Math.round(x) + dx, Math.round(z) + dz);
    }
  }

  let waterCells = 0;
  for (let i = 0; i < water.length; i++) waterCells += water[i];
  return { size, half, water, waterCells };
}

/** True when the cell is dry land next to water (4-neighbourhood), i.e. a place to drink from. */
export function isShore(t: Terrain, x: number, z: number): boolean {
  if (!inGround(t.size, x, z) || t.water[cellIndex(t.size, x, z)]) return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, nz = z + dz;
    if (inGround(t.size, nx, nz) && t.water[cellIndex(t.size, nx, nz)]) return true;
  }
  return false;
}
