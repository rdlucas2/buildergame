import { describe, expect, it } from 'vitest';
import { NO_MODIFIERS } from '../../../src/core/defense-state';
import { FileFormatError } from '../../../src/core/format/errors';
import { decodeProfileFile, encodeProfileFile, parseProfile } from '../../../src/core/format/profile-file';
import { decodeWorld, encodeWorld } from '../../../src/core/format/world-file';
import { newProfile } from '../../../src/core/profile';
import { createWorld } from '../../../src/core/world';
import { emptyStats } from '../../../src/sim/defense/defense';
import { ACHIEVEMENTS } from '../../../src/sim/defense/achievements';
import { UPGRADES, buyUpgrade, levelsAt, modifiersFor, totalUpgradeCost, upgradePrice } from '../../../src/sim/defense/council';
import { finishRound, newRoundAchievements, roundClover, type RoundResult } from '../../../src/sim/defense/rewards';
import { Ecosystem } from '../../../src/sim/ecosystem';

const result = (r: Partial<RoundResult>): RoundResult => ({ clock: 0, score: 0, wave: 0, stats: emptyStats(), unlocked: 1, milestones: 0, ...r });
const WHEN = '2026-10-03T00:00:00.000Z';

describe('the Warren Council', () => {
  it('prices each level higher than the last, and can be fully bought', () => {
    for (const u of UPGRADES) {
      for (let l = 1; l < u.maxLevel; l++) expect(upgradePrice(u.id, l)).toBeGreaterThanOrEqual(upgradePrice(u.id, l - 1));
      expect(upgradePrice(u.id, u.maxLevel)).toBe(Infinity);
    }
    expect(totalUpgradeCost()).toBeGreaterThan(1000);
    expect(totalUpgradeCost()).toBeLessThan(10_000);
  });

  it('turns upgrade levels into round modifiers', () => {
    expect(modifiersFor({})).toEqual(NO_MODIFIERS);
    const max = modifiersFor(levelsAt(1));
    expect(max.damage).toBeCloseTo(3.25);
    expect(max.blockHp).toBeCloseTo(2);
    expect(max.budget).toBe(400);
    expect(max.rabbits).toBe(8);
    expect(max.armour).toBeCloseTo(0.68);
    expect(max.startWeapon).toBe(3);
    expect(max.rerolls).toBe(3);
    expect(max.cards).toBe(4);
    // Levels beyond the maximum count as the maximum.
    expect(modifiersFor({ damage: 99 }).damage).toBeCloseTo(3.25);
  });

  it('buys a level with Clover, refusing when there is too little', () => {
    let p = { ...newProfile(), clover: 20 };
    const price = upgradePrice('budget', 0);
    const r = buyUpgrade(p, 'budget');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    p = r.profile;
    expect(p.upgrades.budget).toBe(1);
    expect(p.clover).toBe(20 - price);
    expect(buyUpgrade(p, 'cards')).toEqual({ ok: false, reason: `Needs ${upgradePrice('cards', 0)} Clover.` });
    expect(buyUpgrade(p, 'nonsense').ok).toBe(false);
  });
});

