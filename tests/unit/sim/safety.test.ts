import { describe, expect, it } from 'vitest';
import type { Structure } from '../../../src/core/structure';
import { createPlacement } from '../../../src/core/world';
import { Navigator, PREDATOR_BODY, PREY_BODY } from '../../../src/sim/navigation';
import { SafetyMap } from '../../../src/sim/safety';
import { PREDATOR_SENSES, PREY_SENSES, lineOfSight, notices } from '../../../src/sim/senses';
import { SolidMap } from '../../../src/sim/solids';
import { generateTerrain } from '../../../src/sim/terrain';
import { EXAMPLES, buildExample } from '../../../src/examples';
import { makeStructure } from '../helpers';

/** A 7×7 pen with walls `height` high and a door `door` high in the middle of the z = 0 wall. */
function pen(height: number, door: number, id = 'pen'): Structure {
  return makeStructure(id, { x: 7, y: height, z: 7 }, (x, y, z) => {
    const wall = x === 0 || x === 6 || z === 0 || z === 6;
    const doorway = x === 3 && z === 0 && y < door;
    return wall && !doorway;
  }, 'stone', id);
}

function setup(structures: Structure[], at = { x: 0, y: 0, z: 0 }) {
  const byId = new Map(structures.map((s) => [s.id, s]));
  const solids = new SolidMap((id) => byId.get(id));
  solids.reset(structures.map((s, i) => createPlacement(s.id, { x: at.x + i * 40, y: at.y, z: at.z }, 0, `p${i}`)));
  const terrain = generateTerrain(128, 1, { dryRadius: 0 });
  terrain.water.fill(0);
  const nav = new Navigator(solids, terrain);
  return { solids, nav, safety: new SafetyMap(nav) };
}

describe('predator movement', () => {
  it('cannot pass a 1-high gap or leap a 3-high wall, but leaps a 2-high one', () => {
    const { nav } = setup([pen(3, 1)]);
    // From outside the door, the predator cannot get into the pen; the rabbit can.
    expect(nav.findPath({ x: 3, y: 0, z: -3 }, { x: 3, y: 0, z: 3 }, PREDATOR_BODY, 3000)).toBeNull();
    expect(nav.findPath({ x: 3, y: 0, z: -3 }, { x: 3, y: 0, z: 3 }, PREY_BODY, 3000)).not.toBeNull();
    const low = setup([pen(2, 0, 'low')]);
    expect(low.nav.findPath({ x: 3, y: 0, z: -3 }, { x: 3, y: 0, z: 3 }, PREDATOR_BODY, 3000)).not.toBeNull();
    expect(low.nav.findPath({ x: 3, y: 0, z: -3 }, { x: 3, y: 0, z: 3 }, PREY_BODY, 3000)).toBeNull();
  });
});

describe('safety map', () => {
  it('a pen with 3-high walls and a 1-high door is safe inside', () => {
    const { safety } = setup([pen(3, 1)]);
    expect(safety.isSafe(3, 0, 3)).toBe(true);
    expect(safety.isSafe(1, 0, 1)).toBe(true);
    // The doorway itself is within a predator's reach from outside.
    expect(safety.isSafe(3, 0, 0)).toBe(false);
    // Outside the pen, and open ground far away, are not safe.
    expect(safety.isSafe(3, 0, -2)).toBe(false);
    expect(safety.isSafe(50, 0, 50)).toBe(false);
    const cells = safety.safeCells();
    expect(cells.length).toBe(5 * 5);
    expect(safety.nearestSafe(3, 0, -6, 12)).toEqual({ x: 3, y: 0, z: 1 });
  });

  it('a 2-high enclosure or a 2-high door is not safe', () => {
    expect(setup([pen(2, 1, 'low')]).safety.isSafe(3, 0, 3)).toBe(false);
    expect(setup([pen(4, 2, 'tall-door')]).safety.isSafe(3, 0, 3)).toBe(false);
  });

  it('updates when structures change', () => {
    const { solids, safety } = setup([pen(3, 1)]);
    expect(safety.isSafe(3, 0, 3)).toBe(true);
    const v = safety.version;
    solids.remove('p0');
    safety.invalidate();
    expect(safety.isSafe(3, 0, 3)).toBe(false);
    expect(safety.regionCount).toBe(0);
    expect(safety.version).toBeGreaterThan(v);
  });

  it('keeps separate structures as separate regions and merges close ones', () => {
    const far = setup([pen(3, 1, 'a'), pen(3, 1, 'b')]); // placed 40 apart
    expect(far.safety.regionCount).toBe(2);
    const byId = new Map([pen(3, 1, 'a'), pen(3, 1, 'b')].map((s) => [s.id, s]));
    const solids = new SolidMap((id) => byId.get(id));
    solids.reset([createPlacement('a', { x: 0, y: 0, z: 0 }, 0, 'a'), createPlacement('b', { x: 12, y: 0, z: 0 }, 0, 'b')]);
    const terrain = generateTerrain(128, 1, { dryRadius: 0 });
    terrain.water.fill(0);
    const near = new SafetyMap(new Navigator(solids, terrain));
    expect(near.regionCount).toBe(1);
    expect(near.isSafe(3, 0, 3)).toBe(true);
    expect(near.isSafe(15, 0, 3)).toBe(true);
  });
});

