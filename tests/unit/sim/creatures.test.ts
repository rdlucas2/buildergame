import { describe, expect, it } from 'vitest';
import { encodeWorld, decodeWorld } from '../../../src/core/format/world-file';
import type { Structure } from '../../../src/core/structure';
import { createPlacement, createWorld, type Placement } from '../../../src/core/world';
import { DAY_SECONDS, TICK_SECONDS, isNight } from '../../../src/sim/clock';
import { Population, SPECIES, pickCreature } from '../../../src/sim/creatures';
import { Ecosystem, STARTER_HERD } from '../../../src/sim/ecosystem';
import { Navigator } from '../../../src/sim/navigation';
import { Rng } from '../../../src/sim/rng';
import { ShoreIndex } from '../../../src/sim/shores';
import { SolidMap } from '../../../src/sim/solids';
import { cellIndex, generateTerrain } from '../../../src/sim/terrain';
import { Vegetation } from '../../../src/sim/vegetation';
import { makeStructure } from '../helpers';

/** A small flat test world: optional water along x = 10..12, and uniform grass. */
function lab(opts: { water?: boolean; grass?: number; seed?: number } = {}) {
  const size = 64;
  const terrain = generateTerrain(size, 1, { dryRadius: 0 });
  terrain.water.fill(0);
  if (opts.water) for (let z = -32; z < 32; z++) for (let x = 10; x <= 12; x++) terrain.water[cellIndex(size, x, z)] = 1;
  const veg = new Vegetation(terrain, new Uint8Array(size * size).fill(opts.grass ?? 0));
  const structures = new Map<string, Structure>();
  const solids = new SolidMap((id) => structures.get(id));
  const nav = new Navigator(solids, terrain);
  const pop = new Population(nav, veg, new ShoreIndex(terrain), new Rng(opts.seed ?? 7));
  let time = DAY_SECONDS * 0.4; // late morning
  const place = (s: Structure, p: Placement) => {
    structures.set(s.id, s);
    solids.add(p);
    veg.addPlacement(p, s);
    pop.worldChanged();
  };
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) {
      time += TICK_SECONDS;
      pop.tick(time);
    }
  };
  return { terrain, veg, solids, nav, pop, place, run, get time() { return time; } };
}

describe('a new wild world', () => {
  it('starts with a herd on dry land near water', () => {
    const e = Ecosystem.create(256, 42);
    const herd = e.population.creatures;
    expect(herd).toHaveLength(STARTER_HERD);
    for (const c of herd) {
      expect(c.species).toBe('prey');
      expect(c.y).toBe(0);
      expect(e.nav.isWater(Math.floor(c.x), Math.floor(c.z))).toBe(false);
      expect(e.shores.nearest(c.x, c.z, 20)).not.toBeNull();
    }
  });

  it('gives a world saved before creatures existed its starter herd once placements are known', () => {
    const e = Ecosystem.restore(256, { seed: 42, time: 1000 });
    expect(e.population.count()).toBe(0);
    e.setPlacements([], () => undefined);
    expect(e.population.count()).toBe(STARTER_HERD);
    // An empty saved population stays empty (everyone died): no surprise herd.
    const empty = Ecosystem.restore(256, { seed: 42, time: 1000, creatures: [] });
    empty.setPlacements([], () => undefined);
    empty.advance(1);
    expect(empty.population.count()).toBe(0);
  });

  it('is reproducible: the same seed gives exactly the same creatures', () => {
    const a = Ecosystem.create(256, 9);
    const b = Ecosystem.create(256, 9);
    a.advance(300);
    b.advance(300);
    expect(JSON.stringify(a.snapshot().creatures)).toBe(JSON.stringify(b.snapshot().creatures));
    expect(a.rng.seedState).toBe(b.rng.seedState);
    const c = Ecosystem.create(256, 10);
    c.advance(300);
    expect(JSON.stringify(c.snapshot().creatures)).not.toBe(JSON.stringify(a.snapshot().creatures));
  });
});

