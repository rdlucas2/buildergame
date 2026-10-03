import { describe, expect, it } from 'vitest';
import type { EcosystemState } from '../../../src/core/world';
import { Ecosystem } from '../../../src/sim/ecosystem';

/** A round as the first Warren Defense version saved it: none of the fields added since. */
function firstVersionRound(seed: number): EcosystemState {
  const state = Ecosystem.create(512, seed, { defense: {} }).snapshot();
  const d = state.defense as unknown as Record<string, unknown>;
  for (const k of ['unlocked', 'mainWeapon', 'loadout', 'tiers', 'strength', 'perks', 'offers', 'offersMade', 'milestones', 'rerolls', 'rewarded', 'bosses', 'room', 'design']) delete d[k];
  delete (d.stats as Record<string, unknown>).firstLoss;
  delete (d.base as Record<string, unknown>).coreDamage;
  for (const k of ['startWeapon', 'rerolls', 'cards']) delete (d.modifiers as Record<string, unknown>)[k];
  return state;
}

describe('rounds saved by earlier versions', () => {
  it('open and play on, with what later versions added filled in', () => {
    // Worlds kept in the browser are stored as they were saved, without the file format's defaults.
    const e = Ecosystem.restore(512, firstVersionRound(3));
    const d = e.defense!;
    expect(d.unlocked).toEqual(['slingshot']);
    expect(d.mainWeapon).toBe('slingshot');
    expect(d.tiers).toBe(3);
    expect(d.strength).toEqual([0, 0, 0, 0, 0]);
    expect(d.modifiers.cards).toBe(3);
    expect(d.stats.firstLoss).toBe(-1);
    e.advance(90);
    expect(d.wave).toBeGreaterThan(0);
    expect(d.apply({ type: 'repair' }).reason).not.toMatch(/undefined/);
  });

  it('a round saved before warrens had a core gets one', () => {
    const state = firstVersionRound(4);
    const base = state.defense!.base;
    const slot = base.palette.indexOf('core') + 1;
    for (let i = 0; i < base.voxels.length; i++) if (base.voxels[i] === slot) base.voxels[i] = 0;
    const e = Ecosystem.restore(512, state);
    expect(e.defense!.base.coreCells()).toHaveLength(8);
  });
});
