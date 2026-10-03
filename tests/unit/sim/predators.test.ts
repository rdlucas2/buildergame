import { describe, expect, it } from 'vitest';
import { decodeWorld, encodeWorld } from '../../../src/core/format/world-file';
import { createWorld } from '../../../src/core/world';
import { KINDS } from '../../../src/sim/creatures';
import { makeHawk } from '../../../src/sim/defense/hawk';
import { BOSS_HP, BOSS_TIMES, ELITE_FROM, ELITE_HP, hpScale, planWave } from '../../../src/sim/defense/waves';
import { Ecosystem } from '../../../src/sim/ecosystem';
import { Navigator } from '../../../src/sim/navigation';
import { Rng } from '../../../src/sim/rng';
import { SolidMap } from '../../../src/sim/solids';
import { generateTerrain } from '../../../src/sim/terrain';
import { DefenseBase } from '../../../src/sim/defense/base';

const round = (seed = 21) => Ecosystem.create(256, seed, { defense: {} });

describe('named waves', () => {
  it('every sixth wave has a theme once its kind has arrived', () => {
    const swarm = planWave(6, 300, new Rng(1));
    expect(swarm.name).toBe('Fox Swarm');
    expect(new Set(swarm.orders.map((o) => o.kind))).toEqual(new Set(['fox']));
    const hunt = planWave(12, 630, new Rng(1));
    expect(hunt.name).toBe('Tiger Hunt');
    expect(new Set(hunt.orders.map((o) => o.kind))).toEqual(new Set(['tiger']));
    // Tigers haven't come yet at 5:00: an ordinary wave instead.
    expect(planWave(12, 300, new Rng(1)).name).toBeUndefined();
    const siege = planWave(18, 960, new Rng(1));
    expect(siege.name).toBe('Bear Siege');
    expect(new Set(siege.orders.map((o) => o.kind))).toEqual(new Set(['bear']));
    expect(planWave(24, 1290, new Rng(1)).name).toBe('Hawk Raid');
    expect(planWave(7, 400, new Rng(1)).name).toBeUndefined();
  });

  it('bring a huge boss when asked, and elites from 15:00', () => {
    // At 10:00 the strongest kind about is the tiger; by 20:00, the bear.
    const boss = planWave(11, 610, new Rng(3), { boss: true });
    const b = boss.orders.find((o) => o.rank === 'boss')!;
    expect(b.count).toBe(1);
    expect(b.kind).toBe('tiger');
    expect(b.hpScale).toBeCloseTo(hpScale(610) * BOSS_HP);
    expect(boss.name).toBe('Tiger boss');
    expect(planWave(23, 1210, new Rng(3), { boss: true }).boss).toBe('bear');
    const ranks = (t: number) => {
      let elites = 0;
      for (let seed = 1; seed <= 20; seed++) elites += planWave(17, t, new Rng(seed)).orders.filter((o) => o.rank === 'elite').length;
      return elites;
    };
    expect(ranks(ELITE_FROM - 60)).toBe(0);
    expect(ranks(1300)).toBeGreaterThan(3);
    const elite = planWave(17, 1300, new Rng(2)).orders.find((o) => o.rank === 'elite');
    if (elite) expect(elite.hpScale).toBeCloseTo(hpScale(1300) * ELITE_HP);
  });

  it('a boss comes with the first wave at or after 10:00, and only once', () => {
    const e = round();
    const d = e.defense!;
    d.clock = BOSS_TIMES[0];
    d.nextWaveAt = BOSS_TIMES[0];
    e.advance(0.2);
    const first = d.events.filter((ev) => ev.kind === 'wave').pop();
    expect(first && first.kind === 'wave' && first.boss).toBeTruthy();
    expect(d.bosses).toBe(1);
    d.nextWaveAt = d.clock;
    e.advance(0.2);
    const second = d.events.filter((ev) => ev.kind === 'wave').pop();
    expect(second && second.kind === 'wave' && second.boss).toBeFalsy();
  });
});

