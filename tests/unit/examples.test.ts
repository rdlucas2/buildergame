import { describe, expect, it } from 'vitest';
import { parseStructure, serializeStructure } from '../../src/core/format/structure-file';
import { hasMaterial } from '../../src/core/materials';
import { MAX_STRUCTURE_EDGE, structureContentEquals, type Structure } from '../../src/core/structure';
import { EXAMPLES, buildExampleStructures, isExampleId } from '../../src/examples';

const all = buildExampleStructures();
const byId = new Map(all.map((s) => [s.id, s]));
const get = (id: string): Structure => byId.get(id)!;

describe('built-in examples', () => {
  it('has the requested set with unique, stable example ids', () => {
    expect(all.map((s) => s.name)).toEqual(['Cottage', 'Farmhouse', 'Modern House', 'Eiffel Tower', 'Arc de Triomphe', 'Rabbit Warren']);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) expect(isExampleId(s.id)).toBe(true);
    expect(isExampleId('4b9d0c62-3b6e-4d2e-9a1a-7f6bd0f4c1a1')).toBe(false);
  });

  it('builds deterministically, fits the editor, and uses only known materials', () => {
    const again = buildExampleStructures();
    for (const s of all) {
      const size = s.voxels.size;
      console.log(`${s.id.padEnd(26)} ${size.x}x${size.y}x${size.z}  ${s.voxels.count()} blocks  [${s.palette.map((p) => p.material).join(', ')}]`);
      expect(structureContentEquals(s, again.find((a) => a.id === s.id)!)).toBe(true);
      expect(Math.max(size.x, size.y, size.z)).toBeLessThanOrEqual(MAX_STRUCTURE_EDGE);
      for (const p of s.palette) expect(hasMaterial(p.material)).toBe(true);
    }
  });

  it('round-trips through the structure file format', () => {
    for (const s of all) expect(structureContentEquals(parseStructure(serializeStructure(s)), s)).toBe(true);
  });

  it('houses have a door opening at ground level on their +z front', () => {
    for (const id of ['example-cottage', 'example-farmhouse']) {
      const s = get(id);
      const g = s.voxels;
      // Find a front-wall column with air at y 1..2 flanked by wall blocks.
      let found = false;
      for (let z = 0; z < g.size.z && !found; z++)
        for (let x = 1; x < g.size.x - 1 && !found; x++)
          found = g.get(x, 1, z) === 0 && g.get(x, 2, z) === 0 && g.get(x - 1, 1, z) !== 0 && g.get(x + 1, 1, z) !== 0 && g.get(x, 1, z - 1) === 0;
      expect(found, id).toBe(true);
    }
  });

  it('the Eiffel Tower is tall, tapered and open between its legs', () => {
    const g = get('example-eiffel-tower').voxels;
    expect(g.size.y).toBeGreaterThan(2.5 * g.size.x);
    const c = Math.floor(g.size.x / 2);
    for (let y = 1; y < 5; y++) expect(g.get(c, y, c), `centre at y=${y}`).toBe(0); // open between legs
    expect(g.get(0, 0, 0)).not.toBe(0); // leg footing at a corner
    expect(g.get(c, g.size.y - 1, c)).not.toBe(0); // spire tip
  });

  it('the Arc de Triomphe has a through-passage under the main and side arches', () => {
    const g = get('example-arc-de-triomphe').voxels;
    const cx = Math.floor(g.size.x / 2);
    const cz = Math.floor(g.size.z / 2);
    for (let z = 0; z < g.size.z; z++) expect(g.get(cx, 10, z)).toBe(0); // main arch, front to back
    for (let x = 0; x < g.size.x; x++) expect(g.get(x, 10, cz)).toBe(0); // side arch, end to end
    expect(g.get(cx, 30, cz)).not.toBe(0); // solid above the arch
  });

  it('every example definition has a description', () => {
    for (const e of EXAMPLES) expect(e.description.length).toBeGreaterThan(10);
  });
});
