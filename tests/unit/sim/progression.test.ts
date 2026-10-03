import { describe, expect, it } from 'vitest';
import { decodeWorld, encodeWorld } from '../../../src/core/format/world-file';
import { createWorld } from '../../../src/core/world';
import { all, any, describe as describeCriterion, killsWith, met, points, progressOf, time, type Progress } from '../../../src/sim/defense/criteria';
import { MILESTONE_SECONDS } from '../../../src/sim/defense/defense';
import { RARITIES, describePerk, rollOffer, totalsOf } from '../../../src/sim/defense/perks';
import { REPAIR_HP_PER_POINT, WEAPON_UNLOCKS, strengthPrice } from '../../../src/sim/defense/unlocks';
import { WEAPONS, WEAPON_LIST, dps } from '../../../src/sim/defense/weapons';
import { Ecosystem } from '../../../src/sim/ecosystem';
import { Rng } from '../../../src/sim/rng';

const progress = (p: Partial<Progress>): Progress => ({ clock: 0, score: 0, waves: 0, kills: 0, killsWith: {}, killsOf: {}, ...p });
const round = (seed = 12345) => Ecosystem.create(256, seed, { defense: {} });

describe('weapons', () => {
  it('get stronger down the list, from the slingshot to plasma', () => {
    expect(WEAPON_LIST[0].id).toBe('slingshot');
    expect(WEAPON_LIST[WEAPON_LIST.length - 1].id).toBe('plasma');
    const single = WEAPON_LIST.filter((w) => !w.pellets && !w.splash).map(dps);
    for (let i = 1; i < single.length; i++) expect(single[i]).toBeGreaterThan(single[i - 1]);
    // Every weapon but the slingshot has a way to unlock it.
    for (const w of WEAPON_LIST) expect(WEAPON_UNLOCKS[w.id] === null).toBe(w.id === 'slingshot');
  });
});

describe('criteria', () => {
  it('measure time survived, points and kills with a weapon', () => {
    const c = any(time(150), killsWith('slingshot', 20));
    expect(met(c, progress({ clock: 149 }))).toBe(false);
    expect(met(c, progress({ clock: 150 }))).toBe(true);
    expect(met(c, progress({ killsWith: { slingshot: 20 } }))).toBe(true);
    expect(progressOf(c, progress({ clock: 75, killsWith: { slingshot: 15 } }))).toBeCloseTo(0.75);
    const both = all(time(360), points(1500));
    expect(met(both, progress({ clock: 400, score: 1000 }))).toBe(false);
    expect(progressOf(both, progress({ clock: 360, score: 750 }))).toBeCloseTo(0.75);
    expect(describeCriterion(both)).toBe('Survive 6:00 and earn 1500 points');
    expect(describeCriterion(killsWith('bow', 25))).toBe('25 kills with the Bow');
  });
});

describe('perks', () => {
  it('are dealt the same for the same seed, three different cards at a time', () => {
    const a = rollOffer(new Rng(7), 300, ['sling', 'bow'], 'bow');
    const b = rollOffer(new Rng(7), 300, ['sling', 'bow'], 'bow');
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((c) => `${c.kind}/${c.target}`)).size).toBe(3);
    for (const c of a) expect(describePerk(c).length).toBeGreaterThan(5);
  });

  it('get rarer and stronger the longer the warren holds out', () => {
    const rare = (t: number) => {
      let n = 0;
      const rng = new Rng(1);
      for (let i = 0; i < 300; i++) for (const c of rollOffer(rng, t, ['sling'], 'sling')) if (RARITIES.indexOf(c.rarity) >= 2) n++;
      return n;
    };
    expect(rare(1200)).toBeGreaterThan(rare(0) * 2);
    const commonDamage = (t: number) => {
      const rng = new Rng(3);
      for (let i = 0; i < 500; i++) for (const c of rollOffer(rng, t, ['sling'], 'sling')) if (c.kind === 'damage' && c.rarity === 'common' && c.target === 'sling') return c.amount;
      return 0;
    };
    expect(commonDamage(1200)).toBeGreaterThan(commonDamage(0));
    // Milestone offers are rare or better.
    for (const c of rollOffer(new Rng(5), 0, ['sling'], 'sling', 2)) expect(RARITIES.indexOf(c.rarity)).toBeGreaterThanOrEqual(2);
  });

  it('add up within a kind and multiply across kinds', () => {
    const t = totalsOf([
      { kind: 'damage', target: 'bow', amount: 0.1, rarity: 'common' },
      { kind: 'damage', target: 'all', amount: 0.1, rarity: 'common' },
      { kind: 'rate', target: 'bow', amount: 0.2, rarity: 'rare' },
      { kind: 'armour', target: '', amount: 0.1, rarity: 'common' },
      { kind: 'armour', target: '', amount: 0.1, rarity: 'common' },
    ]);
    expect(t.damage.bow).toBeCloseTo(1.2);
    expect(t.damage.sling).toBeCloseTo(1.1);
    expect(t.rate.bow).toBeCloseTo(1.2);
    expect(t.armour).toBeCloseTo(0.81);
  });
});

