import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ROTATIONS, rotateGrid, rotateLocal, rotatedSize, rotationOffset, unrotateLocal } from '../../src/core/rotation';
import { VoxelGrid } from '../../src/core/voxel-grid';

const SIZES = [
  { x: 1, y: 1, z: 1 },
  { x: 3, y: 2, z: 5 },
  { x: 4, y: 1, z: 4 },
];

describe('rotation', () => {
  it('swaps x/z for odd turns', () => {
    expect(rotatedSize({ x: 3, y: 2, z: 5 }, 1)).toEqual({ x: 5, y: 2, z: 3 });
    expect(rotatedSize({ x: 3, y: 2, z: 5 }, 2)).toEqual({ x: 3, y: 2, z: 5 });
  });

  it('rotateLocal is a bijection onto the rotated footprint and unrotateLocal inverts it', () => {
    for (const size of SIZES) {
      for (const r of ROTATIONS) {
        const rs = rotatedSize(size, r);
        const seen = new Set<string>();
        for (let x = 0; x < size.x; x++) {
          for (let z = 0; z < size.z; z++) {
            const [rx, rz] = rotateLocal(x, z, size, r);
            expect(rx).toBeGreaterThanOrEqual(0);
            expect(rz).toBeGreaterThanOrEqual(0);
            expect(rx).toBeLessThan(rs.x);
            expect(rz).toBeLessThan(rs.z);
            seen.add(`${rx},${rz}`);
            expect(unrotateLocal(rx, rz, size, r)).toEqual([x, z]);
          }
        }
        expect(seen.size).toBe(size.x * size.z);
      }
    }
  });

  it('four quarter turns return the original grid', () => {
    const g = new VoxelGrid({ x: 3, y: 2, z: 5 });
    for (let i = 0; i < g.length; i++) g.data[i] = (i * 7) % 4;
    let cur = g;
    for (let i = 0; i < 4; i++) cur = rotateGrid(cur, 1);
    expect(VoxelGrid.equals(cur, g)).toBe(true);
    expect(VoxelGrid.equals(rotateGrid(rotateGrid(g, 1), 1), rotateGrid(g, 2))).toBe(true);
    expect(VoxelGrid.equals(rotateGrid(rotateGrid(g, 2), 1), rotateGrid(g, 3))).toBe(true);
  });

  it('mesh transform (rotation.y + rotationOffset) agrees with rotateLocal for every voxel', () => {
    for (const size of SIZES) {
      for (const r of ROTATIONS) {
        const m = new Matrix4().makeRotationY((r * Math.PI) / 2);
        const off = rotationOffset(size, r);
        for (let x = 0; x < size.x; x++) {
          for (let z = 0; z < size.z; z++) {
            const p = new Vector3(x + 0.5, 0.5, z + 0.5).applyMatrix4(m);
            p.x += off.x;
            p.z += off.z;
            expect([Math.floor(p.x), Math.floor(p.z)]).toEqual(rotateLocal(x, z, size, r));
          }
        }
      }
    }
  });
});
