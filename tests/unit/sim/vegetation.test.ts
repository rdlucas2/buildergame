import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, START_TIME, TICK_SECONDS, daylight, formatClock, isNight, TickAccumulator, timeOfDay } from '../../../src/sim/clock';
import { Ecosystem } from '../../../src/sim/ecosystem';
import { cellIndex } from '../../../src/sim/terrain';
import { SWEEP_TICKS, Vegetation } from '../../../src/sim/vegetation';
import { createPlacement } from '../../../src/core/world';
import { makeStructure } from '../helpers';

/** A 5×4×5 hut: solid roof layer on top, open walls; and a 5×3×5 courtyard: walls only, open top. */
const roofed = makeStructure('roofed', { x: 5, y: 4, z: 5 }, (x, y, z) => y === 3 || x === 0 || z === 0 || x === 4 || z === 4, 'planks', 'roofed');
const courtyard = makeStructure('court', { x: 5, y: 3, z: 5 }, (x, _y, z) => x === 0 || z === 0 || x === 4 || z === 4, 'stone', 'court');
const lookup = (id: string) => (id === 'roofed' ? roofed : id === 'court' ? courtyard : undefined);

function bareEcosystem(): Ecosystem {
  const eco = Ecosystem.create(128, 3);
  eco.terrain.water.fill(0); // make the test area all land
  eco.vegetation.biomass.fill(0);
  return eco;
}

describe('clock', () => {
  it('maps time to day phases', () => {
    expect(timeOfDay(0)).toBe(0);
    expect(timeOfDay(DAY_SECONDS * 1.5)).toBeCloseTo(0.5);
    expect(daylight(DAY_SECONDS * 0.5)).toBe(1); // noon
    expect(daylight(0)).toBe(0); // midnight
    expect(isNight(0)).toBe(true);
    expect(isNight(START_TIME)).toBe(false);
    expect(formatClock(DAY_SECONDS + DAY_SECONDS * (14 / 24) + 5 * 60 * (DAY_SECONDS / 86400))).toBe('Day 2 · 14:05');
  });

  it('turns real time into whole ticks at the chosen speed', () => {
    const acc = new TickAccumulator();
    expect(acc.consume(0.1, 0)).toBe(0);
    expect(acc.consume(0.1, 1)).toBe(1);
    expect(acc.consume(0.1, 16)).toBe(16);
    expect(acc.consume(0.05, 1) + acc.consume(0.05, 1)).toBe(1);
    expect(acc.consume(10, 16)).toBeLessThanOrEqual(200); // long stalls are capped
  });
});

describe('vegetation and sky cover', () => {
  it('a roof covers its whole footprint, an open courtyard covers only its walls', () => {
    const eco = bareEcosystem();
    eco.placementAdded(createPlacement('roofed', { x: 0, y: 0, z: 0 }, 0, 'r'), lookup);
    eco.placementAdded(createPlacement('court', { x: 20, y: 0, z: 0 }, 0, 'c'), lookup);
    const v = eco.vegetation;
    expect(v.isSkylit(2, 2)).toBe(false); // under the roof
    expect(v.isSkylit(22, 2)).toBe(true); // inside the courtyard, open to the sky
    expect(v.isSkylit(20, 2)).toBe(false); // courtyard wall
    expect(v.isSkylit(10, 10)).toBe(true); // open ground
  });

  it('respects rotation and restores the sky when a placement is removed', () => {
    const eco = bareEcosystem();
    const wall = makeStructure('wall', { x: 4, y: 2, z: 1 }, () => true, 'stone', 'wall');
    const look = (id: string) => (id === 'wall' ? wall : undefined);
    eco.placementAdded(createPlacement('wall', { x: 0, y: 0, z: 0 }, 1, 'w'), look); // rotated: 1 wide in x, 4 deep in z
    const v = eco.vegetation;
    expect([0, 1, 2, 3].map((z) => v.isSkylit(0, z))).toEqual([false, false, false, false]);
    expect(v.isSkylit(1, 0)).toBe(true);
    eco.placementRemoved('w');
    expect(v.isSkylit(0, 2)).toBe(true);
    // Overlapping covers are counted, so removing one keeps the other.
    eco.placementAdded(createPlacement('wall', { x: 0, y: 0, z: 0 }, 0, 'a'), look);
    eco.placementAdded(createPlacement('wall', { x: 0, y: 2, z: 0 }, 0, 'b'), look);
    eco.placementRemoved('a');
    expect(v.isSkylit(1, 0)).toBe(false);
  });

  it('grass grows in daylight on open ground, not at night, not on water, and dies under a roof', () => {
    const eco = bareEcosystem();
    const v = eco.vegetation;
    eco.terrain.water[cellIndex(128, 30, 30)] = 1;
    eco.vegetation.biomass.fill(200, 0, 0); // no-op, keep grid bare
    eco.placementAdded(createPlacement('roofed', { x: 0, y: 0, z: 0 }, 0, 'r'), lookup);
    v.biomass[cellIndex(128, 2, 2)] = 255; // lush grass under the new roof

    // Noon: one full sweep.
    eco.time = DAY_SECONDS * 0.5 - TICK_SECONDS;
    for (let i = 0; i < SWEEP_TICKS; i++) eco.tick();
    expect(v.biomassAt(10, 10)).toBeGreaterThan(0);
    expect(v.biomassAt(30, 30)).toBe(0); // water
    expect(v.biomassAt(2, 2)).toBeLessThan(255);

    // Midnight: open ground does not grow, the roofed cell keeps dying back.
    const openBefore = v.biomassAt(10, 10);
    const roofBefore = v.biomassAt(2, 2);
    eco.time = DAY_SECONDS * 2 - 20;
    for (let i = 0; i < SWEEP_TICKS; i++) eco.tick();
    expect(v.biomassAt(10, 10)).toBe(openBefore);
    expect(v.biomassAt(2, 2)).toBeLessThan(roofBefore);

    // A full day of sun and night fills open ground; under the roof it is bare.
    eco.advance(DAY_SECONDS);
    expect(v.biomassAt(10, 10)).toBe(255);
    expect(v.biomassAt(2, 2)).toBe(0);
  });

  it('grazing removes grass and reports what was eaten', () => {
    const eco = bareEcosystem();
    const v = eco.vegetation;
    v.biomass[cellIndex(128, 5, 5)] = 30;
    expect(v.graze(5, 5, 20)).toBe(20);
    expect(v.graze(5, 5, 20)).toBe(10);
    expect(v.biomassAt(5, 5)).toBe(0);
    expect(v.graze(999, 0, 5)).toBe(0);
  });

  it('starting grass is patchy, never on water, and the whole state is reproducible', () => {
    const a = Ecosystem.create(256, 11);
    const b = Ecosystem.create(256, 11);
    a.advance(60);
    b.advance(60);
    expect(Buffer.from(a.vegetation.biomass).equals(Buffer.from(b.vegetation.biomass))).toBe(true);
    for (let i = 0; i < a.terrain.water.length; i++) if (a.terrain.water[i]) expect(a.vegetation.biomass[i]).toBe(0);
    const values = new Set(Vegetation.initialBiomass(a.terrain, 11));
    expect(values.size).toBeGreaterThan(50);
    const restored = Ecosystem.restore(256, a.snapshot());
    expect(restored.time).toBe(a.time);
    expect(Buffer.from(restored.vegetation.biomass).equals(Buffer.from(a.vegetation.biomass))).toBe(true);
  });
});
