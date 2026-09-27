import { StructureBuilder } from '../core/structure-builder';

/** Small timber and stone cottage with a brick gable roof and chimney. Door faces +z. */
export function buildCottage(b = new StructureBuilder({ x: 13, y: 12, z: 12 })): StructureBuilder {
  // Footprint: walls on x 1..11, z 1..9. The roof overhangs into x 0..12, z 0..10.
  b.fill(1, 0, 1, 11, 0, 9, 'cobblestone');
  b.fill(2, 0, 2, 10, 0, 8, 'planks');
  b.walls(1, 1, 1, 11, 3, 9, 'planks');
  b.walls(1, 4, 1, 11, 4, 9, 'log');
  for (const [x, z] of [[1, 1], [11, 1], [1, 9], [11, 9]]) b.fill(x, 1, z, x, 4, z, 'log');

  // Door and doorstep on the front (+z) wall.
  b.fill(6, 1, 9, 6, 2, 9, null);
  b.fill(5, 0, 10, 7, 0, 10, 'cobblestone');

  // Windows.
  for (const x of [3, 8]) {
    b.fill(x, 2, 9, x + 1, 3, 9, 'glass');
    b.fill(x, 2, 1, x + 1, 3, 1, 'glass');
    b.fill(x, 1, 10, x + 1, 1, 10, 'leaves'); // flower box
  }
  b.set(3, 1, 10, 'red').set(9, 1, 10, 'yellow');
  b.fill(1, 2, 4, 1, 3, 6, 'glass');
  b.fill(11, 2, 4, 11, 3, 6, 'glass');

  // Roof and chimney.
  const ridge = b.gableRoofX(1, 11, 1, 9, 5, 'brick', { overhang: 1, gable: 'planks', ridge: 'brown' });
  b.fill(9, 4, 3, 9, ridge, 3, 'cobblestone');
  b.fill(9, ridge + 1, 3, 9, ridge + 1, 3, 'stone');
  return b;
}