describe('needs', () => {
  it('a thirsty rabbit walks to water and drinks', () => {
    const w = lab({ water: true, grass: 120 });
    const c = w.pop.spawn('prey', -10, 0, 0, { hydration: 0.2, satiety: 0.9 });
    let best = 0;
    for (let i = 0; i < 60; i++) {
      w.run(1);
      best = Math.max(best, c.hydration);
    }
    expect(best).toBeGreaterThan(0.95);
    expect(c.deadFor).toBe(-1);
  });

  it('a hungry rabbit grazes, and grazing eats the grass', () => {
    const w = lab({ water: true, grass: 200 });
    const c = w.pop.spawn('prey', 0, 0, 0, { satiety: 0.2, hydration: 0.9 });
    w.run(20);
    expect(c.satiety).toBeGreaterThan(0.6);
    let eaten = 0;
    for (let z = -8; z <= 8; z++) for (let x = -8; x <= 8; x++) eaten += 200 - w.veg.biomassAt(x, z);
    expect(eaten).toBeGreaterThan(100);
  });

  it('without water a rabbit dies of thirst, and its body is removed after a moment', () => {
    const w = lab({ water: false, grass: 200 });
    w.pop.spawn('prey', 0, 0, 0, { hydration: 0.1, satiety: 1 });
    w.run(120);
    expect(w.pop.tally.thirst).toBe(1);
    expect(w.pop.count()).toBe(0);
    w.run(5);
    expect(w.pop.creatures).toHaveLength(0);
  });

  it('without grass a rabbit starves', () => {
    const w = lab({ water: true, grass: 0 });
    w.pop.spawn('prey', 5, 0, 0, { hydration: 1, satiety: 0.05 });
    w.run(90);
    expect(w.pop.tally.hunger).toBe(1);
  });

  it('rabbits die of old age', () => {
    const w = lab({ water: true, grass: 200 });
    w.pop.spawn('prey', 0, 0, 0, { age: SPECIES.prey.lifespan * 1.3 });
    w.run(TICK_SECONDS);
    expect(w.pop.tally.age).toBe(1);
  });
});

describe('breeding', () => {
  const ready = { satiety: 1, hydration: 1, health: 1, cooldown: 0, age: SPECIES.prey.maturity * 2 };

  it('needs a mate nearby', () => {
    const alone = lab({ water: true, grass: 255, seed: 3 });
    alone.pop.spawn('prey', 5, 0, 0, ready);
    alone.run(240);
    expect(alone.pop.tally.born).toBe(0);

    const pair = lab({ water: true, grass: 255, seed: 3 });
    pair.pop.spawn('prey', 5, 0, 0, ready);
    pair.pop.spawn('prey', 6, 0, 1, ready);
    pair.run(240);
    expect(pair.pop.tally.born).toBeGreaterThan(0);
    expect(pair.pop.count()).toBe(2 + pair.pop.tally.born);
  });

  it('never goes past the population cap', () => {
    const w = lab({ water: true, grass: 255 });
    const cap = SPECIES.prey.cap;
    for (let i = 0; i < cap - 2; i++) w.pop.spawn('prey', (i % 20) - 20, 0, Math.floor(i / 20) - 8, ready);
    w.run(120);
    expect(w.pop.count()).toBeLessThanOrEqual(cap);
  });
});

describe('structures', () => {
  it('a block placed on a rabbit lifts it on top, and a tall one moves it aside', () => {
    const w = lab({ water: true, grass: 100 });
    const a = w.pop.spawn('prey', 0, 0, 0);
    const b = w.pop.spawn('prey', 20, 0, 5);
    w.place(makeStructure('one', { x: 1, y: 1, z: 1 }, () => true, 'stone', 'one'), createPlacement('one', { x: 0, y: 0, z: 0 }, 0, 'p1'));
    w.place(makeStructure('tall', { x: 1, y: 9, z: 1 }, () => true, 'stone', 'tall'), createPlacement('tall', { x: 20, y: 0, z: 5 }, 0, 'p2'));
    w.run(TICK_SECONDS);
    expect(a.y).toBe(1);
    expect(w.nav.standable(Math.floor(a.x), a.y, Math.floor(a.z), SPECIES.prey.body)).toBe(true);
    expect(w.nav.standable(Math.floor(b.x), b.y, Math.floor(b.z), SPECIES.prey.body)).toBe(true);
    expect(Math.floor(b.x) !== 20 || Math.floor(b.z) !== 5).toBe(true);
  });

  it('at night rabbits sleep under a nearby roof', () => {
    const e = Ecosystem.create(256, 42);
    const herd = e.population.creatures;
    const cx = Math.round(herd.reduce((s, c) => s + c.x, 0) / herd.length);
    const cz = Math.round(herd.reduce((s, c) => s + c.z, 0) / herd.length);
    // A 9×9 roof on four corner posts, 2 blocks up: open on every side.
    const shelter = makeStructure('shelter', { x: 9, y: 3, z: 9 }, (x, y, z) => y === 2 || ((x === 0 || x === 8) && (z === 0 || z === 8)), 'planks', 'shelter');
    const p = createPlacement('shelter', { x: cx - 4, y: 0, z: cz - 4 }, 0, 'roof');
    e.setPlacements([p], (id) => (id === 'shelter' ? shelter : undefined));
    // Run to the middle of the first night.
    while (!isNight(e.time)) e.advance(10);
    e.advance(60);
    const sleeping = e.population.creatures.filter((c) => c.deadFor < 0 && c.activity === 'rest');
    const underRoof = sleeping.filter((c) => e.vegetation.cover[cellIndex(e.size, Math.floor(c.x), Math.floor(c.z))] > 0);
    expect(sleeping.length).toBeGreaterThan(STARTER_HERD / 2);
    expect(underRoof.length).toBeGreaterThan(sleeping.length / 2);
  });
});