describe('round rewards', () => {
  it('pay Clover for time survived, milestones and kills', () => {
    const c = roundClover(result({ clock: 610, milestones: 2, stats: { ...emptyStats(), kills: 150 } }));
    expect(c).toEqual({ time: 40, milestones: 30, kills: 10 });
    expect(roundClover(result({ clock: 1500, milestones: 5 })).milestones).toBe(10 + 20 + 30 + 50 + 50);
  });

  it('add up a lifetime and award achievements once', () => {
    const r = result({ clock: 620, score: 12_000, wave: 11, milestones: 2, unlocked: 5, stats: { ...emptyStats(), kills: 210, killsOf: { fox: 150 }, killsWith: { bow: 120 }, firstLoss: 400 } });
    const first = finishRound(newProfile(), r, WHEN);
    const ids = first.earned.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['survive-5', 'survive-10', 'flawless-5', 'kills-round-200', 'arsenal', 'score-10k', 'first-round', 'bow-100']));
    expect(ids).not.toContain('survive-15');
    expect(first.profile.stats).toMatchObject({ rounds: 1, bestTime: 620, kills: 210, killsOf: { fox: 150 } });
    const achieved = first.earned.reduce((s, a) => s + a.clover, 0);
    expect(first.reward.achievements).toBe(achieved);
    expect(first.reward.total).toBe(41 + 30 + 14 + achieved);
    expect(first.profile.clover).toBe(first.reward.total);
    expect(first.profile.achievements['survive-5']).toBe(WHEN);
    // The same round again earns its Clover but no achievement twice.
    const second = finishRound(first.profile, r, WHEN);
    expect(second.earned.map((a) => a.id)).toEqual([]);
    expect(second.profile.stats.rounds).toBe(2);
    expect(second.profile.stats.kills).toBe(420);
  });

  it('notice round achievements while the round is still going', () => {
    const p = newProfile();
    expect(newRoundAchievements(p, result({ clock: 120 }))).toEqual([]);
    expect(newRoundAchievements(p, result({ clock: 301 })).map((a) => a.id)).toEqual(['survive-5', 'flawless-5']);
    expect(newRoundAchievements(p, result({ clock: 301, stats: { ...emptyStats(), firstLoss: 30 } })).map((a) => a.id)).toEqual(['survive-5']);
  });

  it('includes goals for time survived', () => {
    const times = ACHIEVEMENTS.filter((a) => a.criterion.type === 'time' && a.scope === 'round').map((a) => (a.criterion as { seconds: number }).seconds);
    expect(times).toEqual([300, 600, 900, 1200, 1500]);
  });
});

describe('profile files', () => {
  it('round-trip, and fill in missing totals', () => {
    const p = { ...newProfile(), clover: 77, upgrades: { damage: 3 }, achievements: { 'survive-5': WHEN } };
    p.stats.kills = 99;
    const back = decodeProfileFile(JSON.parse(JSON.stringify(encodeProfileFile(p))));
    expect(back).toEqual(p);
    const partial = parseProfile({ clover: 5, cloverEarned: 5, upgrades: {}, achievements: {}, stats: { rounds: 2 } });
    expect(partial.stats.rounds).toBe(2);
    expect(partial.stats.killsOf).toEqual({});
  });

  it('refuse other files and bad values', () => {
    expect(() => decodeProfileFile({ format: 'buildergame.world', version: 1 })).toThrow(FileFormatError);
    expect(() => decodeProfileFile({ ...encodeProfileFile(newProfile()), clover: -5 })).toThrow(FileFormatError);
    expect(() => parseProfile('nope')).toThrow(FileFormatError);
  });
});

describe('upgrades in a round', () => {
  it('start with more weapons, more budget, rerolls and a fourth card', () => {
    const e = Ecosystem.create(256, 4, { defense: modifiersFor({ startWeapon: 2, budget: 2, rerolls: 1, cards: 1, rabbits: 3 }) });
    const d = e.defense!;
    expect(d.unlocked).toEqual(['slingshot', 'bow', 'crossbow']);
    expect(d.mainWeapon).toBe('crossbow');
    expect(d.budget).toBe(800);
    expect(e.population.count('prey')).toBe(17);
    expect(e.population.capOf('prey')).toBe(44);
    e.advance(90);
    expect(d.offers[0]).toHaveLength(4);
    const before = JSON.stringify(d.offers[0]);
    expect(d.apply({ type: 'reroll' }).ok).toBe(true);
    expect(JSON.stringify(d.offers[0])).not.toBe(before);
    expect(d.apply({ type: 'reroll' })).toEqual({ ok: false, reason: 'No rerolls left this round.' });
  });

  it('remember whether the round was paid, and when the first rabbit fell', () => {
    const e = Ecosystem.create(256, 5, { defense: {} });
    const d = e.defense!;
    e.advance(5);
    const rabbit = e.population.creatures.find((c) => c.species === 'prey')!;
    e.population.damage(rabbit, 1000, { cause: 'eaten' });
    expect(d.stats.firstLoss).toBeCloseTo(d.clock, 0);
    d.rewarded = true;
    const world = createWorld({ name: 'Paid', ground: { material: 'grass', size: 256 }, ecosystem: e.snapshot() });
    const back = Ecosystem.restore(256, decodeWorld(JSON.parse(JSON.stringify(encodeWorld(world, () => undefined)))).world.ecosystem!).defense!;
    expect(back.rewarded).toBe(true);
    expect(back.stats.firstLoss).toBe(d.stats.firstLoss);
  });
});