describe('progression in a round', () => {
  it('unlocks the bow with time survived and arms the defenders with it', () => {
    const e = round();
    const d = e.defense!;
    expect(d.unlocked).toEqual(['slingshot']);
    e.advance(30);
    // Long before 2:30 the slingshot is all there is...
    expect(d.unlocked).toEqual(['slingshot']);
    d.stats.killsWith.slingshot = 20; // ...unless the defenders earn the bow sooner.
    e.advance(1.5);
    expect(d.unlocked).toContain('bow');
    expect(d.mainWeapon).toBe('bow');
    expect(d.events.some((ev) => ev.kind === 'unlock' && ev.weapon === 'bow')).toBe(true);
    const defender = e.population.creatures.find((c) => c.role === 'defender')!;
    expect(d.weaponFor(defender).id).toBe('bow');
    // Specialists carry another weapon; equip changes the main one.
    expect(d.apply({ type: 'loadout', weapon: 'slingshot', count: 2 }).ok).toBe(true);
    const carried = e.population.creatures.filter((c) => c.role === 'defender').map((c) => d.weaponFor(c).id);
    expect(carried.filter((w) => w === 'slingshot')).toHaveLength(2);
    expect(d.apply({ type: 'equip', weapon: 'laser' }).ok).toBe(false);
  });

  it('locks stronger materials until time or points unlock them', () => {
    const e = round();
    const d = e.defense!;
    const spot = { x: d.base.origin.x, y: 0, z: d.base.origin.z };
    expect(d.apply({ type: 'place', ...spot, material: 'stone_bricks' }).ok).toBe(false);
    d.score = 600;
    e.advance(1.5);
    expect(d.tiers).toBe(4);
    expect(d.apply({ type: 'place', ...spot, material: 'stone_bricks' }).ok).toBe(true);
    expect(d.apply({ type: 'strengthen', tier: 4 }).ok).toBe(false); // metal is still locked
  });

  it('offers a perk every wave after the first, and a rare one at each milestone', () => {
    const e = round();
    const d = e.defense!;
    e.advance(90);
    expect(d.wave).toBe(2);
    expect(d.offers).toHaveLength(1);
    const card = d.offers[0][0];
    expect(d.apply({ type: 'pickPerk', index: 0 }).ok).toBe(true);
    expect(d.perks).toEqual([card]);
    expect(d.offers).toHaveLength(0);
    expect(d.apply({ type: 'pickPerk', index: 0 })).toEqual({ ok: false, reason: 'No perk to pick.' });
    d.clock = MILESTONE_SECONDS - 0.5;
    e.advance(1.5);
    expect(d.milestones).toBe(1);
    expect(d.events.some((ev) => ev.kind === 'milestone' && ev.minutes === 5)).toBe(true);
    for (const c of d.offers[d.offers.length - 1]) expect(RARITIES.indexOf(c.rarity)).toBeGreaterThanOrEqual(2);
  });

  it('applies picked perks to the weapons defenders fire', () => {
    const e = round();
    const d = e.defense!;
    const sling = WEAPONS.slingshot;
    d.offers.push([{ kind: 'damage', target: 'sling', amount: 0.5, rarity: 'epic' }]);
    d.apply({ type: 'pickPerk', index: 0 });
    d.offers.push([{ kind: 'multishot', target: 'all', amount: 2, rarity: 'legendary' }]);
    d.apply({ type: 'pickPerk', index: 0 });
    d.offers.push([{ kind: 'budget', target: '', amount: 40, rarity: 'common' }]);
    const budget = d.budget;
    d.apply({ type: 'pickPerk', index: 0 });
    const w = d.effectiveWeapon('slingshot');
    expect(w.damage).toBeCloseTo(sling.damage * 1.5);
    expect(w.pellets).toBe(3);
    expect(w.spread).toBeGreaterThan(0);
    expect(d.budget).toBe(budget + 40);
  });

  it('strengthens a tier and repairs blocks for points', () => {
    const e = round();
    const d = e.defense!;
    const wall = { x: d.site.x - 7, y: 1, z: d.site.z - 7 };
    const hp = d.base.maxHpAt(wall.x, wall.y, wall.z);
    expect(d.apply({ type: 'strengthen', tier: 2 })).toEqual({ ok: false, reason: `Needs ${strengthPrice(2, 0)} points.` });
    d.points = 1000;
    expect(d.apply({ type: 'strengthen', tier: 2 }).ok).toBe(true);
    expect(d.points).toBe(1000 - strengthPrice(2, 0));
    expect(d.base.maxHpAt(wall.x, wall.y, wall.z)).toBeCloseTo(hp * 1.25, 0);
    d.base.damage(wall.x, wall.y, wall.z, 40);
    expect(d.repairPrice).toBe(Math.ceil(40 / REPAIR_HP_PER_POINT));
    const before = d.points;
    expect(d.apply({ type: 'repair' }).ok).toBe(true);
    expect(d.base.wearAt(wall.x, wall.y, wall.z)).toBe(0);
    expect(before - d.points).toBe(10);
    expect(d.apply({ type: 'repair' })).toEqual({ ok: false, reason: 'Nothing needs repairing.' });
  });

  it('caps the colony at the room the warren has', () => {
    const e = round();
    // The starter warren encloses 165 cells of open ground: room for 41 rabbits.
    expect(e.population.capOf('prey')).toBe(41);
    expect(e.population.capOf('predator')).toBeGreaterThan(0);
  });
});

