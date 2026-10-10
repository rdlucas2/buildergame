import { describe, expect, it } from 'vitest';
import { buildOptions, expansionPlan, EXPANSION_GAP } from '../../../src/sim/defense/advisor';
import { startRound } from '../../../src/sim/defense/replay';

function round() {
  const d = startRound(1).defense!;
  d.budget += 5000;
  return d;
}

/** Builds the next ring of walls, as a player (or bot) would from the Shop. */
function expand(d: ReturnType<typeof round>): void {
  expect(d.apply(expansionPlan(d)!.action).ok).toBe(true);
}

describe('dismantling the inner wall', () => {
  it('is not offered while the warren has only one ring', () => {
    expect(buildOptions(round()).find((o) => o.id === 'dismantle-inner')).toBeUndefined();
  });

  it('is offered once a ring of walls surrounds the old one, and tears the old one down', () => {
    const d = round();
    const old = d.base.footprint()!;
    const roomBefore = d.room;
    expand(d);
    const roomExpanded = d.room;
    const costExpanded = d.base.cost();
    const o = buildOptions(d).find((x) => x.id === 'dismantle-inner');
    expect(o).toBeDefined();
    expect(o!.points).toBe(0);
    expect(o!.budget).toBeLessThan(0);
    for (const a of o!.actions) expect(d.apply(a).ok).toBe(true);
    // The old ring is gone, from the ground to the top.
    for (let y = 0; y < 6; y++) {
      expect(d.base.solidAt(old.x0, y, old.z0 + 3)).toBe(false);
      expect(d.base.solidAt(old.x1, y, old.z0 + 3)).toBe(false);
      expect(d.base.solidAt(old.x0 + 3, y, old.z1)).toBe(false);
    }
    // The outer ring stands, the core is untouched, the budget is back and the room has grown.
    const f = d.base.footprint()!;
    expect(f.x0).toBe(old.x0 - EXPANSION_GAP);
    expect(d.base.solidAt(f.x0, 0, f.z0 + 3)).toBe(true);
    expect(d.base.coreCells().length).toBe(8);
    expect(d.base.cost()).toBeLessThan(costExpanded);
    expect(d.room).toBeGreaterThan(roomExpanded);
    expect(d.room).toBeGreaterThan(roomBefore);
    // Nothing more to dismantle, until the next ring.
    expect(buildOptions(d).find((x) => x.id === 'dismantle-inner')).toBeUndefined();
  });

  it('waits while the outer ring has a hole in it', () => {
    const d = round();
    expand(d);
    const f = d.base.footprint()!;
    expect(d.apply({ type: 'remove', x: f.x0 + 5, y: 1, z: f.z0 }).ok).toBe(true);
    expect(buildOptions(d).find((x) => x.id === 'dismantle-inner')).toBeUndefined();
  });

  it('goes round again with each new ring', () => {
    const d = round();
    for (let i = 0; i < 2; i++) {
      expand(d);
      const o = buildOptions(d).find((x) => x.id === 'dismantle-inner');
      expect(o, `ring ${i + 1}`).toBeDefined();
      for (const a of o!.actions) expect(d.apply(a).ok).toBe(true);
    }
    expect(d.base.coreCells().length).toBe(8);
  });
});