describe('senses', () => {
  it('walls block line of sight', () => {
    const { solids } = setup([pen(3, 1)]);
    expect(lineOfSight(solids, 1.5, 1.4, -5, 1.5, 0.5, 3.5)).toBe(false); // through the wall
    expect(lineOfSight(solids, 3.5, 1.4, -5, 3.5, 0.5, 3.5)).toBe(true); // through the doorway
    expect(lineOfSight(solids, -5, 1.4, -5, 20, 0.5, -5)).toBe(true);
  });

  it('predators see ahead but not behind; prey also hear what comes close', () => {
    const { solids } = setup([]);
    const wolf = { x: 0.5, y: 0, z: 0.5, heading: 0 }; // facing +z
    expect(notices(solids, wolf, PREDATOR_SENSES, 0.5, 0, 15.5, 0.4)).toBe(true);
    expect(notices(solids, wolf, PREDATOR_SENSES, 0.5, 0, -15.5, 0.4)).toBe(false); // behind
    expect(notices(solids, wolf, PREDATOR_SENSES, 0.5, 0, 30.5, 0.4)).toBe(false); // too far
    const rabbit = { x: 0.5, y: 0, z: 0.5, heading: 0 };
    expect(notices(solids, rabbit, PREY_SENSES, 0.5, 0, -10.5, 1)).toBe(false); // right behind: the blind spot
    expect(notices(solids, rabbit, PREY_SENSES, 0.5, 0, -3.5, 1)).toBe(true); // heard
    const walled = setup([pen(3, 1)]);
    const inside = { x: 3.5, y: 0, z: 3.5, heading: Math.PI }; // facing the door (-z)
    expect(notices(walled.solids, inside, PREY_SENSES, 3.5, 0, -8.5, 1)).toBe(true); // seen through the doorway
    expect(notices(walled.solids, inside, PREY_SENSES, 12.5, 0, 3.5, 1)).toBe(false); // wall in the way
  });
});

describe('the Rabbit Warren example', () => {
  it('is safe inside, grows grass (open sky except the den) and lets rabbits in through every gap', () => {
    const warren = buildExample(EXAMPLES.find((e) => e.id === 'example-rabbit-warren')!);
    const { nav, safety } = setup([warren]);
    // Every interior cell except those next to a gap.
    let safe = 0;
    for (let z = 1; z <= 11; z++) for (let x = 1; x <= 11; x++) if (safety.isSafe(x, 0, z)) safe++;
    expect(safe).toBeGreaterThan(100);
    expect(safety.isSafe(6, 0, 6)).toBe(true);
    expect(safety.isSafe(6, 0, 0)).toBe(false); // standing in a gap is within a wolf's reach
    for (const [x, z] of [[6, -3], [6, 15], [-3, 6], [15, 6]]) {
      expect(nav.findPath({ x, y: 0, z }, { x: 6, y: 0, z: 6 }, PREY_BODY, 3000)).not.toBeNull();
      expect(nav.findPath({ x, y: 0, z }, { x: 6, y: 0, z: 6 }, PREDATOR_BODY, 3000)).toBeNull();
    }
  });
});
