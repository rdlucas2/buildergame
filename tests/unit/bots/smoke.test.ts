import { describe, expect, it } from 'vitest';
import { NO_MODIFIERS } from '../../../src/core/defense-state';
import { DEFENSE_GROUND, runReplay, stateHash } from '../../../src/sim/defense/replay';
import { HeuristicBrain } from '../../../bots/brains/heuristic';
import { afterRound, councilOffers, loadProfile } from '../../../bots/campaign';
import { SimTable } from '../../../bots/drivers/sim';
import { PERSONAS, STYLES } from '../../../bots/personas';
import { playRound } from '../../../bots/play';

describe('heuristic bots', () => {
  for (const style of STYLES) {
    it(`${style} plays three waves with legal moves, and its replay comes out the same`, async () => {
      const modifiers = { ...NO_MODIFIERS };
      const run = await playRound(new SimTable(7, modifiers), new HeuristicBrain(PERSONAS[style]), { seed: 7, size: DEFENSE_GROUND, modifiers, every: 10, maxSeconds: 600, maxWaves: 3 });
      expect(run.final.wave).toBeGreaterThanOrEqual(3);
      expect(run.decisions.length).toBeGreaterThan(5);
      expect(run.decisions.flatMap((d) => d.rejected)).toEqual([]);
      expect(run.replay.actions.length).toBeGreaterThan(0);
      expect(run.replay.player).toEqual({ style, brain: 'heuristic' });
      expect(stateHash(runReplay(run.replay))).toBe(run.replay.result.hash);
    });
  }

  it('styles play differently', async () => {
    const modifiers = { ...NO_MODIFIERS };
    const play = (style: 'sharpshooter' | 'breeder') => playRound(new SimTable(7, modifiers), new HeuristicBrain(PERSONAS[style]), { seed: 7, size: DEFENSE_GROUND, modifiers, every: 10, maxSeconds: 120 });
    const [shooter, breeder] = await Promise.all([play('sharpshooter'), play('breeder')]);
    expect(shooter.final.defenders).toBeGreaterThan(breeder.final.defenders);
    expect(shooter.final.posts).toBeGreaterThan(breeder.final.posts);
  });

  it('between rounds, Clover is paid and spent at the Warren Council', async () => {
    const brain = new HeuristicBrain(PERSONAS.turtle);
    const profile = { ...loadProfile('fresh'), clover: 400 };
    expect(councilOffers(profile).length).toBeGreaterThan(3);
    const modifiers = { ...NO_MODIFIERS };
    const run = await playRound(new SimTable(2, modifiers), brain, { seed: 2, size: DEFENSE_GROUND, modifiers, every: 10, maxSeconds: 90 });
    const step = await afterRound(brain, profile, run.final);
    expect(step.reward.total).toBeGreaterThan(0);
    expect(step.bought.length).toBeGreaterThan(0);
    // The cheapest of the turtle's three favourites: walls, budget, armour.
    expect(['walls', 'budget', 'armour']).toContain(step.bought[0].buy);
    expect(step.profile.clover).toBeLessThan(400 + step.reward.total);
    expect(councilOffers(step.profile).every((o) => o.price <= step.profile.clover)).toBe(true);
    expect(loadProfile('max').upgrades.damage).toBeGreaterThan(loadProfile('mid').upgrades.damage);
  });
});
