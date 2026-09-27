import { describe, expect, it } from 'vitest';
import { VoxelGrid } from '../../src/core/voxel-grid';
import { AO_LEVELS, greedyMesh, type MeshPalette } from '../../src/render/greedy-mesh';

const palette: MeshPalette = {
  colorOf: (v) => (v === 4 ? [1, 1, 1] : [v === 1 ? 1 : 0, v === 2 ? 1 : 0, v === 3 ? 1 : 0]),
  isTransparent: (v) => v === 3,
  isEmissive: (v) => v === 4,
};

function gridOf(size: { x: number; y: number; z: number }, fill: (x: number, y: number, z: number) => number): VoxelGrid {
  const g = new VoxelGrid(size);
  for (let y = 0; y < size.y; y++) for (let z = 0; z < size.z; z++) for (let x = 0; x < size.x; x++) g.set(x, y, z, fill(x, y, z));
  return g;
}

function regionOf(g: VoxelGrid) {
  return { min: { x: 0, y: 0, z: 0 }, max: { ...g.size } };
}

function normalsOf(m: ReturnType<typeof greedyMesh>): string[] {
  const out: string[] = [];
  for (let i = 0; i < m.quadCount; i++) out.push(`${m.normals[i * 12]},${m.normals[i * 12 + 1]},${m.normals[i * 12 + 2]}`);
  return out.sort();
}

describe('greedyMesh', () => {
  it('meshes a single voxel as 6 quads with outward normals', () => {
    const g = gridOf({ x: 1, y: 1, z: 1 }, () => 1);
    const m = greedyMesh(g, regionOf(g), palette);
    expect(m.quadCount).toBe(6);
    expect(m.vertexCount).toBe(24);
    expect(m.indices.length).toBe(36);
    expect(normalsOf(m)).toEqual(['-1,0,0', '0,-1,0', '0,0,-1', '0,0,1', '0,1,0', '1,0,0']);
    for (let i = 0; i < m.indices.length; i++) expect(m.indices[i]).toBeLessThan(24);
  });

  it('merges coplanar faces of the same material', () => {
    const cube = gridOf({ x: 4, y: 4, z: 4 }, () => 1);
    expect(greedyMesh(cube, regionOf(cube), palette).quadCount).toBe(6);
    const column = gridOf({ x: 1, y: 1, z: 2 }, () => 1);
    expect(greedyMesh(column, regionOf(column), palette).quadCount).toBe(6);
  });

  it('does not merge different materials', () => {
    const g = gridOf({ x: 1, y: 1, z: 2 }, (_x, _y, z) => (z === 0 ? 1 : 2));
    expect(greedyMesh(g, regionOf(g), palette).quadCount).toBe(10);
  });

  it('keeps faces around an enclosed cavity', () => {
    const g = gridOf({ x: 3, y: 3, z: 3 }, (x, y, z) => (x === 1 && y === 1 && z === 1 ? 0 : 1));
    expect(greedyMesh(g, regionOf(g), palette, { ao: false }).quadCount).toBe(12);
  });

  it('splits opaque and transparent passes and culls hidden glass faces', () => {
    const g = gridOf({ x: 2, y: 1, z: 1 }, (x) => (x === 0 ? 1 : 3));
    const opaque = greedyMesh(g, regionOf(g), palette, { pass: 'opaque' });
    const glass = greedyMesh(g, regionOf(g), palette, { pass: 'transparent' });
    expect(opaque.quadCount).toBe(6); // stone face towards the glass is drawn
    expect(glass.quadCount).toBe(5); // glass face towards the stone is hidden
    expect(normalsOf(glass)).not.toContain('-1,0,0');
  });

  it('bakes ambient occlusion into vertex colours', () => {
    // A floor with one block on top: floor top corners next to the block get darker.
    const g = gridOf({ x: 3, y: 2, z: 3 }, (x, y, z) => (y === 0 ? 1 : x === 1 && z === 1 ? 1 : 0));
    const lit = greedyMesh(g, regionOf(g), palette, { ao: true });
    const flat = greedyMesh(g, regionOf(g), palette, { ao: false });
    expect(lit.quadCount).toBeGreaterThan(flat.quadCount); // AO breaks up the merged floor top
    const reds = new Set<number>();
    for (let i = 0; i < lit.colors.length; i += 3) reds.add(Math.round(lit.colors[i] * 100) / 100);
    expect(reds.size).toBeGreaterThan(1);
    for (const r of reds) expect(r).toBeGreaterThanOrEqual(AO_LEVELS[0] - 1e-6);
    for (let i = 0; i < flat.colors.length; i += 3) expect(flat.colors[i]).toBe(1);
  });

  it('emissive materials ignore occlusion', () => {
    const g = gridOf({ x: 3, y: 2, z: 3 }, (x, y, z) => (y === 0 ? 4 : x === 1 && z === 1 ? 1 : 0));
    const m = greedyMesh(g, regionOf(g), palette);
    let topFaces = 0;
    for (let i = 0; i < m.quadCount; i++) {
      if (m.normals[i * 12 + 1] === 1 && m.positions[i * 12 + 1] === 1) {
        topFaces++;
        for (let k = 0; k < 4; k++) expect(m.colors[i * 12 + k * 3]).toBe(1); // white, never darkened
      }
    }
    expect(topFaces).toBeGreaterThan(0);
  });

  it('meshes regions independently without seams at region borders', () => {
    const g = gridOf({ x: 4, y: 1, z: 1 }, () => 1);
    const a = greedyMesh(g, { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 1, z: 1 } }, palette);
    const b = greedyMesh(g, { min: { x: 2, y: 0, z: 0 }, max: { x: 4, y: 1, z: 1 } }, palette);
    expect(a.quadCount + b.quadCount).toBe(10);
    for (const m of [a, b]) {
      for (let i = 0; i < m.quadCount; i++) {
        const nx = m.normals[i * 12];
        const px = m.positions[i * 12];
        if (nx !== 0) expect(px === 0 || px === 4).toBe(true); // no x-facing faces at the shared plane x = 2
      }
    }
  });

  it('returns an empty mesh for empty regions', () => {
    const g = new VoxelGrid({ x: 2, y: 2, z: 2 });
    expect(greedyMesh(g, regionOf(g), palette).quadCount).toBe(0);
    expect(greedyMesh(g, { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, palette).vertexCount).toBe(0);
  });

  it('handles a 64^3 solid quickly', () => {
    const g = gridOf({ x: 64, y: 64, z: 64 }, () => 1);
    const t0 = performance.now();
    const m = greedyMesh(g, regionOf(g), palette);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(m.quadCount).toBe(6);
  });
});
