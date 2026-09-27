import { StructureBuilder } from '../core/structure-builder';

/**
 * A walled pen that keeps rabbits safe from wolves. The walls are 3 blocks high, too high for a
 * wolf to leap, and each side has a 1-high gap that rabbits can use but wolves (2 tall) cannot.
 * The pen is open to the sky so grass keeps growing inside, and a small roofed den in one corner
 * gives shade. Build it by water with a gap facing the shore.
 */
export function buildRabbitWarren(b = new StructureBuilder({ x: 13, y: 3, z: 13 })): StructureBuilder {
  b.walls(0, 0, 0, 12, 1, 12, 'stone_bricks');
  b.walls(0, 2, 0, 12, 2, 12, 'cobblestone');
  // Rabbit-sized gaps in the middle of each wall.
  for (const [x, z] of [[6, 0], [6, 12], [0, 6], [12, 6]]) b.set(x, 0, z, null);
  // A roofed den in the north-west corner, and a few posts to mark it.
  b.fill(1, 2, 1, 3, 2, 3, 'planks');
  b.fill(3, 0, 3, 3, 1, 3, 'log');
  return b;
}
