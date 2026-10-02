import { describe, expect, it } from 'vitest';
import { decodeWorld, encodeWorld } from '../../../src/core/format/world-file';
import { createWorld } from '../../../src/core/world';
import { KINDS, Population, atHome, decidePrey } from '../../../src/sim/creatures';
import { DefenseBase } from '../../../src/sim/defense/base';
import { Combat } from '../../../src/sim/defense/combat';
import { BreachField, SolidSnapshot } from '../../../src/sim/defense/field';
import { blockHp } from '../../../src/sim/defense/materials';
import { OVERTIME_START, WAVE_INTERVAL, hpScale, kindWeights, overtime, planWave, threatBudget } from '../../../src/sim/defense/waves';
import { WEAPONS } from '../../../src/sim/defense/weapons';
import { Ecosystem } from '../../../src/sim/ecosystem';
import { Navigator, type BreachCell, type BreachCost } from '../../../src/sim/navigation';
import { Rng } from '../../../src/sim/rng';
import { SafetyMap } from '../../../src/sim/safety';
import { ShoreIndex } from '../../../src/sim/shores';
import { SolidMap } from '../../../src/sim/solids';
import { generateTerrain } from '../../../src/sim/terrain';
import { Vegetation } from '../../../src/sim/vegetation';

/** A flat, dry test world with a defense base whose corner is at (-24, -24). */
function lab() {
  const terrain = generateTerrain(128, 1, { dryRadius: 0 });
  terrain.water.fill(0);
  const solids = new SolidMap(() => undefined);
  const base = new DefenseBase({ origin: { x: -24, z: -24 } });
  solids.setBase(base);
  const nav = new Navigator(solids, terrain);
  const veg = new Vegetation(terrain, new Uint8Array(128 * 128).fill(100));
  const pop = new Population(nav, veg, new ShoreIndex(terrain), new Rng(3), new SafetyMap(nav));
  return { terrain, solids, base, nav, pop };
}

/** A 7×7 pen of `material` walls 3 high around (0, 0), with a 1-high gap at (0, -3). */
function pen(base: DefenseBase, material = 'cobblestone') {
  for (let y = 0; y < 3; y++)
    for (let i = -3; i <= 3; i++) {
      base.set(i, y, -3, material);
      base.set(i, y, 3, material);
      base.set(-3, y, i, material);
      base.set(3, y, i, material);
    }
  base.set(0, 0, -3, null);
}

type Lab = ReturnType<typeof lab>;

const breachFor = (base: DefenseBase, rate: number, speed: number): BreachCost => (x, y, z) => (base.solidAt(x, y, z) ? (base.hpAt(x, y, z) / rate) * speed : null);

describe('warren blocks', () => {
  it('take damage, break, and free their budget', () => {
    const base = new DefenseBase({ origin: { x: 0, z: 0 } });
    base.set(5, 0, 5, 'planks');
    base.set(6, 0, 5, 'iron');
    expect(base.cost()).toBe(2 + 8);
    expect(base.hpAt(5, 0, 5)).toBe(25);
    expect(base.damage(5, 0, 5, 10)).toBe('damaged');
    expect(base.hpAt(5, 0, 5)).toBe(15);
    expect(base.wearAt(5, 0, 5)).toBeCloseTo(0.4);
    // Slow chewing still adds up (damage is kept in tenths of a hit point).
    for (let i = 0; i < 10; i++) base.damage(5, 0, 5, 0.3);
    expect(base.hpAt(5, 0, 5)).toBeCloseTo(12);
    expect(base.damage(5, 0, 5, 100)).toBe('broken');
    expect(base.solidAt(5, 0, 5)).toBe(false);
    expect(base.cost()).toBe(8);
  });

  it('get tougher with strength levels and the hit-point multiplier', () => {
    expect(blockHp('cobblestone')).toBe(60);
    expect(blockHp('cobblestone', [0, 0, 2])).toBe(90);
    expect(blockHp('cobblestone', [], 1.5)).toBe(90);
    expect(blockHp('red')).toBe(10); // anything unlisted is soft
  });

  it('have posts on top of lookout blocks with room above', () => {
    const base = new DefenseBase({ origin: { x: 0, z: 0 } });
    base.set(3, 2, 3, 'lookout');
    base.set(8, 0, 8, 'lookout');
    base.set(8, 1, 8, 'stone'); // covered: not a post
    expect(base.posts()).toEqual([{ x: 3, y: 3, z: 3 }]);
  });
});

