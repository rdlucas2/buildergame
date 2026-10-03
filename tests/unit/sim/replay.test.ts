import { describe, expect, it } from 'vitest';
import { NO_MODIFIERS } from '../../../src/core/defense-state';
import { FileFormatError } from '../../../src/core/format/errors';
import { decodeReplay, encodeReplay, type Replay } from '../../../src/core/format/replay-file';
import { buildOptions, expand } from '../../../src/sim/defense/advisor';
import { DEFENSE_GROUND, record, runReplay, startRound, stateHash } from '../../../src/sim/defense/replay';
import { DefenseSession } from '../../../src/sim/defense/session';
import { Ecosystem } from '../../../src/sim/ecosystem';

/** A short scripted round: allocate, build a lookout or two, take perks, repair. */
function playScripted(seed: number, seconds: number): { s: DefenseSession; log: ReturnType<typeof record> } {
  const s = DefenseSession.create({ seed });
  const log = record(s.eco);
  for (let t = 0; t < seconds; t += 5) {
    const o = s.observe();
    s.apply({ type: 'allocate', defenders: Math.max(3, Math.floor(o.rabbits / 2)) });
    if (o.offer.length) s.apply({ type: 'pickPerk', index: t % o.offer.length });
    const lookouts = expand(s.defense, { option: 'more-lookouts' });
    if (lookouts && t === 0) for (const a of lookouts) s.apply(a);
    if (o.damaged) s.apply({ type: 'repair' });
    s.advance(5);
  }
  return { s, log };
}

describe('replays', () => {
  it('a round started headless is set up exactly as the game sets one up', () => {
    const game = Ecosystem.restore(DEFENSE_GROUND, Ecosystem.create(DEFENSE_GROUND, 11, { defense: {} }).snapshot());
    game.setPlacements([], () => undefined);
    expect(stateHash(startRound(11))).toBe(stateHash(game));
    expect(stateHash(startRound(12))).not.toBe(stateHash(game));
  });

  it('records every action that goes through, at its tick, and plays them back identically', () => {
    const { s, log } = playScripted(5, 150);
    expect(log.length).toBeGreaterThan(20);
    expect(log.every((e, i) => i === 0 || e.tick >= log[i - 1].tick)).toBe(true);
    // A refused action is not recorded.
    const before = log.length;
    expect(s.apply({ type: 'pickPerk', index: 9 }).ok).toBe(false);
    expect(log.length).toBe(before);
    const back = runReplay({ seed: 5, size: DEFENSE_GROUND, modifiers: {}, actions: log, ticks: s.defense.tickIndex });
    expect(back.defense!.tickIndex).toBe(s.defense.tickIndex);
    expect(stateHash(back)).toBe(stateHash(s.eco));
    // Without the actions it comes out differently.
    expect(stateHash(runReplay({ seed: 5, size: DEFENSE_GROUND, modifiers: {}, actions: [], ticks: s.defense.tickIndex }))).not.toBe(stateHash(s.eco));
  });

  it('build options only offer what can be done now, and each one applies', () => {
    const s = DefenseSession.create({ seed: 3 });
    const d = s.defense;
    const opts = buildOptions(d);
    expect(opts.at(-1)!.id).toBe('wait');
    const free = d.budget - d.base.cost();
    for (const o of opts) {
      expect(o.budget).toBeLessThanOrEqual(free);
      expect(o.points).toBeLessThanOrEqual(d.points);
    }
    const ids = opts.map((o) => o.id);
    expect(ids).toContain('more-lookouts');
    for (const a of expand(d, { option: 'more-lookouts' })!) expect(d.apply(a).ok).toBe(true);
    expect(expand(d, { option: 'no-such-thing' })).toBeNull();
    // With no budget left, nothing that uses blocks is offered.
    d.budget = d.base.cost();
    expect(buildOptions(d).every((o) => o.budget === 0)).toBe(true);
  });
});

describe('replay files', () => {
  const sample = (): Replay => ({
    seed: 9,
    size: DEFENSE_GROUND,
    modifiers: { ...NO_MODIFIERS, damage: 1.3 },
    player: { style: 'turtle', brain: 'heuristic' },
    actions: [
      { tick: 0, action: { type: 'allocate', defenders: 5 } },
      { tick: 0, action: { type: 'placeMany', blocks: [{ x: 1, y: 3, z: 2, material: 'lookout' }] } },
      { tick: 420, action: { type: 'pickPerk', index: 1 } },
      { tick: 900, action: { type: 'strengthen', tier: 2 } },
    ],
    ticks: 1200,
    result: { clock: 120, wave: 2, score: 100, kills: 4, rabbitsLost: 0, blocksBroken: 0, outcome: 'playing', hash: 'abcd1234' },
  });

  it('round-trip through JSON', () => {
    const r = sample();
    const text = JSON.stringify(encodeReplay(r));
    expect(decodeReplay(text)).toEqual(r);
    expect(decodeReplay(JSON.parse(text))).toEqual(r);
  });

  it('reject files that are not replays, or would do something unexpected', () => {
    const file = () => encodeReplay(sample()) as Record<string, unknown> & { actions: Array<{ tick: number; action: Record<string, unknown> }> };
    expect(() => decodeReplay('{nope')).toThrow(FileFormatError);
    expect(() => decodeReplay({ format: 'buildergame.world' })).toThrow(/not a Buildergame replay/);
    const unknown = file();
    unknown.actions[0].action = { type: 'deleteEverything' };
    expect(() => decodeReplay(unknown)).toThrow(/Invalid replay file/);
    const extra = file();
    extra.actions[0].action = { type: 'allocate', defenders: 5, sneaky: true };
    expect(() => decodeReplay(extra)).toThrow(/Invalid replay file/);
    const backwards = file();
    backwards.actions.reverse();
    expect(() => decodeReplay(backwards)).toThrow(/out of order/);
    const future = file();
    future.version = 2;
    expect(() => decodeReplay(future)).toThrow(FileFormatError);
  });
});