describe('beams and blasts', () => {
  it('a laser strikes at once and leaves a beam to draw; a cannon splashes', () => {
    const e = round();
    const d = e.defense!;
    e.advance(1);
    const shooter = e.population.creatures.find((c) => c.species === 'prey')!;
    const fox = e.population.spawnKind('fox', Math.floor(shooter.x) + 4, 0, Math.floor(shooter.z), {});
    fox.y = shooter.y;
    const hp = fox.health;
    // A clear line of sight: put both well outside the warren.
    shooter.x = d.site.x + 30.5;
    shooter.z = d.site.z + 30.5;
    shooter.y = 0;
    fox.x = shooter.x + 4;
    fox.z = shooter.z;
    fox.px = fox.x;
    fox.pz = fox.z;
    fox.y = 0;
    expect(d.combat.fire(shooter, fox, WEAPONS.laser)).toBe(true);
    expect(fox.health).toBeLessThan(hp);
    expect(d.combat.beams).toHaveLength(1);
    expect(d.combat.beams[0].x1).toBeCloseTo(fox.x - 0.4, 0);
    const a = e.population.spawnKind('wolf', 0, 0, 0, {});
    const b = e.population.spawnKind('wolf', 0, 0, 0, {});
    for (const [w, dz] of [[a, 0], [b, 1]] as const) {
      w.x = shooter.x + 8;
      w.z = shooter.z + dz;
      w.px = w.x;
      w.pz = w.z;
      w.y = 0;
    }
    d.combat.fire(shooter, a, WEAPONS.cannon);
    for (let i = 0; i < 10; i++) d.combat.tick();
    expect(a.health).toBeLessThan(1);
    expect(b.health).toBeLessThan(1);
  });
});

describe('saving progression', () => {
  it('round-trips unlocks, perks, offers and strength in a version 3 file', () => {
    const e = round(8);
    const d = e.defense!;
    e.advance(100);
    d.points = 500;
    d.apply({ type: 'strengthen', tier: 1 });
    d.apply({ type: 'pickPerk', index: 1 });
    d.unlocked.push('bow');
    d.loadout = { slingshot: 1 };
    const world = createWorld({ name: 'Armoury', ground: { material: 'grass', size: 256 }, ecosystem: e.snapshot() });
    const file = JSON.parse(JSON.stringify(encodeWorld(world, () => undefined)));
    const back = Ecosystem.restore(256, decodeWorld(file).world.ecosystem!).defense!;
    expect(back.unlocked).toEqual(d.unlocked);
    expect(back.perks).toEqual(d.perks);
    expect(back.offers).toEqual(d.offers);
    expect(back.strength).toEqual(d.strength);
    expect(back.loadout).toEqual({ slingshot: 1 });
    expect(back.offersMade).toBe(d.offersMade);
  });

  it('loads a round saved before progression existed, with a fresh armoury', () => {
    const e = round(9);
    const world = createWorld({ name: 'Old', ground: { material: 'grass', size: 256 }, ecosystem: e.snapshot() });
    const file = JSON.parse(JSON.stringify(encodeWorld(world, () => undefined)));
    for (const k of ['unlocked', 'mainWeapon', 'loadout', 'tiers', 'strength', 'perks', 'offers', 'offersMade', 'milestones']) delete file.ecosystem.defense[k];
    const back = Ecosystem.restore(256, decodeWorld(file).world.ecosystem!).defense!;
    expect(back.unlocked).toEqual(['slingshot']);
    expect(back.mainWeapon).toBe('slingshot');
    expect(back.tiers).toBe(3);
    expect(back.strength).toEqual([0, 0, 0, 0, 0]);
  });
});
