import { describe, expect, it } from 'vitest';
import { cellIndex, generateTerrain, inGround, isShore } from '../../../src/sim/terrain';

describe('terrain', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = generateTerrain(256, 42);
    const b = generateTerrain(256, 42);
    const c = generateTerrain(256, 43);
    expect(Buffer.from(a.water).equals(Buffer.from(b.water))).toBe(true);
    expect(Buffer.from(a.water).equals(Buffer.from(c.water))).toBe(false);
  });

  it('keeps the spawn area dry and covers a sensible share with water', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const t = generateTerrain(1024, seed, { dryRadius: 28 });
      for (let z = -27; z <= 27; z++) for (let x = -27; x <= 27; x++) if (x * x + z * z < 28 * 28) expect(t.water[cellIndex(1024, x, z)]).toBe(0);
      const share = t.waterCells / (1024 * 1024);
      expect(share).toBeGreaterThan(0.004);
      expect(share).toBeLessThan(0.12);
    }
  });

  it('puts a starter pond within view of the spawn point', () => {
    for (const seed of [1, 7, 2024]) {
      const t = generateTerrain(1024, seed);
      let near = 0;
      for (let z = -80; z < 0; z++) for (let x = -50; x < 50; x++) near += t.water[cellIndex(1024, x, z)];
      expect(near, `seed ${seed}`).toBeGreaterThan(50);
    }
  });

  it('indexes cells and finds shores', () => {
    const t = generateTerrain(64, 5, { dryRadius: 0 });
    expect(inGround(64, -32, -32)).toBe(true);
    expect(inGround(64, 32, 0)).toBe(false);
    expect(cellIndex(64, -32, -32)).toBe(0);
    expect(cellIndex(64, 31, 31)).toBe(64 * 64 - 1);
    t.water.fill(0);
    t.water[cellIndex(64, 0, 0)] = 1;
    expect(isShore(t, 1, 0)).toBe(true);
    expect(isShore(t, 1, 1)).toBe(false);
    expect(isShore(t, 0, 0)).toBe(false); // water itself is not a shore
  });
});
