import { describe, expect, it } from 'vitest';
import { decodeWorld, encodeWorld, parseWorld, serializeWorld } from '../../src/core/format/world-file';
import { createPlacement, createWorld } from '../../src/core/world';

describe('world file', () => {
  it('round-trips and lists referenced structures once each', () => {
    const w = createWorld({ name: 'Home' });
    w.placements.push(createPlacement('s1', { x: 1, y: 0, z: -2 }, 3, 'p1'));
    w.placements.push(createPlacement('s2', { x: 10, y: 0, z: 10 }, 0, 'p2'));
    w.placements.push(createPlacement('s1', { x: 20, y: 5, z: 0 }, 1, 'p3'));
    const names = new Map([['s1', 'Tower'], ['s2', 'Hut']]);
    const file = encodeWorld(w, (id) => names.get(id));
    expect(file.structures).toEqual([
      { id: 's1', name: 'Tower', file: 'structures/s1.structure.json' },
      { id: 's2', name: 'Hut', file: 'structures/s2.structure.json' },
    ]);
    const back = parseWorld(serializeWorld(w, (id) => names.get(id)));
    expect(back.world).toEqual(w);
    expect(back.structureRefs.length).toBe(2);
  });

  it('rejects placements of unlisted structures, bad rotations and duplicate ids', () => {
    const w = createWorld({ name: 'x' });
    w.placements.push(createPlacement('s1', { x: 0, y: 0, z: 0 }, 0, 'p1'));
    const file = encodeWorld(w, () => 'S');
    expect(() => decodeWorld({ ...file, structures: [] })).toThrow(/unlisted structure/);
    expect(() => decodeWorld({ ...file, placements: [{ ...file.placements[0], rotation: 4 }] })).toThrow(/rotation/);
    expect(() => decodeWorld({ ...file, placements: [file.placements[0], file.placements[0]] })).toThrow(/duplicate placement/);
    expect(() => decodeWorld({ ...file, format: 'nope' })).toThrow(/Invalid world file/);
  });
});
