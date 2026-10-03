import { describe, expect, it } from 'vitest';
import { expand, expansion } from '../../../src/sim/defense/advisor';
import { CORE_HP } from '../../../src/sim/defense/base';
import { BREED_PACE } from '../../../src/sim/defense/defense';
import { MAX_ROOM, MIN_ROOM, coreState, planStats, roomFor, starterPlan, type WarrenPlan } from '../../../src/sim/defense/design';
import { CORE } from '../../../src/sim/defense/materials';
import { MAX_STRENGTH } from '../../../src/sim/defense/unlocks';
import { SPECIES } from '../../../src/sim/creatures';
import { Ecosystem } from '../../../src/sim/ecosystem';

/** A square ring of stone `half` cells out from the middle, 3 high, around a core. */
function ringPlan(half: number, core = true): WarrenPlan {
  const blocks: WarrenPlan['blocks'] = [];
  const n = half * 2;
  for (let y = 0; y < 3; y++)
    for (let i = 0; i <= n; i++) {
      blocks.push({ x: i, y, z: 0, material: 'cobblestone' }, { x: i, y, z: n, material: 'cobblestone' });
      if (i > 0 && i < n) blocks.push({ x: 0, y, z: i, material: 'cobblestone' }, { x: n, y, z: i, material: 'cobblestone' });
    }
  if (core) for (let y = 0; y < 2; y++) for (const [x, z] of [[half, half], [half + 1, half], [half, half + 1], [half + 1, half + 1]]) blocks.push({ x, y, z, material: CORE });
  return { name: `Ring ${half}`, blocks };
}

describe('room for rabbits', () => {
  it('comes from the open ground the walls enclose, within limits', () => {
    expect(roomFor(0)).toBe(MIN_ROOM);
    expect(roomFor(165)).toBe(41);
    expect(roomFor(165, 3)).toBe(44);
    expect(roomFor(10_000)).toBe(MAX_ROOM);
  });

  it('grows with a bigger warren', () => {
    expect(planStats(ringPlan(10)).room).toBeGreaterThan(planStats(ringPlan(6)).room);
  });
});

describe('a warren design', () => {
  it('the starter warren is a playable design with one core and four posts', () => {
    const stats = planStats(starterPlan(), 700);
    expect(stats.core).toBe('ok');
    expect(stats.posts).toBe(4);
    expect(stats.room).toBe(41);
    expect(stats.problem).toBeNull();
  });

  it('needs exactly one core, a 2×2 block 2 high', () => {
    expect(planStats(ringPlan(6, false)).problem).toMatch(/no core/);
    const two = ringPlan(6);
    two.blocks.push(...two.blocks.filter((b) => b.material === CORE).map((b) => ({ ...b, x: b.x + 3 })));
    expect(coreState(two.blocks)).toBe('wrong');
    expect(planStats(two).problem).toMatch(/exactly one core/);
    const flat = ringPlan(6);
    flat.blocks = flat.blocks.filter((b) => !(b.material === CORE && b.y === 1));
    expect(coreState(flat.blocks)).toBe('wrong');
  });

  it('must fit the starting budget and the building area', () => {
    expect(planStats(ringPlan(6), 10).problem).toMatch(/costs \d+ budget; a round starts with 10/);
    expect(planStats(ringPlan(40)).problem).toMatch(/must fit/);
  });

  it('starts a round with the herd around its core and room from its walls', () => {
    const plan = ringPlan(10);
    const e = Ecosystem.create(512, 3, { defense: {}, warren: plan, design: { id: 'd1', name: plan.name } });
    const d = e.defense!;
    expect(d.base.coreCells()).toHaveLength(8);
    expect(d.base.coreHp).toBe(CORE_HP);
    expect(d.room).toBe(planStats(plan).room);
    expect(d.design?.name).toBe('Ring 10');
    const spot = d.coreSpot()!;
    const herd = e.population.creatures.filter((c) => c.species === 'prey');
    expect(herd.length).toBeGreaterThan(0);
    for (const c of herd) expect(Math.hypot(c.x - spot.x, c.z - spot.z)).toBeLessThan(8);
  });
});

describe('growing the warren', () => {
  it('a new ring of walls makes room for more rabbits and adds lookout posts', () => {
    const e = Ecosystem.create(512, 21, { defense: {} });
    const d = e.defense!;
    d.budget = 5000;
    const room = d.room;
    const posts = d.base.posts().length;
    const actions = expand(d, { option: 'expand-warren' })!;
    for (const a of actions) expect(d.apply(a).ok).toBe(true);
    expect(d.room).toBeGreaterThan(room + 20);
    expect(d.base.posts().length).toBeGreaterThan(posts + 10);
    expect(e.population.capOf('prey')).toBe(d.room);
  });

  it('leaves a 1-high rabbit gap in the middle of each side, like the starter warren', () => {
    const e = Ecosystem.create(512, 21, { defense: {} });
    const d = e.defense!;
    const f = d.base.footprint()!;
    const ring = expansion(d)!;
    const at = (x: number, y: number, z: number) => ring.some((b) => b.x === x && b.y === y && b.z === z);
    const [x0, z0, x1, z1] = [f.x0 - 4, f.z0 - 4, f.x1 + 4, f.z1 + 4];
    const mx = Math.floor((x0 + x1) / 2);
    const mz = Math.floor((z0 + z1) / 2);
    for (const [x, z] of [[mx, z0], [mx, z1], [x0, mz], [x1, mz]]) {
      expect(at(x, 0, z)).toBe(false);
      expect(at(x, 1, z)).toBe(true);
    }
    expect(at(mx + 1, 0, z0)).toBe(true);
  });

  it('room only changes when the player changes the walls, not when predators break them', () => {
    const e = Ecosystem.create(512, 21, { defense: {} });
    const d = e.defense!;
    const room = d.room;
    const f = d.base.footprint()!;
    for (let y = 0; y < 3; y++) for (let x = f.x0; x <= f.x1; x++) d.base.damage(x, y, f.z0, 1e6);
    e.advance(1);
    expect(d.room).toBe(room);
  });
});

describe('reinforcing the warren', () => {
  it('raises every wall tier and the core, for more points each time, up to a cap', () => {
    const e = Ecosystem.create(512, 21, { defense: {} });
    const d = e.defense!;
    d.points = 1e6;
    const first = d.reinforcePrice;
    expect(d.apply({ type: 'reinforce' }).ok).toBe(true);
    expect(d.base.reinforced).toBe(1);
    expect(d.base.coreMaxHp).toBe(Math.round(CORE_HP * 1.25));
    expect(d.reinforcePrice).toBeGreaterThan(first);
    while (Number.isFinite(d.reinforcePrice)) expect(d.apply({ type: 'reinforce' }).ok).toBe(true);
    expect(d.base.reinforced).toBe(MAX_STRENGTH);
    expect(d.apply({ type: 'reinforce' }).ok).toBe(false);
  });
});

describe('breeding in a warren', () => {
  it('the starting herd is ready to breed within the round, at the warren pace', () => {
    const e = Ecosystem.create(512, 21, { defense: {} });
    const herd = e.population.creatures.filter((c) => c.species === 'prey');
    for (const c of herd) expect(c.cooldown).toBeLessThanOrEqual((SPECIES.prey.breedCooldown * 0.6) / BREED_PACE);
  });
});
