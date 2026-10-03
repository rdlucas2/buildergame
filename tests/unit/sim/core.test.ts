import { describe, expect, it } from 'vitest';
import { decodeWorld, encodeWorld } from '../../../src/core/format/world-file';
import { createWorld } from '../../../src/core/world';
import { makeHawk } from '../../../src/sim/defense/hawk';
import { CORE_HP } from '../../../src/sim/defense/base';
import { CORE } from '../../../src/sim/defense/materials';
import { WAVE_BUDGET, WAVE_BUDGET_GROWTH } from '../../../src/sim/defense/defense';
import { Ecosystem } from '../../../src/sim/ecosystem';
import { cellIndex } from '../../../src/sim/terrain';

const round = (seed = 21) => Ecosystem.create(512, seed, { defense: {} });

/** Only defenders are left: every breeder is taken out. */
function noBreeders(e: Ecosystem): void {
  const d = e.defense!;
  d.apply({ type: 'allocate', defenders: 6 });
  for (const c of e.population.creatures) if (c.species === 'prey' && c.deadFor < 0 && c.role !== 'defender') e.population.damage(c, 1000, { cause: 'eaten' });
  expect(d.breedersLeft()).toBe(false);
}

describe('the warren core', () => {
  it('sits in the middle of the starter warren, can not be built or removed, and costs nothing', () => {
    const e = round();
    const d = e.defense!;
    const cells = d.base.coreCells();
    expect(cells).toHaveLength(8);
    const xs = cells.map((c) => c.x);
    expect(Math.min(...xs)).toBe(d.site.x);
    expect(d.base.coreMaxHp).toBe(CORE_HP);
    const c = cells[0];
    expect(d.apply({ type: 'remove', ...c }).ok).toBe(false);
    expect(d.apply({ type: 'place', x: d.site.x + 3, y: 0, z: d.site.z + 3, material: CORE }).ok).toBe(false);
    expect(d.apply({ type: 'placeMany', blocks: [{ x: d.site.x + 3, y: 0, z: d.site.z + 3, material: CORE }] }).ok).toBe(false);
    const before = d.base.cost();
    d.base.set(d.site.x + 4, 5, d.site.z + 4, CORE);
    expect(d.base.cost()).toBe(before);
  });

  it('gets tougher with the wall upgrades', () => {
    const e = Ecosystem.create(512, 21, { defense: { blockHp: 1.5 } });
    expect(e.defense!.base.coreMaxHp).toBe(Math.round(CORE_HP * 1.5));
  });

  it('is repaired with the rest of the warren, and its damage is saved', () => {
    const e = round();
    const d = e.defense!;
    const [c] = d.base.coreCells();
    d.base.damage(c.x, c.y, c.z, 400);
    expect(d.base.coreHp).toBe(CORE_HP - 400);
    expect(d.repairPrice).toBe(100);
    const world = createWorld({ name: 'Core', ground: { material: 'grass', size: 512 }, ecosystem: e.snapshot() });
    const back = Ecosystem.restore(512, decodeWorld(JSON.parse(JSON.stringify(encodeWorld(world, () => undefined)))).world.ecosystem!);
    expect(back.defense!.base.coreHp).toBe(CORE_HP - 400);
    d.points = 60;
    expect(d.apply({ type: 'repair' }).ok).toBe(true);
    expect(d.base.coreHp).toBe(CORE_HP - 400 + 240);
    expect(d.points).toBe(0);
  });

  it('is added to a round saved before warrens had one', () => {
    const e = round();
    const state = e.snapshot();
    const base = state.defense!.base;
    const slot = base.palette.indexOf(CORE) + 1;
    for (let i = 0; i < base.voxels.length; i++) if (base.voxels[i] === slot) base.voxels[i] = 0;
    const back = Ecosystem.restore(512, state);
    expect(back.defense!.base.coreCells()).toHaveLength(8);
  });

  it('predators go for breeders first, and for the core once there are none', () => {
    const e = round(5);
    const d = e.defense!;
    const pop = e.population;
    // Too tough for the defenders to stop in time.
    const wolf = pop.spawnKind('wolf', d.site.x + 20, 0, d.site.z, { maxHp: 1e6 });
    e.advance(2);
    const target = pop.get(wolf.target);
    expect(target?.species).toBe('prey');
    expect(target?.role).not.toBe('defender');
    expect(d.base.coreHp).toBe(CORE_HP);

    noBreeders(e);
    const before = d.base.coreHp;
    for (let i = 0; i < 60 && d.base.coreHp === before; i++) e.advance(1);
    expect(d.base.coreHp).toBeLessThan(before);
    expect(d.outcome).toBe('playing');

    // A defender stood down is a breeder again: the wolf leaves the core for it.
    expect(d.apply({ type: 'allocate', defenders: 5 }).ok).toBe(true);
    expect(d.breedersLeft()).toBe(true);
    e.advance(0.5);
    expect(pop.get(wolf.target)?.role).toBe('breeder');
  });

  it('takes no harm while any breeder is alive, even from a bear smashing the wall beside it', () => {
    const e = round();
    const d = e.defense!;
    const [c] = d.base.coreCells();
    const bear = e.population.spawnKind('bear', c.x - 1, 0, c.z - 1, {});
    expect(d.breedersLeft()).toBe(true);
    d.chew(bear, c.x, c.y, c.z, 500);
    d.chew(bear, c.x - 1, c.y, c.z, 500);
    expect(d.base.coreHp).toBe(CORE_HP);
    noBreeders(e);
    d.chew(bear, c.x, c.y, c.z, 500);
    expect(d.base.coreHp).toBeLessThan(CORE_HP);
  });

  it('hawks dive at an open core when no breeders are left, and not at a roofed one', () => {
    const e = round(6);
    const d = e.defense!;
    const pop = e.population;
    noBreeders(e);
    // Defenders out of reach: no rabbit to strike.
    for (const c of pop.creatures) if (c.species === 'prey') pop.damage(c, 1000, { cause: 'age' });
    const spot = d.coreSpot()!;
    const hawk = pop.spawnKind('hawk', Math.floor(spot.x) + 8, 10, Math.floor(spot.z), {});
    const brain = makeHawk(d);
    brain.decide(pop, hawk, { night: false, time: 0 } as never);
    expect(hawk.target).toBe(-2);
    e.advance(20);
    expect(d.base.coreHp).toBeLessThan(CORE_HP);
    // Roof it over: the hawk can't get at it.
    const hp = d.base.coreHp;
    for (let x = -1; x <= 2; x++) for (let z = -1; z <= 2; z++) d.base.set(Math.floor(spot.x) - 1 + x, spot.top + 1, Math.floor(spot.z) - 1 + z, 'planks');
    e.advance(15);
    expect(d.base.coreHp).toBe(hp);
  });
});

