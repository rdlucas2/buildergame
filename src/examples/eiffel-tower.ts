import { StructureBuilder } from '../core/structure-builder';

const SIZE = 45; // base width in voxels (about 2.75 m per voxel)
const C = (SIZE - 1) / 2; // centre column index
const TOP = 100; // top observation platform
const PLATFORM_1 = 20;
const PLATFORM_2 = 42;

/** Half-width of the tower's outer edge at height y: an exponential taper like the real profile. */
function halfWidth(y: number): number {
  return Math.max(1.5, 22.5 * Math.exp(-0.0272 * y));
}

/** Thickness of each of the four legs at height y; they merge into one shaft near the 2nd platform. */
function legThickness(y: number): number {
  return 8.5 - (1.5 / 42) * y;
}

/** True when (x, y, z) lies inside the tower's solid envelope (legs below, single shaft above). */
function inEnvelope(x: number, y: number, z: number): boolean {
  if (y < 0 || y > TOP) return false;
  const w = halfWidth(y);
  const ax = Math.abs(x - C);
  const az = Math.abs(z - C);
  if (ax > w || az > w) return false;
  const inner = w - legThickness(y);
  if (inner <= 0.5) return true; // legs have merged
  return ax >= inner && az >= inner; // one of the four corner legs
}

/** Wrought-iron tower on four arched legs with two platforms, an observation deck and a spire. */
export function buildEiffelTower(b = new StructureBuilder({ x: SIZE, y: 122, z: SIZE })): StructureBuilder {
  // Lattice shell: keep the envelope's surface, as strong corner members plus X bracing.
  // Only side-facing surface cells count, so the tapered faces stay one cell thick instead of
  // turning into solid stair steps.
  b.paint((x, y, z) => {
    if (!inEnvelope(x, y, z)) return undefined;
    const outX = !inEnvelope(x - 1, y, z) || !inEnvelope(x + 1, y, z);
    const outZ = !inEnvelope(x, y, z - 1) || !inEnvelope(x, y, z + 1);
    if (!outX && !outZ) return y === TOP ? 'bronze' : undefined; // interior
    if (outX && outZ) return 'bronze'; // vertical edge member
    if (y % 10 === 0) return 'bronze'; // horizontal girders
    const u = outX ? z : x; // coordinate running along this face
    return (u + y) % 6 === 0 || (u - y + 600) % 6 === 0 ? 'bronze' : undefined; // X bracing
  });

  // Stone footings under each leg.
  b.paint((x, y, z) => (y === 0 && inEnvelope(x, 0, z) ? 'stone' : undefined));

  // The great arches between the legs on all four faces, under the first platform. Each is an
  // elliptical arch, two cells thick, springing from the legs' inner edges.
  const archSpring = 6;
  const archTop = 17;
  const archSpan = halfWidth(archSpring) - legThickness(archSpring);
  const putArch = (d: number, y: number) => {
    const edge = Math.floor(halfWidth(y));
    const along = Math.round(C + d);
    for (const s of [-1, 1]) {
      b.set(along, y, Math.round(C + s * edge), 'bronze');
      b.set(Math.round(C + s * edge), y, along, 'bronze');
    }
  };
  const rise = archTop - archSpring;
  for (let d = -Math.floor(archSpan); d <= Math.floor(archSpan); d++) {
    const y = Math.round(archSpring + rise * Math.sqrt(Math.max(0, 1 - (d / archSpan) ** 2)));
    putArch(d, y);
    putArch(d, y + 1);
  }
  for (let y = archSpring; y <= archTop; y++) {
    const d = Math.round(archSpan * Math.sqrt(Math.max(0, 1 - ((y - archSpring) / rise) ** 2)));
    putArch(d, y);
    putArch(-d, y);
  }

  // Platforms: a ring at the first level and a solid deck at the second, each with a railing band.
  const platform = (y: number, openHalf: number) => {
    const half = Math.floor(halfWidth(y + 1)) + 1;
    b.paint((x, py, z) => {
      if (py < y || py > y + 2) return undefined;
      const ax = Math.abs(x - C);
      const az = Math.abs(z - C);
      if (ax > half || az > half) return undefined;
      if (py === y) return ax > openHalf || az > openHalf ? 'bronze' : undefined;
      const onRim = ax === half || az === half;
      if (!onRim) return undefined;
      return py === y + 1 ? 'brown' : (x + z) % 2 === 0 ? 'brown' : undefined;
    });
  };
  platform(PLATFORM_1, 5);
  platform(PLATFORM_2, -1);

  // Top observation deck, cap and spire with a beacon.
  b.fill(C - 2, TOP, C - 2, C + 2, TOP, C + 2, 'bronze');
  b.walls(C - 2, TOP + 1, C - 2, C + 2, TOP + 2, C + 2, 'glass');
  for (const dx of [-2, 2]) for (const dz of [-2, 2]) b.fill(C + dx, TOP + 1, C + dz, C + dx, TOP + 2, C + dz, 'gold');
  b.fill(C - 2, TOP + 3, C - 2, C + 2, TOP + 3, C + 2, 'bronze');
  b.fill(C - 1, TOP + 4, C - 1, C + 1, TOP + 4, C + 1, 'bronze');
  b.fill(C, TOP + 5, C, C, TOP + 19, C, 'iron');
  b.set(C, TOP + 20, C, 'lantern');
  return b;
}
