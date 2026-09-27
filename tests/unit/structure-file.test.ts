import { describe, expect, it } from 'vitest';
import { decodeStructure, encodeStructure, parseStructure, serializeStructure, structureDownloadName } from '../../src/core/format/structure-file';
import { createStructure, normalizeStructure, paletteEntryForMaterialId, structureContentEquals } from '../../src/core/structure';
import { VoxelGrid } from '../../src/core/voxel-grid';
import { makeStructure } from './helpers';

describe('structure file', () => {
  it('round-trips through JSON including palette flags and thumbnail', () => {
    const grid = new VoxelGrid({ x: 3, y: 2, z: 2 });
    grid.set(0, 0, 0, 1);
    grid.set(2, 1, 1, 2);
    const s = createStructure({
      name: 'Hut',
      author: 'me',
      voxels: grid,
      palette: [paletteEntryForMaterialId('planks'), paletteEntryForMaterialId('glass')],
      thumbnail: 'data:image/png;base64,AAAA',
    });
    const text = serializeStructure(s);
    const back = parseStructure(text);
    expect(back.id).toBe(s.id);
    expect(back.name).toBe('Hut');
    expect(back.author).toBe('me');
    expect(back.palette).toEqual([
      { material: 'planks', color: '#b8894a' },
      { material: 'glass', color: '#a8d8f0', transparent: true },
    ]);
    expect(back.thumbnail).toBe(s.thumbnail);
    expect(structureContentEquals(back, s)).toBe(true);
    expect(encodeStructure(s).voxels.order).toBe('xzy');
  });

  it('rejects files of the wrong format, bad palette references and corrupt voxels', () => {
    const good = encodeStructure(makeStructure('a', { x: 2, y: 1, z: 1 }));
    expect(() => decodeStructure({ ...good, format: 'other' })).toThrow(/Invalid structure file/);
    expect(() => decodeStructure({ ...good, version: 2 })).toThrow(/version/);
    expect(() => decodeStructure({ ...good, palette: [] })).toThrow(/palette slot/);
    expect(() => decodeStructure({ ...good, voxels: { ...good.voxels, data: 'AQAB' } })).toThrow(/corrupt/);
    expect(() => decodeStructure({ ...good, palette: [{ material: 'x', color: 'red' }] })).toThrow(/hex colour/);
    expect(() => parseStructure('{not json')).toThrow(/not valid JSON/);
  });

  it('normalizes: crops to the used volume and compacts the palette', () => {
    const grid = new VoxelGrid({ x: 10, y: 10, z: 10 });
    grid.set(4, 2, 5, 3);
    grid.set(6, 2, 5, 1);
    const s = createStructure({
      name: 'sparse',
      voxels: grid,
      palette: [paletteEntryForMaterialId('stone'), paletteEntryForMaterialId('brick'), paletteEntryForMaterialId('gold')],
    });
    const n = normalizeStructure(s);
    expect(n.voxels.size).toEqual({ x: 3, y: 1, z: 1 });
    expect(n.palette.map((p) => p.material)).toEqual(['gold', 'stone']);
    expect(Array.from(n.voxels.data)).toEqual([1, 0, 2]);
    expect(() => normalizeStructure(createStructure({ name: 'empty', voxels: new VoxelGrid({ x: 2, y: 2, z: 2 }), palette: [] }))).toThrow(
      /at least one block/,
    );
  });

  it('suggests a safe download name', () => {
    expect(structureDownloadName(makeStructure('My Tower / v2!', { x: 1, y: 1, z: 1 }))).toBe('My_Tower_v2.structure.json');
    expect(structureDownloadName(makeStructure('   ', { x: 1, y: 1, z: 1 }))).toBe('structure.structure.json');
  });
});
