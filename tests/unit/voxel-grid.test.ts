import { describe, expect, it } from 'vitest';
import { VoxelGrid } from '../../src/core/voxel-grid';

describe('VoxelGrid', () => {
  it('uses xzy memory order', () => {
    const g = new VoxelGrid({ x: 2, y: 3, z: 4 });
    expect(g.index(1, 0, 0)).toBe(1);
    expect(g.index(0, 0, 1)).toBe(2);
    expect(g.index(0, 1, 0)).toBe(8);
    expect(g.length).toBe(24);
  });

  it('reads air outside bounds and refuses to write there', () => {
    const g = new VoxelGrid({ x: 2, y: 2, z: 2 });
    expect(g.get(-1, 0, 0)).toBe(0);
    expect(g.set(2, 0, 0, 5)).toBe(false);
    expect(g.set(1, 1, 1, 5)).toBe(true);
    expect(g.get(1, 1, 1)).toBe(5);
    expect(g.count()).toBe(1);
  });

  it('finds tight bounds and crops', () => {
    const g = new VoxelGrid({ x: 8, y: 8, z: 8 });
    expect(g.tightBounds()).toBeNull();
    g.set(2, 3, 4, 1);
    g.set(5, 3, 6, 2);
    expect(g.tightBounds()).toEqual({ min: { x: 2, y: 3, z: 4 }, max: { x: 6, y: 4, z: 7 } });
    const c = g.crop(g.tightBounds()!);
    expect(c.size).toEqual({ x: 4, y: 1, z: 3 });
    expect(c.get(0, 0, 0)).toBe(1);
    expect(c.get(3, 0, 2)).toBe(2);
    expect(c.count()).toBe(2);
  });

  it('crops regions partly outside the grid as air', () => {
    const g = new VoxelGrid({ x: 2, y: 1, z: 1 });
    g.set(0, 0, 0, 7);
    const c = g.crop({ min: { x: -1, y: 0, z: 0 }, max: { x: 2, y: 1, z: 1 } });
    expect(Array.from(c.data)).toEqual([0, 7, 0]);
  });

  it('remaps values, resizes and compares', () => {
    const g = new VoxelGrid({ x: 2, y: 1, z: 1 }, Uint16Array.from([3, 1]));
    g.remap(new Map([[3, 1], [1, 2]]));
    expect(Array.from(g.data)).toEqual([1, 2]);
    const r = g.resized({ x: 4, y: 1, z: 1 }, { x: 1, y: 0, z: 0 });
    expect(Array.from(r.data)).toEqual([0, 1, 2, 0]);
    expect(VoxelGrid.equals(g, g.clone())).toBe(true);
    expect(VoxelGrid.equals(g, r)).toBe(false);
  });

  it('rejects mismatched data length', () => {
    expect(() => new VoxelGrid({ x: 2, y: 2, z: 2 }, new Uint16Array(3))).toThrow();
  });
});
