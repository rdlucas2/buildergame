import { describe, expect, it } from 'vitest';
import { buildOptions } from '../../../src/sim/defense/advisor';
import { startRound } from '../../../src/sim/defense/replay';

function round() {
  const eco = startRound(1);
  return eco.defense!;
}

describe('thicken the walls', () => {
  it('is offered from the start, costs budget only, and builds inside the outer ring', () => {
    const d = round();
    const o = buildOptions(d).find((x) => x.id === 'thicken-walls');
    expect(o).toBeDefined();
    expect(o!.points).toBe(0);
    expect(o!.budget).toBeGreaterThan(0);
    const f = d.base.footprint()!;
    for (const a of o!.actions) {
      if (a.type !== 'placeMany') continue;
      for (const b of a.blocks) {
        const onRing = b.x === f.x0 || b.x === f.x1 || b.z === f.z0 || b.z === f.z1;
        expect(onRing).toBe(false);
        expect(b.x).toBeGreaterThan(f.x0);
        expect(b.x).toBeLessThan(f.x1);
        expect(b.z).toBeGreaterThan(f.z0);
        expect(b.z).toBeLessThan(f.z1);
      }
    }
  });

  it('keeps the rabbits their doorways, the one core, and most of their room', () => {
    const d = round();
    const roomBefore = d.room;
    const doorways = () => {
      const f = d.base.footprint()!;
      let n = 0;
      for (let z = f.z0; z <= f.z1; z++) for (let x = f.x0; x <= f.x1; x++) if ((x === f.x0 || x === f.x1 || z === f.z0 || z === f.z1) && !d.base.solidAt(x, 0, z) && d.base.solidAt(x, 1, z)) n++;
      return n;
    };
    const gaps = doorways();
    const o = buildOptions(d).find((x) => x.id === 'thicken-walls')!;
    for (const a of o.actions) expect(d.apply(a).ok).toBe(true);
    expect(doorways()).toBe(gaps);
    expect(d.base.coreCells().length).toBe(8);
    expect(d.room).toBeGreaterThanOrEqual(Math.floor(roomBefore * 0.8));
    // A doorway is still open right through the new layer: rabbits can walk in and out.
    const f = d.base.footprint()!;
    const mx = Math.floor((f.x0 + f.x1) / 2);
    expect(d.base.solidAt(mx, 0, f.z0 + 1)).toBe(false);
  });

  it('goes round the warren a side at a time, two layers deep, then there is nothing left', () => {
    const d = round();
    let done = 0;
    for (;;) {
      d.budget += 5000;
      const o = buildOptions(d).find((x) => x.id === 'thicken-walls');
      if (!o) break;
      for (const a of o.actions) expect(d.apply(a).ok).toBe(true);
      done++;
      expect(done).toBeLessThanOrEqual(8);
    }
    expect(done).toBe(8);
  });

  it('one side costs little enough for a young warren to afford', () => {
    const d = round();
    const o = buildOptions(d).find((x) => x.id === 'thicken-walls')!;
    expect(o.budget).toBeLessThan(d.budget - d.base.cost());
  });
});