describe('breaking in', () => {
  it('a predator plans through the weakest stretch of wall', () => {
    const { base, nav } = lab();
    pen(base, 'iron');
    base.set(0, 0, -3, 'iron'); // close the gap
    for (let y = 0; y < 3; y++) base.set(3, y, 0, 'planks'); // one weak column on the east side
    const wolf = KINDS.wolf;
    const path = nav.findPath({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, wolf.body, 4000, undefined, breachFor(base, wolf.blockDamage, wolf.speed));
    expect(path).not.toBeNull();
    const breaches = path!.filter((c) => c.breach);
    expect(breaches).toEqual([{ x: 3, y: 0, z: 0, breach: true }]);
  });

  it('a fox slips through a 1-high gap, but a badger is too bulky and digs in', () => {
    const { base, nav } = lab();
    pen(base);
    const fox = KINDS.fox;
    const badger = KINDS.badger;
    const foxPath = nav.findPath({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 }, fox.body, 4000, undefined, breachFor(base, fox.blockDamage, fox.speed));
    expect(foxPath).not.toBeNull();
    expect(foxPath!.some((c) => c.breach)).toBe(false);
    // Without breaking blocks the badger can't get in at all...
    expect(nav.findPath({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 }, badger.body, 4000)).toBeNull();
    // ...so it plans to dig, through the doorway's lintel or a wall.
    const badgerPath = nav.findPath({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 }, badger.body, 4000, undefined, breachFor(base, badger.blockDamage, badger.speed));
    expect(badgerPath).not.toBeNull();
    expect(badgerPath!.some((c) => c.breach)).toBe(true);
  });
});

describe('breach fields', () => {
  /** A field for one kind over the lab's base, with a rabbit at (0, 0) inside the pen. */
  const fieldFor = (l: Lab, kind: 'wolf' | 'fox' | 'badger') => {
    const def = KINDS[kind];
    const snap = new SolidSnapshot(l.solids, -36, -36, 72, 72, 19);
    return new BreachField(snap, snap.navigator(l.terrain), def.body, breachFor(l.base, def.blockDamage, def.speed), [{ x: 0, y: 0, z: 0 }]);
  };
  /** Follows a field from `start` until it breaks in or arrives, as a predator would. */
  const walk = (l: Lab, field: BreachField, start: BreachCell) => {
    const out: BreachCell[] = [];
    let at = start;
    for (let i = 0; i < 20; i++) {
      const steps = field.descend(l.nav, at, 10);
      if (steps.length === 0) break;
      out.push(...steps);
      at = steps[steps.length - 1];
      if (at.breach) break;
    }
    return out;
  };

  it('lead a pack from any side to the weakest stretch of wall', () => {
    const l = lab();
    pen(l.base, 'iron');
    l.base.set(0, 0, -3, 'iron');
    for (let y = 0; y < 3; y++) l.base.set(3, y, 0, 'planks'); // weak on the east
    const field = fieldFor(l, 'wolf');
    expect(field.at(0, 0, 0)).toBe(0);
    for (const start of [{ x: 12, y: 0, z: 0 }, { x: -12, y: 0, z: 5 }, { x: 0, y: 0, z: -14 }]) {
      const path = walk(l, field, start);
      expect(path[path.length - 1], `from ${JSON.stringify(start)}`).toEqual({ x: 3, y: 0, z: 0, breach: true });
    }
  });

  it('send foxes through the gap and badgers through the wall', () => {
    const l = lab();
    pen(l.base);
    const fox = walk(l, fieldFor(l, 'fox'), { x: 0, y: 0, z: -12 });
    expect(fox.some((c) => c.breach)).toBe(false);
    expect(fox[fox.length - 1]).toMatchObject({ x: 0, z: 0 });
    const badger = walk(l, fieldFor(l, 'badger'), { x: 0, y: 0, z: -12 });
    expect(badger[badger.length - 1].breach).toBe(true);
  });

  it('are shared by a whole wave and stay cheap', () => {
    const e = Ecosystem.create(256, 9, { defense: {} });
    e.advance(240);
    const d = e.defense!;
    const raiders = e.population.creatures.filter((c) => c.species === 'predator' && c.deadFor < 0);
    expect(raiders.length).toBeGreaterThan(3);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) e.tick();
    expect((performance.now() - t0) / 20).toBeLessThan(25);
    expect(new Set(raiders.map((c) => d.fieldFor(c))).size).toBeLessThanOrEqual(3);
  });
});