describe('a warren without water', () => {
  it('rabbits never get thirsty in a defense round, but still do in a wild world', () => {
    const e = round();
    e.advance(400);
    const rabbits = e.population.creatures.filter((c) => c.species === 'prey' && c.deadFor < 0);
    expect(rabbits.length).toBeGreaterThan(0);
    expect(rabbits.every((c) => c.hydration === 1)).toBe(true);
    expect(e.population.tally.thirst).toBe(0);
    expect(e.population.creatures.some((c) => c.activity === 'drink' || c.activity === 'seekWater')).toBe(false);
    const wild = Ecosystem.create(256, 21);
    wild.advance(60);
    expect(wild.population.creatures.some((c) => c.species === 'prey' && c.hydration < 1)).toBe(true);
  });

  it('builds the warren on dry ground near the middle, wherever the water is', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const e = round(seed);
      const { site } = e.defense!;
      for (let z = site.z - 9; z <= site.z + 9; z++)
        for (let x = site.x - 9; x <= site.x + 9; x++) expect(e.terrain.water[cellIndex(e.terrain.size, x, z)]).toBe(0);
      expect(Math.hypot(site.x, site.z)).toBeLessThan(80);
    }
  });
});

describe('the block budget', () => {
  it('grows with every wave', () => {
    const e = round();
    const d = e.defense!;
    const start = d.budget;
    d.nextWaveAt = d.clock;
    e.advance(0.2);
    expect(d.wave).toBe(1);
    expect(d.budget).toBe(start + WAVE_BUDGET);
    const ev = d.events.filter((x) => x.kind === 'wave').pop();
    expect(ev && ev.kind === 'wave' && ev.budget).toBe(WAVE_BUDGET);
    d.nextWaveAt = d.clock;
    e.advance(0.2);
    expect(d.budget).toBe(start + WAVE_BUDGET * 2 + WAVE_BUDGET_GROWTH);
  });
});
