import { describe, expect, it } from 'vitest';
import { decodeWorldBundle, encodeWorldBundle, resolveBundleConflicts } from '../../src/core/format/bundle';
import { structureContentEquals } from '../../src/core/structure';
import { createPlacement, createWorld } from '../../src/core/world';
import { cube, lShape } from './helpers';

describe('world bundle', () => {
  it('round-trips a world with its structures through a zip', () => {
    const a = cube('A', 2, 'a');
    const b = lShape('B', 'b');
    const w = createWorld({ name: 'Bundle' });
    w.placements.push(createPlacement('a', { x: 0, y: 0, z: 0 }, 0, 'p1'), createPlacement('b', { x: 5, y: 0, z: 5 }, 2, 'p2'));
    const bytes = encodeWorldBundle({ world: w, structures: [a, b] });
    const back = decodeWorldBundle(bytes);
    expect(back.world).toEqual(w);
    expect(back.structures.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(structureContentEquals(back.structures.find((s) => s.id === 'b')!, b)).toBe(true);
  });

  it('fails clearly when a referenced structure file is missing or the zip is garbage', () => {
    const w = createWorld({ name: 'x' });
    w.placements.push(createPlacement('a', { x: 0, y: 0, z: 0 }, 0, 'p1'));
    expect(() => encodeWorldBundle({ world: w, structures: [] })).not.toThrow();
    expect(() => decodeWorldBundle(encodeWorldBundle({ world: w, structures: [] }))).toThrow(/missing structure file/);
    expect(() => decodeWorldBundle(new Uint8Array([1, 2, 3]))).toThrow(/Invalid world bundle/);
  });

  it('resolves id conflicts: reuses identical, renames different, remaps placements', () => {
    const same = cube('same', 2, 'same');
    const clash = cube('clash', 3, 'clash');
    const fresh = cube('fresh', 1, 'fresh');
    const w = createWorld({ name: 'w', id: 'w1' });
    w.placements.push(
      createPlacement('same', { x: 0, y: 0, z: 0 }, 0, 'p1'),
      createPlacement('clash', { x: 9, y: 0, z: 0 }, 1, 'p2'),
      createPlacement('fresh', { x: 20, y: 0, z: 0 }, 0, 'p3'),
    );
    const existing = new Map([
      ['same', cube('same-copy', 2, 'same')],
      ['clash', cube('different', 4, 'clash')],
    ]);
    const r = resolveBundleConflicts({ world: w, structures: [same, clash, fresh] }, (id) => existing.get(id), (id) => id === 'w1');
    expect(r.reused).toEqual(['same']);
    expect(r.renamed.length).toBe(1);
    expect(r.renamed[0].from).toBe('clash');
    const newId = r.renamed[0].to;
    expect(r.bundle.structures.map((s) => s.id)).toEqual([newId, 'fresh']);
    expect(r.bundle.world.id).not.toBe('w1');
    expect(r.bundle.world.placements.map((p) => p.structureId)).toEqual(['same', newId, 'fresh']);
    expect(new Set(r.bundle.world.placements.map((p) => p.id)).size).toBe(3);
  });
});