describe('breeders', () => {
  it('run home from a predator instead of across the land', () => {
    const l = lab();
    pen(l.base);
    const home = { x0: -3, z0: -3, x1: 3, z1: 3 };
    const rabbit = l.pop.spawn('prey', 0, 0, -9);
    l.pop.spawnKind('wolf', 0, 0, -14, {});
    l.pop.refillSearches();
    decidePrey(l.pop, rabbit, false, { home });
    expect(rabbit.activity).toBe('flee');
    const goal = rabbit.path[rabbit.path.length - 1];
    expect(atHome(home, goal.x, goal.z)).toBe(true);
  });

  it('dodge a fox inside the warren without leaving it', () => {
    const l = lab();
    pen(l.base);
    const home = { x0: -3, z0: -3, x1: 3, z1: 3 };
    const rabbit = l.pop.spawn('prey', 0, 0, 1);
    const fox = l.pop.spawnKind('fox', 0, 0, -1, {});
    fox.activity = 'raid';
    l.pop.refillSearches();
    decidePrey(l.pop, rabbit, false, { home });
    expect(rabbit.activity).toBe('flee');
    for (const c of rabbit.path) expect(atHome(home, c.x, c.z)).toBe(true);
  });
});

describe('slingshot', () => {
  it('kills a fox in two hits', () => {
    const { pop, solids } = lab();
    const combat = new Combat(pop, solids);
    const rabbit = pop.spawnKind('rabbit', 0, 0, 0);
    const fox = pop.spawnKind('fox', 0, 0, 8);
    const w = WEAPONS.slingshot;
    for (let shot = 0; shot < 2; shot++) {
      expect(combat.fire(rabbit, fox, w)).toBe(true);
      for (let i = 0; i < 10; i++) combat.tick();
    }
    expect(fox.deadFor).toBeGreaterThanOrEqual(0);
    expect(fox.cause).toBe('slain');
  });

  it('holds fire when a wall is in the way', () => {
    const { pop, solids, base } = lab();
    for (let y = 0; y < 4; y++) for (let x = -2; x <= 2; x++) base.set(x, y, 4, 'stone');
    const combat = new Combat(pop, solids);
    const rabbit = pop.spawnKind('rabbit', 0, 0, 0);
    const fox = pop.spawnKind('fox', 0, 0, 8);
    expect(combat.fire(rabbit, fox, WEAPONS.slingshot)).toBe(false);
    expect(combat.projectiles).toHaveLength(0);
  });
});

describe('waves', () => {
  it('are reproducible for a seed', () => {
    expect(planWave(5, 300, new Rng(9))).toEqual(planWave(5, 300, new Rng(9)));
    expect(planWave(5, 300, new Rng(9))).not.toEqual(planWave(5, 300, new Rng(10)));
  });

  it('start with foxes and bring tougher kinds as time goes on', () => {
    expect(Object.keys(kindWeights(30))).toEqual(['fox']);
    const early = planWave(1, 30, new Rng(1));
    expect(early.orders.every((o) => o.kind === 'fox')).toBe(true);
    const share = (t: number) => {
      let foxes = 0;
      let all = 0;
      for (let seed = 0; seed < 20; seed++) {
        for (const o of planWave(10, t, new Rng(seed)).orders) {
          all += o.count;
          if (o.kind === 'fox') foxes += o.count;
        }
      }
      return foxes / all;
    };
    expect(share(180)).toBeGreaterThan(share(600));
    const late = planWave(12, 600, new Rng(1));
    expect(late.orders.some((o) => o.kind === 'badger')).toBe(true);
  });

  it('grow steadily, then sharply in overtime', () => {
    let last = 0;
    for (let t = 0; t <= 1500; t += 30) {
      expect(threatBudget(t)).toBeGreaterThan(last);
      last = threatBudget(t);
    }
    expect(hpScale(600)).toBeGreaterThan(hpScale(0));
    expect(overtime(OVERTIME_START - 1)).toBe(1);
    expect(overtime(OVERTIME_START + 4 * WAVE_INTERVAL)).toBeGreaterThan(2);
  });
});