describe('new predators', () => {
  it('tigers leap 3-high walls that stop wolves', () => {
    const terrain = generateTerrain(128, 1, { dryRadius: 0 });
    terrain.water.fill(0);
    const solids = new SolidMap(() => undefined);
    const base = new DefenseBase({ origin: { x: -24, z: -24 } });
    solids.setBase(base);
    const nav = new Navigator(solids, terrain);
    for (let y = 0; y < 3; y++)
      for (let i = -3; i <= 3; i++) {
        base.set(i, y, -3, 'stone');
        base.set(i, y, 3, 'stone');
        base.set(-3, y, i, 'stone');
        base.set(3, y, i, 'stone');
      }
    expect(nav.findPath({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 }, KINDS.wolf.body, 4000)).toBeNull();
    expect(nav.findPath({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 }, KINDS.tiger.body, 4000)).not.toBeNull();
    // A fourth course stops tigers too.
    for (let i = -3; i <= 3; i++) {
      base.set(i, 3, -3, 'stone');
      base.set(i, 3, 3, 'stone');
      base.set(-3, 3, i, 'stone');
      base.set(3, 3, i, 'stone');
    }
    expect(nav.findPath({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 }, KINDS.tiger.body, 4000)).toBeNull();
  });

  it('bears crack the blocks beside the one they break', () => {
    const e = round();
    const d = e.defense!;
    const { x, z } = { x: d.base.origin.x + 2, z: d.base.origin.z + 2 };
    for (let i = 0; i < 3; i++) d.base.set(x + i, 0, z, 'iron');
    const bear = e.population.spawnKind('bear', x + 1, 0, z + 2, {});
    const wolf = e.population.spawnKind('wolf', x + 1, 0, z + 2, {});
    d.chew(wolf, x + 1, 0, z, 10);
    expect(d.base.wearAt(x, 0, z)).toBe(0);
    d.chew(bear, x + 1, 0, z, 10);
    expect(d.base.wearAt(x, 0, z)).toBeGreaterThan(0);
    expect(d.base.wearAt(x + 2, 0, z)).toBeGreaterThan(0);
  });

  it('hawks go for rabbits in the open, and circle when every rabbit is under a roof', () => {
    const e = round();
    const d = e.defense!;
    const pop = e.population;
    const rabbits = pop.creatures.filter((c) => c.species === 'prey');
    for (const r of rabbits.slice(1)) pop.damage(r, 1000, { cause: 'age' });
    const bunny = rabbits[0];
    const hawk = pop.spawnKind('hawk', Math.floor(bunny.x) + 6, 10, Math.floor(bunny.z), {});
    const brain = makeHawk(d);
    const env = { night: false, time: 0 };
    brain.decide(pop, hawk, env as never);
    expect(hawk.target).toBe(bunny.id);
    // A roof over the rabbit: nothing to dive at.
    const bx = Math.floor(bunny.x);
    const bz = Math.floor(bunny.z);
    expect(d.apply({ type: 'place', x: bx, y: bunny.y + 2, z: bz, material: 'planks' }).ok).toBe(true);
    expect(pop.roofed(bx, bunny.y, bz)).toBe(true);
    brain.decide(pop, hawk, env as never);
    expect(hawk.target).toBe(-1);
    expect(hawk.activity).toBe('raid');
  });

  it('a hawk dives and strikes a rabbit in the open', () => {
    const e = round(4);
    const pop = e.population;
    const rabbits = pop.creatures.filter((c) => c.species === 'prey');
    for (const r of rabbits.slice(1)) pop.damage(r, 1000, { cause: 'age' });
    const d = e.defense!;
    d.apply({ type: 'allocate', defenders: 0 });
    // Out in a field, far from any roof to hide under.
    const bunny = rabbits[0];
    bunny.x = bunny.px = d.site.x + 40.5;
    bunny.z = bunny.pz = d.site.z + 0.5;
    bunny.y = bunny.py = 0;
    bunny.path = [];
    pop.spawnKind('hawk', d.site.x + 48, 10, d.site.z, {});
    e.advance(25);
    expect(bunny.deadFor >= 0 || bunny.health < 1).toBe(true);
  });

  it('elites and bosses pay more, count as their own kind, and are saved', () => {
    const e = round();
    const d = e.defense!;
    const plain = e.population.spawnKind('wolf', 0, 0, 0, {});
    e.population.damage(plain, 1e6, { cause: 'slain' });
    const base = d.points;
    const elite = e.population.spawnKind('wolf', 0, 0, 0, { rank: 'elite', maxHp: 75 });
    const boss = e.population.spawnKind('bear', 0, 0, 0, { rank: 'boss', maxHp: 2000 });
    const world = createWorld({ name: 'Ranks', ground: { material: 'grass', size: 256 }, ecosystem: e.snapshot() });
    const back = Ecosystem.restore(256, decodeWorld(JSON.parse(JSON.stringify(encodeWorld(world, () => undefined)))).world.ecosystem!);
    expect(back.population.creatures.find((c) => c.id === boss.id)?.rank).toBe('boss');
    e.population.damage(elite, 1e6, { cause: 'slain' });
    expect(d.points - base).toBe(base * 3);
    e.population.damage(boss, 1e6, { cause: 'slain' });
    expect(d.stats.killsOf).toMatchObject({ wolf: 2, bear: 1, elite: 1, boss: 1 });
  });
});
