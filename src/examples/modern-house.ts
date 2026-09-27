import { StructureBuilder } from '../core/structure-builder';

/** Flat-roofed modern house: glass ground floor, a cantilevered upper box, deck and pool. Faces +z. */
export function buildModernHouse(b = new StructureBuilder({ x: 23, y: 11, z: 17 })): StructureBuilder {
  // Ground floor box on x 1..14, z 1..9, with a floor-to-ceiling glass front.
  b.fill(1, 0, 1, 14, 0, 9, 'marble');
  b.walls(1, 1, 1, 14, 4, 9, 'white');
  b.fill(3, 1, 9, 12, 4, 9, 'glass');
  b.fill(7, 1, 9, 7, 3, 9, null); // sliding door left open
  b.fill(1, 2, 3, 1, 3, 7, 'glass');
  b.fill(4, 2, 1, 11, 3, 1, 'glass');
  b.fill(1, 5, 1, 14, 5, 9, 'white'); // roof slab

  // Upper box on x 6..21, z 1..9, cantilevered past the ground floor.
  b.fill(6, 5, 1, 21, 5, 9, 'white');
  b.walls(6, 6, 1, 21, 8, 9, 'white');
  b.fill(8, 6, 9, 19, 7, 9, 'glass');
  b.fill(8, 6, 1, 19, 7, 1, 'glass');
  b.fill(21, 6, 3, 21, 7, 7, 'glass');
  b.fill(5, 9, 0, 22, 9, 10, 'slate'); // roof with overhang
  b.fill(6, 10, 1, 21, 10, 9, 'white');
  b.fill(0, 5, 0, 5, 5, 10, 'slate'); // ground floor roof trim

  // Warm interior lights.
  b.set(4, 4, 5, 'lantern').set(10, 4, 5, 'lantern').set(12, 8, 5, 'lantern').set(18, 8, 5, 'lantern');

  // Deck and pool in front.
  b.fill(0, 0, 10, 16, 0, 16, 'planks');
  b.fill(2, 0, 11, 13, 0, 15, 'marble');
  b.fill(3, 0, 12, 12, 0, 14, 'light_blue');
  b.fill(15, 1, 11, 16, 1, 12, 'leaves');
  b.fill(0, 1, 15, 1, 1, 16, 'leaves');
  return b;
}
