import { StructureBuilder } from '../core/structure-builder';

/** Two-storey timber-frame farmhouse with a slate roof and a covered front porch. Porch faces +z. */
export function buildFarmhouse(b = new StructureBuilder({ x: 17, y: 18, z: 15 })): StructureBuilder {
  // Walls on x 1..15, z 1..10. Ground storey y 1..4, first floor beam y 5, upper storey y 6..9.
  b.fill(1, 0, 1, 15, 0, 10, 'cobblestone');
  b.fill(2, 0, 2, 14, 0, 9, 'planks');
  b.walls(1, 1, 1, 15, 9, 10, 'white');
  b.fill(2, 5, 2, 14, 5, 9, 'planks'); // upper floor
  // Timber frame: corner and intermediate posts, floor beam and top plate.
  for (const x of [1, 6, 10, 15]) for (const z of [1, 10]) b.fill(x, 1, z, x, 9, z, 'log');
  for (const x of [1, 15]) b.fill(x, 1, 5, x, 9, 5, 'log').fill(x, 1, 6, x, 9, 6, 'log');
  b.walls(1, 5, 1, 15, 5, 10, 'log');
  b.walls(1, 9, 1, 15, 9, 10, 'log');

  // Front: door, windows on both storeys.
  b.fill(8, 1, 10, 8, 3, 10, null);
  for (const x of [3, 12]) {
    b.fill(x, 2, 10, x + 1, 3, 10, 'glass');
    b.fill(x, 7, 10, x + 1, 8, 10, 'glass');
    b.fill(x, 2, 1, x + 1, 3, 1, 'glass');
    b.fill(x, 7, 1, x + 1, 8, 1, 'glass');
  }
  b.fill(7, 7, 10, 9, 8, 10, 'glass');
  b.fill(7, 7, 1, 9, 8, 1, 'glass');
  for (const x of [1, 15]) {
    b.fill(x, 2, 3, x, 3, 4, 'glass').fill(x, 2, 7, x, 3, 8, 'glass');
    b.fill(x, 7, 3, x, 8, 4, 'glass').fill(x, 7, 7, x, 8, 8, 'glass');
  }

  // Porch: deck, posts, railing with a gap for the steps, flat slate roof.
  b.fill(4, 0, 11, 12, 0, 13, 'planks');
  b.fill(7, 0, 14, 9, 0, 14, 'planks');
  for (const x of [4, 12]) b.fill(x, 1, 13, x, 4, 13, 'log');
  b.fill(5, 1, 13, 7, 1, 13, 'planks').fill(9, 1, 13, 11, 1, 13, 'planks');
  b.fill(3, 5, 11, 13, 5, 14, 'slate');
  b.set(2, 1, 11, 'leaves').set(14, 1, 11, 'leaves').set(2, 2, 11, 'pink').set(14, 2, 11, 'pink');

  // Roof and chimney.
  const ridge = b.gableRoofX(1, 15, 1, 10, 10, 'slate', { overhang: 1, gable: 'white', ridge: 'stone' });
  b.fill(13, 9, 4, 13, ridge + 1, 4, 'brick');
  return b;
}