describe('a defense round', () => {
  const round = (seed = 12345) => Ecosystem.create(256, seed, { defense: {} });

  it('starts with a walled warren, a herd inside and four defenders on posts', () => {
    const e = round();
    const d = e.defense!;
    expect(d.base.blocks()).toBeGreaterThan(150);
    expect(d.base.posts()).toHaveLength(4);
    expect(d.base.cost()).toBeLessThanOrEqual(d.budget);
    expect(e.population.count('prey')).toBe(14);
    e.advance(15);
    const defenders = e.population.creatures.filter((c) => c.role === 'defender');
    expect(defenders).toHaveLength(4);
    expect(defenders.filter((c) => c.activity === 'guard' && c.y >= 4).length).toBeGreaterThanOrEqual(3);
  });

  it('sends the first wave at 0:30, and defenders shoot predators', () => {
    const e = round();
    const d = e.defense!;
    e.advance(29);
    expect(d.wave).toBe(0);
    e.advance(2);
    expect(d.wave).toBe(1);
    e.advance(60);
    expect(d.stats.shots).toBeGreaterThan(0);
    expect(d.stats.kills).toBeGreaterThan(0);
    expect(d.points).toBeGreaterThan(0);
  });

  it('allocates defenders and refuses blocks over the budget', () => {
    const e = round();
    const d = e.defense!;
    e.advance(2);
    expect(d.apply({ type: 'allocate', defenders: 7 }).ok).toBe(true);
    expect(e.population.creatures.filter((c) => c.role === 'defender')).toHaveLength(7);
    const free = d.budget - d.base.cost();
    let placed = 0;
    for (let x = d.base.origin.x; x < d.base.origin.x + 48 && placed * 8 <= free; x++) if (d.apply({ type: 'place', x, y: 10, z: d.base.origin.z, material: 'iron' }).ok) placed++;
    expect(d.base.cost()).toBeLessThanOrEqual(d.budget);
    expect(d.apply({ type: 'place', x: d.base.origin.x + 47, y: 12, z: d.base.origin.z + 47, material: 'iron' })).toEqual({ ok: false, reason: 'Over the block budget.' });
    expect(d.apply({ type: 'buyBudget' }).ok).toBe(false); // no points yet
    d.points = 1000;
    expect(d.apply({ type: 'buyBudget' }).ok).toBe(true);
    expect(d.apply({ type: 'place', x: d.base.origin.x + 47, y: 12, z: d.base.origin.z + 47, material: 'iron' }).ok).toBe(true);
  });

  it('brings the same waves for a seed, whatever the player does', () => {
    const counts = (e: Ecosystem) => e.defense!.events.filter((ev) => ev.kind === 'wave');
    const a = round(31);
    const b = round(31);
    b.defense!.apply({ type: 'allocate', defenders: 0 });
    a.advance(150);
    b.advance(150);
    expect(counts(a).length).toBe(3);
    expect(counts(b)).toEqual(counts(a));
  });

  it('keeps breeders at home through the first waves', () => {
    const e = round(5);
    const d = e.defense!;
    e.advance(200);
    const home = d.home;
    const breeders = e.population.creatures.filter((c) => c.species === 'prey' && c.role !== 'defender' && c.deadFor < 0);
    expect(breeders.length).toBeGreaterThan(5);
    // Some may be out at the water, but the herd stays near the warren.
    const near = breeders.filter((c) => c.x > home.x0 - 12 && c.x < home.x1 + 12 && c.z > home.z0 - 12 && c.z < home.z1 + 12);
    expect(near.length).toBe(breeders.length);
  });

  it('is lost when no rabbits are left', () => {
    const e = round();
    const d = e.defense!;
    e.advance(1);
    for (const c of e.population.creatures) if (c.species === 'prey') e.population.damage(c, 1000, { cause: 'eaten' });
    e.advance(0.1);
    expect(d.outcome).toBe('lost');
    expect(d.events.some((ev) => ev.kind === 'lost')).toBe(true);
    expect(d.apply({ type: 'callWave' }).ok).toBe(false);
  });

  it('is deterministic and survives a save as a version 3 world file', () => {
    const a = round(77);
    const b = round(77);
    a.advance(90);
    b.advance(90);
    expect(JSON.stringify(a.snapshot().defense)).toBe(JSON.stringify(b.snapshot().defense));
    a.defense!.base.damage(a.defense!.site.x - 7, 1, a.defense!.site.z - 7, 20);
    const world = createWorld({ name: 'Siege', ground: { material: 'grass', size: 256 }, ecosystem: a.snapshot() });
    const file = JSON.parse(JSON.stringify(encodeWorld(world, () => undefined)));
    expect(file.version).toBe(3);
    const back = Ecosystem.restore(256, decodeWorld(file).world.ecosystem!);
    const d = back.defense!;
    expect(d.clock).toBeCloseTo(a.defense!.clock, 1);
    expect(d.wave).toBe(a.defense!.wave);
    expect(d.base.blocks()).toBe(a.defense!.base.blocks());
    expect(d.base.hpAt(a.defense!.site.x - 7, 1, a.defense!.site.z - 7)).toBe(40);
    expect(back.population.creatures.filter((c) => c.role === 'defender')).toHaveLength(a.population.creatures.filter((c) => c.role === 'defender').length);
    expect(back.population.creatures.filter((c) => c.kind === 'fox').length).toBe(a.population.creatures.filter((c) => c.kind === 'fox' && c.deadFor < 0).length);
  });
});
