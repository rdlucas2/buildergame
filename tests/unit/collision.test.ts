import { describe, expect, it } from 'vitest';
import { checkPlacement } from '../../src/core/collision';
import { aabbFromPosSize } from '../../src/core/math';
import type { Structure } from '../../src/core/structure';
import { createPlacement, placementVoxelAt } from '../../src/core/world';
import { WorldIndex } from '../../src/core/world-index';
import { cube, lShape } from './helpers';

function indexWith(structures: Structure[]): WorldIndex {
  const byId = new Map(structures.map((s) => [s.id, s]));
  return new WorldIndex((id) => byId.get(id));
}

describe('checkPlacement', () => {
  const box = cube('box', 2, 'box');
  const ell = lShape('ell', 'ell');

  it('rejects overlapping and accepts adjacent placements', () => {
    const idx = indexWith([box]);
    idx.add(createPlacement('box', { x: 0, y: 0, z: 0 }, 0, 'p1'));
    expect(checkPlacement(idx, box, { x: 1, y: 0, z: 1 }, 0)).toMatchObject({ ok: false, reason: 'overlap', collidingIds: ['p1'] });
    expect(checkPlacement(idx, box, { x: 2, y: 0, z: 0 }, 0).ok).toBe(true);
    expect(checkPlacement(idx, box, { x: 0, y: 2, z: 0 }, 0).ok).toBe(true);
    expect(checkPlacement(idx, box, { x: -2, y: 0, z: -2 }, 0).ok).toBe(true);
  });

  it('rejects placements below the ground and outside world bounds', () => {
    const idx = indexWith([box]);
    expect(checkPlacement(idx, box, { x: 0, y: -1, z: 0 }, 0).reason).toBe('below-ground');
    const worldBounds = aabbFromPosSize({ x: -8, y: 0, z: -8 }, { x: 16, y: 16, z: 16 });
    expect(checkPlacement(idx, box, { x: 7, y: 0, z: 0 }, 0, { worldBounds }).reason).toBe('out-of-bounds');
    expect(checkPlacement(idx, box, { x: 6, y: 0, z: 0 }, 0, { worldBounds }).ok).toBe(true);
  });

  it('voxel mode lets two L shapes interlock while aabb mode does not', () => {
    const idx = indexWith([ell]);
    idx.add(createPlacement('ell', { x: 0, y: 0, z: 0 }, 0, 'p1'));
    // The second L, rotated twice, has its empty quadrant at (x<2 && z<2) in its own frame; placed at
    // (1,0,1) it fills exactly the first L's empty quadrant plus space beyond it.
    const pos = { x: 1, y: 0, z: 1 };
    expect(checkPlacement(idx, ell, pos, 2, { mode: 'voxel' }).ok).toBe(true);
    expect(checkPlacement(idx, ell, pos, 2, { mode: 'aabb' })).toMatchObject({ ok: false, reason: 'overlap' });
    // Shifted one cell along x only, the second L lands solid-on-solid with the first.
    expect(checkPlacement(idx, ell, { x: 1, y: 0, z: 0 }, 0, { mode: 'voxel' })).toMatchObject({ ok: false, reason: 'overlap' });
  });

  it('ignores listed placements so a structure can be moved over its own old spot', () => {
    const idx = indexWith([box]);
    idx.add(createPlacement('box', { x: 0, y: 0, z: 0 }, 0, 'p1'));
    expect(checkPlacement(idx, box, { x: 1, y: 0, z: 0 }, 0).ok).toBe(false);
    expect(checkPlacement(idx, box, { x: 1, y: 0, z: 0 }, 0, { ignoreIds: new Set(['p1']) }).ok).toBe(true);
  });

  it('respects rotation when sampling placed voxels', () => {
    const p = createPlacement('ell', { x: 10, y: 0, z: 10 }, 1, 'p');
    // Unrotated L is empty at (x>0 && z>0): (1,0,1),(2,0,1),(1,0,2),(2,0,2).
    // rotateLocal for r=1 with size 3x3: (x,z) -> (z, 2-x). Empty cells map to (1,1),(1,0),(2,1),(2,0).
    expect(placementVoxelAt(ell, p, 11, 0, 11)).toBe(0);
    expect(placementVoxelAt(ell, p, 12, 0, 10)).toBe(0);
    expect(placementVoxelAt(ell, p, 10, 0, 10)).toBe(1);
    expect(placementVoxelAt(ell, p, 10, 0, 12)).toBe(1);
    expect(placementVoxelAt(ell, p, 13, 0, 10)).toBe(0); // outside
    expect(placementVoxelAt(ell, p, 10, 1, 10)).toBe(0); // above
  });

  it('scales: 1000 placements, query touches only nearby ones', () => {
    const idx = indexWith([box]);
    for (let i = 0; i < 1000; i++) idx.add(createPlacement('box', { x: (i % 50) * 3, y: 0, z: Math.floor(i / 50) * 3 }, 0, `p${i}`));
    const t0 = performance.now();
    let rejected = 0;
    for (let i = 0; i < 1000; i++) if (!checkPlacement(idx, box, { x: (i % 50) * 3 + 1, y: 0, z: Math.floor(i / 50) * 3 }, 0).ok) rejected++;
    const ms = performance.now() - t0;
    expect(rejected).toBe(1000);
    expect(ms).toBeLessThan(500);
    // Broadphase returns everything registered in the 16-voxel cell: 6 x 6 boxes spaced 3 apart.
    expect(idx.query(aabbFromPosSize({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })).length).toBe(36);
  });
});
