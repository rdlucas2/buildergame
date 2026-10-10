import { describe, expect, it } from 'vitest';
import { expansion } from '../../../src/sim/defense/advisor';
import { startRound } from '../../../src/sim/defense/replay';

describe('a Warren Defense warren is sealed', () => {
  it('the starter warren has no gap at ground level: rabbits need nothing outside', () => {
    const d = startRound(1).defense!;
    const f = d.base.footprint()!;
    for (let z = f.z0; z <= f.z1; z++)
      for (let x = f.x0; x <= f.x1; x++) if (x === f.x0 || x === f.x1 || z === f.z0 || z === f.z1) expect(d.base.solidAt(x, 0, z), `${x},${z}`).toBe(true);
  });

  it('a new ring of walls has none either', () => {
    const d = startRound(1).defense!;
    const ring = expansion(d)!;
    expect(ring.some((b) => b.y === 0)).toBe(true);
    const f = d.base.footprint()!;
    const x0 = f.x0 - 4, x1 = f.x1 + 4, z0 = f.z0 - 4, z1 = f.z1 + 4;
    const at = new Set(ring.map((b) => `${b.x},${b.y},${b.z}`));
    for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) expect(at.has(`${x},0,${z}`), `${x},${z}`).toBe(true);
    for (let z = z0; z <= z1; z++) for (const x of [x0, x1]) expect(at.has(`${x},0,${z}`), `${x},${z}`).toBe(true);
  });

  it('every rabbit starts inside the walls', () => {
    const eco = startRound(1);
    const f = eco.defense!.base.footprint()!;
    for (const c of eco.population.creatures) if (c.species === 'prey') expect(c.x >= f.x0 && c.x <= f.x1 + 1 && c.z >= f.z0 && c.z <= f.z1 + 1).toBe(true);
  });

  it('breeders stay inside: the steps up the wall are for defenders', () => {
    const eco = startRound(5);
    const f = eco.defense!.base.footprint()!;
    eco.advance(240);
    const breeders = eco.population.creatures.filter((c) => c.species === 'prey' && c.role !== 'defender' && c.deadFor < 0);
    expect(breeders.length).toBeGreaterThan(5);
    for (const c of breeders) {
      expect(c.y).toBeLessThanOrEqual(2);
      expect(c.x >= f.x0 && c.x <= f.x1 + 1 && c.z >= f.z0 && c.z <= f.z1 + 1, `${c.x},${c.z}`).toBe(true);
    }
  });
});
