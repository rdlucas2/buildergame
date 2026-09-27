import { describe, expect, it } from 'vitest';
import { decodeWorld, encodeWorld, parseWorld, serializeWorld } from '../../../src/core/format/world-file';
import { createPlacement, createWorld, WILD_SPAWN } from '../../../src/core/world';
import { Ecosystem } from '../../../src/sim/ecosystem';

describe('world file v2 (wild worlds)', () => {
  it('plain worlds still write version 1 with no ecosystem', () => {
    const w = createWorld({ name: 'Plain' });
    const f = encodeWorld(w, () => '');
    expect(f.version).toBe(1);
    expect(f.ecosystem).toBeUndefined();
    expect(parseWorld(serializeWorld(w, () => '')).world.ecosystem).toBeUndefined();
  });

  it('reads existing version 1 files unchanged', () => {
    const w = createWorld({ name: 'Old' });
    w.placements.push(createPlacement('s', { x: 1, y: 0, z: 2 }, 0, 'p'));
    const v1 = { ...encodeWorld(w, () => 'S'), version: 1 };
    expect(decodeWorld(v1).world).toEqual(w);
  });

  it('round-trips seed, time and biomass, quantised to 16 levels', () => {
    const eco = Ecosystem.create(1024, 777);
    eco.advance(30);
    const w = createWorld({ name: 'Wild', ecosystem: eco.snapshot() });
    expect(w.spawn).toEqual(WILD_SPAWN);
    const text = serializeWorld(w, () => '');
    const f = JSON.parse(text);
    expect(f.version).toBe(2);
    expect(f.ecosystem.biomass.levels).toBe(16);
    expect(text.length).toBeLessThan(1_500_000);
    const back = parseWorld(text).world.ecosystem!;
    expect(back.seed).toBe(777);
    expect(back.time).toBeCloseTo(eco.time, 6);
    const b = back.biomass!;
    const orig = w.ecosystem!.biomass!;
    let maxErr = 0;
    for (let i = 0; i < b.length; i++) maxErr = Math.max(maxErr, Math.abs(b[i] - orig[i]));
    expect(maxErr).toBeLessThanOrEqual(9);
  });

  it('rejects corrupt ecosystem data', () => {
    const w = createWorld({ name: 'Wild', ecosystem: { seed: 1, time: 10, biomass: new Uint8Array(1024 * 1024) } });
    const f = encodeWorld(w, () => '');
    expect(() => decodeWorld({ ...f, ecosystem: { ...f.ecosystem!, biomass: { ...f.ecosystem!.biomass!, data: 'AAAA' } } })).toThrow(/biomass is corrupt/);
    expect(() => decodeWorld({ ...f, ecosystem: { ...f.ecosystem!, seed: -1 } })).toThrow(/Invalid world file/);
  });
});