describe('saving', () => {
  it('round-trips creatures, the random stream and the history through a world file', () => {
    const e = Ecosystem.create(256, 5);
    e.advance(200);
    const world = createWorld({ name: 'Wild', ground: { material: 'grass', size: 256 }, ecosystem: e.snapshot() });
    const file = JSON.parse(JSON.stringify(encodeWorld(world, () => undefined)));
    expect(file.version).toBe(2);
    const back = decodeWorld(file).world.ecosystem!;
    const r = Ecosystem.restore(256, back);
    expect(r.population.count()).toBe(e.population.count());
    expect(r.population.nextId).toBe(e.population.nextId);
    expect(r.rng.seedState).toBe(e.rng.seedState);
    expect(r.population.tally).toEqual(e.population.tally);
    expect(r.population.history).toEqual(e.population.history);
    const [a, b] = [e.population.creatures[0], r.population.creatures[0]];
    expect(b.id).toBe(a.id);
    expect(b.x).toBeCloseTo(a.x, 2);
    expect(b.hydration).toBeCloseTo(a.hydration, 2);
  });

  it('a reloaded world carries on deterministically', () => {
    const e = Ecosystem.create(256, 11);
    e.advance(120);
    const saved = e.snapshot();
    const a = Ecosystem.restore(256, saved);
    const b = Ecosystem.restore(256, saved);
    a.advance(200);
    b.advance(200);
    expect(JSON.stringify(a.snapshot().creatures)).toBe(JSON.stringify(b.snapshot().creatures));
  });

  it('rejects creature data that is out of range or duplicated', () => {
    const e = Ecosystem.create(256, 5);
    const world = createWorld({ name: 'Wild', ground: { material: 'grass', size: 256 }, ecosystem: e.snapshot() });
    const file = JSON.parse(JSON.stringify(encodeWorld(world, () => undefined)));
    const bad = structuredClone(file);
    bad.ecosystem.creatures[0].satiety = 3;
    expect(() => decodeWorld(bad)).toThrow(/satiety/);
    const dup = structuredClone(file);
    dup.ecosystem.creatures[1].id = dup.ecosystem.creatures[0].id;
    expect(() => decodeWorld(dup)).toThrow(/duplicate creature id/);
  });
});

describe('releasing and picking', () => {
  it('releases rabbits on dry ground, up to the cap', () => {
    const e = Ecosystem.create(256, 42);
    const n = e.release('prey', 0, 0, 5);
    expect(n).toBe(5);
    expect(e.population.count('prey')).toBe(STARTER_HERD + 5);
    e.release('prey', 0, 0, 1000, 60);
    expect(e.population.count('prey')).toBe(SPECIES.prey.cap);
    expect(e.release('prey', 0, 0, 5)).toBe(0);
    for (const c of e.population.creatures) expect(e.nav.isWater(Math.floor(c.x), Math.floor(c.z))).toBe(false);
  });

  it('picks the nearest living creature along a ray', () => {
    const w = lab();
    const near = w.pop.spawn('prey', 0, 0, -5);
    w.pop.spawn('prey', 0, 0, -10);
    const origin = { x: 0.5, y: 0.4, z: 0 };
    const dir = { x: 0, y: 0, z: -1 };
    expect(pickCreature(w.pop.creatures, origin, dir, 64)?.creature).toBe(near);
    expect(pickCreature(w.pop.creatures, origin, dir, 3)).toBeNull();
    expect(pickCreature(w.pop.creatures, origin, { x: 1, y: 0, z: 0 }, 64)).toBeNull();
  });
});
