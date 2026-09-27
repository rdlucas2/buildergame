import { describe, expect, it } from 'vitest';
import { rayPlaneY, raycastVoxels } from '../../src/core/raycast';

describe('raycastVoxels', () => {
  const solid = (x: number, y: number, z: number) => x === 5 && y === 0 && z === 0;

  it('hits the first solid voxel with the entered face normal', () => {
    const hit = raycastVoxels({ origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } }, 20, solid);
    expect(hit).not.toBeNull();
    expect(hit!.voxel).toEqual({ x: 5, y: 0, z: 0 });
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
    expect(hit!.distance).toBeCloseTo(4.5, 5);
  });

  it('returns null beyond max distance or when nothing is hit', () => {
    expect(raycastVoxels({ origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } }, 3, solid)).toBeNull();
    expect(raycastVoxels({ origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 0, y: 1, z: 0 } }, 50, solid)).toBeNull();
  });

  it('reports the top face when looking down onto a block', () => {
    const hit = raycastVoxels({ origin: { x: 5.5, y: 4, z: 0.5 }, direction: { x: 0, y: -1, z: 0 } }, 10, solid);
    expect(hit!.voxel).toEqual({ x: 5, y: 0, z: 0 });
    expect(hit!.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('handles diagonal rays and negative coordinates', () => {
    const isSolid = (x: number, y: number, z: number) => x === -3 && y === -3 && z === -3;
    const hit = raycastVoxels({ origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: -1, y: -1, z: -1 } }, 20, isSolid);
    expect(hit!.voxel).toEqual({ x: -3, y: -3, z: -3 });
  });

  it('reports a zero normal when starting inside a solid voxel', () => {
    const hit = raycastVoxels({ origin: { x: 5.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } }, 10, solid);
    expect(hit!.distance).toBe(0);
    expect(hit!.normal).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rayPlaneY finds the ground plane', () => {
    expect(rayPlaneY({ origin: { x: 0, y: 4, z: 0 }, direction: { x: 0, y: -1, z: 0 } }, 0)).toBeCloseTo(4);
    expect(rayPlaneY({ origin: { x: 0, y: 4, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, 0)).toBeNull();
    expect(rayPlaneY({ origin: { x: 0, y: 4, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, 0)).toBeNull();
  });
});
