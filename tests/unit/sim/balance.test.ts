import { describe, expect, it } from 'vitest';
import { DefenseSession } from '../../../src/sim/defense/session';

/**
 * Loose bounds on the difficulty curve, so a change that breaks it shows up in CI. (Tune with
 * `npm run balance`; these only catch a round that ends absurdly early or never ends.)
 */
describe('balance', () => {
  it('a fresh round with no decisions lasts a few minutes, and ends before 20:00', () => {
    for (const seed of [1, 2]) {
      const s = DefenseSession.create({ seed });
      while (!s.over && s.clock < 1200) s.advance(30);
      expect(s.clock, `seed ${seed}`).toBeGreaterThan(240);
      expect(s.over, `seed ${seed}`).toBe(true);
    }
  }, 60_000);

  it('nobody defending loses much sooner than defending', () => {
    const s = DefenseSession.create({ seed: 3 });
    s.apply({ type: 'allocate', defenders: 0 });
    while (!s.over && s.clock < 1200) s.advance(30);
    expect(s.clock).toBeLessThan(330);
  }, 60_000);
});
