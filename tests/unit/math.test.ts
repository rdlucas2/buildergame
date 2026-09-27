import { describe, expect, it } from 'vitest';
import { aabbContainsAABB, aabbFromPosSize, aabbIntersection, aabbIntersects, aabbVolume, floorDiv } from '../../src/core/math';

describe('AABB', () => {
  const a = aabbFromPosSize({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 });

  it('intersects overlapping boxes and not touching ones', () => {
    expect(aabbIntersects(a, aabbFromPosSize({ x: 3, y: 3, z: 3 }, { x: 2, y: 2, z: 2 }))).toBe(true);
    expect(aabbIntersects(a, aabbFromPosSize({ x: 4, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }))).toBe(false);
    expect(aabbIntersects(a, aabbFromPosSize({ x: -2, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }))).toBe(false);
    expect(aabbIntersects(a, aabbFromPosSize({ x: 0, y: 4, z: 0 }, { x: 2, y: 2, z: 2 }))).toBe(false);
  });

  it('computes the overlapping region', () => {
    const r = aabbIntersection(a, aabbFromPosSize({ x: 2, y: -1, z: 3 }, { x: 5, y: 3, z: 5 }));
    expect(r).toEqual({ min: { x: 2, y: 0, z: 3 }, max: { x: 4, y: 2, z: 4 } });
    expect(aabbVolume(r!)).toBe(4);
    expect(aabbIntersection(a, aabbFromPosSize({ x: 10, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }))).toBeNull();
  });

  it('checks containment', () => {
    expect(aabbContainsAABB(a, aabbFromPosSize({ x: 1, y: 1, z: 1 }, { x: 3, y: 3, z: 3 }))).toBe(true);
    expect(aabbContainsAABB(a, aabbFromPosSize({ x: 1, y: 1, z: 1 }, { x: 4, y: 3, z: 3 }))).toBe(false);
  });

  it('floorDiv handles negatives', () => {
    expect(floorDiv(-1, 16)).toBe(-1);
    expect(floorDiv(-16, 16)).toBe(-1);
    expect(floorDiv(-17, 16)).toBe(-2);
    expect(floorDiv(15, 16)).toBe(0);
  });
});
