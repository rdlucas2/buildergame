import { StructureBuilder } from '../core/structure-builder';

const W = 45; // width along x (about 1 m per voxel)
const D = 22; // depth along z
const CX = (W - 1) / 2;
const CZ = (D - 1) / 2;

const MAIN_HALF = 7.5; // main arch: 15 wide
const MAIN_SPRING = 21; // straight sides up to here, then a semicircle (apex at 28)
const SIDE_HALF = 4; // side arches: 8 wide, through the short faces
const SIDE_SPRING = 14; // apex at 18

function inMainArch(x: number, y: number): boolean {
  const dx = Math.abs(x - CX);
  if (dx > MAIN_HALF) return false;
  return y < MAIN_SPRING || dx * dx + (y - MAIN_SPRING) ** 2 <= MAIN_HALF * MAIN_HALF;
}

function inSideArch(z: number, y: number): boolean {
  const dz = Math.abs(z - CZ);
  if (dz > SIDE_HALF) return false;
  return y < SIDE_SPRING || dz * dz + (y - SIDE_SPRING) ** 2 <= SIDE_HALF * SIDE_HALF;
}

/** Triumphal arch: a limestone block with a grand arch, side arches, cornices, reliefs and an attic. */
export function buildArcDeTriomphe(b = new StructureBuilder({ x: W, y: 50, z: D })): StructureBuilder {
  // Main mass inset one cell so cornices and reliefs can project.
  b.fill(1, 0, 1, W - 2, 47, D - 2, 'limestone');
  b.fill(0, 0, 0, W - 1, 0, D - 1, 'limestone'); // plinth

  // Horizontal bands: arch impost, frieze, main cornice, attic top cornice and parapet.
  b.replace(1, MAIN_SPRING, 1, W - 2, MAIN_SPRING, D - 2, '*', 'marble');
  b.replace(1, 33, 1, W - 2, 35, D - 2, '*', 'marble');
  b.fill(0, 37, 0, W - 1, 38, D - 1, 'marble');
  b.fill(0, 47, 0, W - 1, 47, D - 1, 'marble');
  b.walls(1, 48, 1, W - 2, 48, D - 2, 'marble');

  // Carve the arches through the whole monument.
  b.paint((x, y, z) => (y >= 1 && (inMainArch(x, y) || inSideArch(z, y)) ? null : undefined));

  // Marble archivolt framing the main arch on both faces.
  for (const z of [1, D - 2]) {
    for (let x = 0; x < W; x++) {
      for (let y = 1; y < 34; y++) {
        if (inMainArch(x, y)) continue;
        const near = inMainArch(x - 1, y) || inMainArch(x + 1, y) || inMainArch(x, y - 1) || inMainArch(x - 1, y - 1) || inMainArch(x + 1, y - 1);
        if (near) b.set(x, y, z, 'marble');
      }
    }
  }

  // Sculpture groups on the four pillar faces: a marble frame around a group of figures in warm
  // stone, a tall central figure with a raised arm between two smaller ones, a winged figure above.
  const relief = (x0: number, z: number) => {
    const x1 = x0 + 8;
    for (let x = x0; x <= x1; x++) b.set(x, 6, z, 'marble').set(x, 19, z, 'marble');
    for (let y = 6; y <= 19; y++) b.set(x0, y, z, 'marble').set(x1, y, z, 'marble');
    const fig = 'sand';
    b.fill(x0 + 4, 7, z, x0 + 5, 13, z, fig).fill(x0 + 4, 14, z, x0 + 4, 15, z, fig); // central figure
    b.set(x0 + 6, 13, z, fig).set(x0 + 6, 14, z, fig).set(x0 + 7, 15, z, fig).set(x0 + 7, 16, z, fig); // raised arm
    b.fill(x0 + 2, 7, z, x0 + 2, 11, z, fig).set(x0 + 2, 12, z, fig).set(x0 + 3, 10, z, fig); // left figure
    b.fill(x0 + 7, 7, z, x0 + 7, 10, z, fig).set(x0 + 7, 11, z, fig); // right figure
    b.fill(x0 + 1, 17, z, x0 + 3, 17, z, fig).set(x0 + 2, 18, z, fig).set(x0 + 3, 16, z, fig); // winged figure
  };
  for (const z of [0, D - 1]) {
    relief(3, z);
    relief(W - 12, z);
  }

  // Relief panels above the arch on both faces, and on the short sides above the side arches.
  for (const z of [0, D - 1]) {
    for (const [x0, x1] of [[3, 13], [W - 14, W - 4]]) {
      b.walls(x0, 24, z, x1, 30, z, null);
      for (let x = x0; x <= x1; x++) b.set(x, 24, z, 'marble').set(x, 30, z, 'marble');
      for (let y = 24; y <= 30; y++) b.set(x0, y, z, 'marble').set(x1, y, z, 'marble');
      for (let x = x0 + 2; x <= x1 - 2; x += 2) b.fill(x, 26, z, x, x % 4 === 0 ? 28 : 27, z, 'sand'); // frieze of figures
    }
  }
  for (const x of [0, W - 1]) {
    for (let z = 3; z <= D - 4; z++) b.set(x, 22, z, 'marble').set(x, 29, z, 'marble');
    for (let y = 22; y <= 29; y++) b.set(x, y, 3, 'marble').set(x, y, D - 4, 'marble');
    for (let z = 5; z <= D - 6; z += 2) b.fill(x, 24, z, x, 27, z, 'sand');
  }

  // Shields along the attic on every face.
  for (let x = 3; x <= W - 4; x += 3) for (const z of [0, D - 1]) b.fill(x, 42, z, x, 43, z, 'marble');
  for (let z = 3; z <= D - 4; z += 3) for (const x of [0, W - 1]) b.fill(x, 42, z, x, 43, z, 'marble');

  // Tomb of the Unknown Soldier with its eternal flame under the arch.
  b.fill(CX - 1, 0, CZ - 1, CX + 1, 0, CZ + 1, 'marble');
  b.set(CX, 1, Math.floor(CZ), 'lantern');
  return b;
}
