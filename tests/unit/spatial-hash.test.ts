import { describe, expect, it } from 'vitest';
import { aabbFromPosSize } from '../../src/core/math';
import { SpatialHash } from '../../src/core/spatial-hash';

describe('SpatialHash', () => {
  it('returns keys in overlapping cells and forgets removed keys', () => {
    const h = new SpatialHash<string>(16);
    h.insert('a', aabbFromPosSize({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 }));
    h.insert('b', aabbFromPosSize({ x: 40, y: 0, z: 40 }, { x: 4, y: 4, z: 4 }));
    h.insert('c', aabbFromPosSize({ x: -20, y: 0, z: -20 }, { x: 4, y: 4, z: 4 }));
    expect(h.query(aabbFromPosSize({ x: 2, y: 0, z: 2 }, { x: 1, y: 1, z: 1 }))).toEqual(['a']);
    expect(h.query(aabbFromPosSize({ x: -18, y: 1, z: -18 }, { x: 1, y: 1, z: 1 }))).toEqual(['c']);
    expect(h.query(aabbFromPosSize({ x: 100, y: 0, z: 100 }, { x: 1, y: 1, z: 1 }))).toEqual([]);
    expect(h.size).toBe(3);
    expect(h.remove('a')).toBe(true);
    expect(h.remove('a')).toBe(false);
    expect(h.query(aabbFromPosSize({ x: 2, y: 0, z: 2 }, { x: 1, y: 1, z: 1 }))).toEqual([]);
  });

  it('registers boxes spanning several cells in every cell', () => {
    const h = new SpatialHash<string>(16);
    h.insert('wide', aabbFromPosSize({ x: -5, y: 0, z: 10 }, { x: 40, y: 3, z: 3 }));
    expect(h.query(aabbFromPosSize({ x: -5, y: 0, z: 10 }, { x: 1, y: 1, z: 1 }))).toEqual(['wide']);
    expect(h.query(aabbFromPosSize({ x: 30, y: 0, z: 10 }, { x: 1, y: 1, z: 1 }))).toEqual(['wide']);
    expect(h.query(aabbFromPosSize({ x: 48, y: 0, z: 10 }, { x: 1, y: 1, z: 1 }))).toEqual([]); // candidates are per 16-cell
  });

  it('re-inserting a key moves it', () => {
    const h = new SpatialHash<string>(8);
    h.insert('a', aabbFromPosSize({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }));
    h.insert('a', aabbFromPosSize({ x: 50, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }));
    expect(h.query(aabbFromPosSize({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }))).toEqual([]);
    expect(h.queryPoint({ x: 50, y: 0, z: 0 })).toEqual(['a']);
    expect(h.boundsOf('a')?.min.x).toBe(50);
  });
});
