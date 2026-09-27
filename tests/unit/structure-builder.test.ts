import { describe, expect, it } from 'vitest';
import { StructureBuilder } from '../../src/core/structure-builder';

describe('StructureBuilder', () => {
  it('fills inclusive boxes in any corner order and tracks the palette', () => {
    const b = new StructureBuilder({ x: 4, y: 4, z: 4 });
    b.fill(2, 1, 2, 0, 0, 0, 'stone');
    expect(b.grid.count()).toBe(18);
    expect(b.get(2, 1, 2)).toBe('stone');
    expect(b.get(3, 0, 0)).toBeNull();
    b.set(3, 3, 3, 'glass').set(0, 0, 0, null);
    expect(b.palette.map((p) => p.material)).toEqual(['stone', 'glass']);
    expect(b.grid.count()).toBe(18);
  });

  it('builds walls without floor or ceiling', () => {
    const b = new StructureBuilder({ x: 5, y: 2, z: 5 }).walls(0, 0, 0, 4, 1, 4, 'planks');
    expect(b.grid.count()).toBe(2 * 16);
    expect(b.isSolid(2, 0, 2)).toBe(false);
  });

  it('replaces only matching cells inside a box', () => {
    const b = new StructureBuilder({ x: 3, y: 1, z: 1 }).set(0, 0, 0, 'stone').set(1, 0, 0, 'brick');
    b.replace(0, 0, 0, 2, 0, 0, 'stone', 'gold');
    expect([b.get(0, 0, 0), b.get(1, 0, 0), b.get(2, 0, 0)]).toEqual(['gold', 'brick', null]);
    b.replace(0, 0, 0, 2, 0, 0, '*', 'marble');
    expect([b.get(0, 0, 0), b.get(1, 0, 0), b.get(2, 0, 0)]).toEqual(['marble', 'marble', null]);
  });

  it('steps a gable roof inward to a ridge and fills the gable ends', () => {
    const b = new StructureBuilder({ x: 7, y: 10, z: 9 });
    // walls x 1..5, z 1..7 (7 deep): layers at z 0/8, 1/7, 2/6, 3/5, then ridge 4.
    const ridge = b.gableRoofX(1, 5, 1, 7, 2, 'brick', { overhang: 1, gable: 'planks', ridge: 'stone' });
    expect(ridge).toBe(6);
    expect(b.get(0, 2, 0)).toBe('brick');
    expect(b.get(6, 2, 8)).toBe('brick');
    expect(b.get(3, 6, 4)).toBe('stone');
    expect(b.get(1, 3, 4)).toBe('planks'); // gable end
    expect(b.get(3, 3, 4)).toBeNull(); // attic interior stays open
  });

  it('builds a normalized structure with the given identity', () => {
    const s = new StructureBuilder({ x: 10, y: 10, z: 10 })
      .fill(2, 0, 3, 4, 1, 3, 'stone')
      .build({ id: 'x', name: 'Thing', author: 'me', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(s).toMatchObject({ id: 'x', name: 'Thing', author: 'me', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(s.voxels.size).toEqual({ x: 3, y: 2, z: 1 });
  });
});
