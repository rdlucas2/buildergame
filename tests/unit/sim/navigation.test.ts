import { describe, expect, it } from 'vitest';
import { createPlacement, type Placement } from '../../../src/core/world';
import type { Structure } from '../../../src/core/structure';
import { Navigator, PREY_BODY, type Body } from '../../../src/sim/navigation';
import { SolidMap } from '../../../src/sim/solids';
import { cellIndex, generateTerrain } from '../../../src/sim/terrain';
import { makeStructure } from '../helpers';

function world(parts: Array<[Structure, Placement]>): Navigator {
  const byId = new Map(parts.map(([s]) => [s.id, s]));
  const solids = new SolidMap((id) => byId.get(id));
  solids.reset(parts.map(([, p]) => p));
  const terrain = generateTerrain(128, 1, { dryRadius: 0 });
  terrain.water.fill(0);
  return new Navigator(solids, terrain);
}

const block = (h: number, id: string) => makeStructure(id, { x: 1, y: h, z: 1 }, () => true, 'stone', id);

describe('movement rules', () => {
  it('stands on the ground and on top of blocks, never inside them', () => {
    const b1 = block(1, 'b1');
    const nav = world([[b1, createPlacement('b1', { x: 5, y: 0, z: 5 }, 0, 'p')]]);
    expect(nav.standable(0, 0, 0, PREY_BODY)).toBe(true);
    expect(nav.standable(5, 0, 5, PREY_BODY)).toBe(false);
    expect(nav.standable(5, 1, 5, PREY_BODY)).toBe(true);
    expect(nav.standable(0, 1, 0, PREY_BODY)).toBe(false); // floating
  });

  it('prey step up one block but not two, and drop up to three', () => {
    const nav = world([
      [block(1, 'b1'), createPlacement('b1', { x: 1, y: 0, z: 0 }, 0, 'one')],
      [block(2, 'b2'), createPlacement('b2', { x: 1, y: 0, z: 5 }, 0, 'two')],
      [block(4, 'b4'), createPlacement('b4', { x: 1, y: 0, z: 10 }, 0, 'four')],
      [block(3, 'b3'), createPlacement('b3', { x: 1, y: 0, z: 15 }, 0, 'three')],
    ]);
    expect(nav.landing(0, 0, 0, 1, 0, PREY_BODY)).toBe(1);
    expect(nav.landing(0, 0, 5, 1, 5, PREY_BODY)).toBeNull();
    expect(nav.landing(1, 4, 10, 2, 10, PREY_BODY)).toBeNull(); // 4-block drop is too far
    expect(nav.landing(1, 3, 15, 2, 15, PREY_BODY)).toBe(0); // 3-block drop is fine
    const leaper: Body = { height: 2, climb: 2, drop: 3 };
    expect(nav.landing(0, 0, 5, 1, 5, leaper)).toBe(2);
  });

  it('needs headroom to leap: an overhang above blocks climbing', () => {
    // A 1-high step at x=1, and a ceiling block at (0, 1, 0) right above the creature.
    const step = block(1, 'step');
    const ceiling = block(1, 'ceil');
    const nav = world([
      [step, createPlacement('step', { x: 1, y: 0, z: 0 }, 0, 's')],
      [ceiling, createPlacement('ceil', { x: 0, y: 1, z: 0 }, 0, 'c')],
    ]);
    expect(nav.standable(0, 0, 0, PREY_BODY)).toBe(true);
    expect(nav.landing(0, 0, 0, 1, 0, PREY_BODY)).toBeNull();
  });
});

describe('path finding', () => {
  // A 9-long, 2-high wall along x at z = 0, from x = -4 to 4.
  const wall = makeStructure('wall', { x: 9, y: 2, z: 1 }, () => true, 'stone', 'wall');

  it('walks around a wall it cannot climb', () => {
    const nav = world([[wall, createPlacement('wall', { x: -4, y: 0, z: 0 }, 0, 'w')]]);
    const path = nav.findPath({ x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 3 }, PREY_BODY)!;
    expect(path).not.toBeNull();
    expect(path.at(-1)).toMatchObject({ x: 0, z: 3 });
    expect(path.length).toBeGreaterThan(6);
    for (const c of path) expect(c.z === 0 && c.x >= -4 && c.x <= 4).toBe(false);
    expect(nav.straightOnGround({ x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 3 })).toBe(false);
    expect(nav.straightOnGround({ x: 10, y: 0, z: -3 }, { x: 10, y: 0, z: 3 })).toBe(true);
  });

  it('goes through a 1-wide doorway, and a sealed room is unreachable', () => {
    // 7×2×7 room with walls; door at the middle of the south wall, 1 wide and 1 high.
    const withDoor = makeStructure('room', { x: 7, y: 2, z: 7 }, (x, y, z) => {
      const wallCell = x === 0 || z === 0 || x === 6 || z === 6;
      if (!wallCell) return false;
      return !(z === 6 && x === 3 && y === 0);
    }, 'planks', 'room');
    const sealed = makeStructure('sealed', { x: 7, y: 2, z: 7 }, (x, _y, z) => x === 0 || z === 0 || x === 6 || z === 6, 'stone', 'sealed');
    const nav = world([
      [withDoor, createPlacement('room', { x: 0, y: 0, z: 0 }, 0, 'r')],
      [sealed, createPlacement('sealed', { x: 20, y: 0, z: 0 }, 0, 's')],
    ]);
    const inRoom = nav.findPath({ x: 3, y: 0, z: 10 }, { x: 3, y: 0, z: 3 }, PREY_BODY)!;
    expect(inRoom).not.toBeNull();
    expect(inRoom.some((c) => c.x === 3 && c.z === 6 && c.y === 0)).toBe(true); // through the door
    expect(nav.findPath({ x: 23, y: 0, z: 10 }, { x: 23, y: 0, z: 3 }, PREY_BODY, 3000)).toBeNull();
  });

  it('can wade across water but prefers dry land', () => {
    const nav = world([]);
    const t = nav.terrain;
    for (let x = -20; x <= 20; x++) t.water[cellIndex(128, x, 0)] = 1; // a stream from x=-20..20 across z=0
    const across = nav.findPath({ x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 2 }, PREY_BODY)!;
    expect(across).not.toBeNull();
    expect(across.filter((c) => nav.isWater(c.x, c.z)).length).toBe(1); // one step through the water
    // With a detour available nearby, a long water run is avoided.
    for (let z = -10; z <= 10; z++) t.water[cellIndex(128, 5, z)] = 1;
    const along = nav.findPath({ x: 5, y: 0, z: -10 }, { x: 5, y: 0, z: 10 }, PREY_BODY)!;
    expect(along.filter((c) => nav.isWater(c.x, c.z)).length).toBeLessThan(4);
  });
});
