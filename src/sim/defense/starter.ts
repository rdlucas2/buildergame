import type { ShoreIndex } from '../shores';
import { cellIndex, inGround, type Terrain } from '../terrain';
import { BASE_SIZE, DefenseBase, LOOKOUT } from './base';

/** Footprint of the starter warren (walls included). */
export const WARREN_SIZE = 15;
const WALL_HEIGHT = 3;

/**
 * Picks where the warren goes: on dry ground a short walk from the water nearest the origin, so
 * the rabbits can drink without going far. Returns the warren's centre cell.
 */
export function chooseWarrenSite(terrain: Terrain, shores: ShoreIndex): { x: number; z: number } {
  const shore = shores.nearest(0, 0, terrain.size);
  if (!shore) return { x: 0, z: 0 };
  const d = Math.hypot(shore.x, shore.z) || 1;
  const ux = -shore.x / d;
  const uz = -shore.z / d;
  // Step back from the shore until the whole footprint is dry.
  const half = Math.floor(WARREN_SIZE / 2);
  for (let back = half + 3; back < half + 40; back++) {
    const cx = Math.round(shore.x + ux * back);
    const cz = Math.round(shore.z + uz * back);
    if (dryFootprint(terrain, cx, cz, half + 1)) return { x: cx, z: cz };
  }
  return { x: Math.round(shore.x + ux * (half + 3)), z: Math.round(shore.z + uz * (half + 3)) };
}

function dryFootprint(t: Terrain, cx: number, cz: number, r: number): boolean {
  for (let z = cz - r; z <= cz + r; z++)
    for (let x = cx - r; x <= cx + r; x++) if (!inGround(t.size, x, z) || t.water[cellIndex(t.size, x, z)]) return false;
  return true;
}

/** A base whose buildable area is centred on the warren site. */
export function createBase(site: { x: number; z: number }): DefenseBase {
  return new DefenseBase({ origin: { x: site.x - Math.floor(BASE_SIZE.x / 2), z: site.z - Math.floor(BASE_SIZE.z / 2) } });
}

/**
 * Builds the starter warren around `site`: cobblestone walls 3 blocks high that wolves can't leap,
 * a 1-high rabbit gap in the middle of each side, wooden steps up to the wall top inside two
 * corners, and a lookout post on each corner for defenders to stand on.
 */
export function buildStarterWarren(base: DefenseBase, site: { x: number; z: number }): void {
  const h = Math.floor(WARREN_SIZE / 2);
  const x0 = site.x - h;
  const z0 = site.z - h;
  const x1 = site.x + h;
  const z1 = site.z + h;
  for (let y = 0; y < WALL_HEIGHT; y++) {
    for (let x = x0; x <= x1; x++) {
      base.set(x, y, z0, 'cobblestone');
      base.set(x, y, z1, 'cobblestone');
    }
    for (let z = z0; z <= z1; z++) {
      base.set(x0, y, z, 'cobblestone');
      base.set(x1, y, z, 'cobblestone');
    }
  }
  // Rabbit gaps: open at ground level only, so the wall top stays a walkway.
  for (const [x, z] of [
    [site.x, z0],
    [site.x, z1],
    [x0, site.z],
    [x1, site.z],
  ]) base.set(x, 0, z, null);
  // Steps up to the wall top, inside the north-west and south-east corners.
  base.set(x0 + 3, 0, z0 + 1, 'planks');
  base.set(x0 + 2, 0, z0 + 1, 'planks');
  base.set(x0 + 2, 1, z0 + 1, 'planks');
  base.set(x1 - 3, 0, z1 - 1, 'planks');
  base.set(x1 - 2, 0, z1 - 1, 'planks');
  base.set(x1 - 2, 1, z1 - 1, 'planks');
  // Lookout posts on the corners of the wall top.
  for (const [x, z] of [
    [x0, z0],
    [x1, z0],
    [x0, z1],
    [x1, z1],
  ]) base.set(x, WALL_HEIGHT, z, LOOKOUT);
}
