import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, decodeVoxelData, encodeVoxelData, rleDecodeU16, rleEncodeU16 } from '../../src/core/format/rle';

describe('rle + base64', () => {
  it('round-trips random and structured data', () => {
    const cases = [
      new Uint16Array(0),
      Uint16Array.from([1]),
      Uint16Array.from([0, 0, 0, 1, 1, 2, 0]),
      new Uint16Array(70000).fill(9), // run longer than 65535
      Uint16Array.from({ length: 5000 }, (_, i) => (i * 7919) % 5),
      Uint16Array.from({ length: 300 }, (_, i) => i % 65536),
    ];
    for (const data of cases) {
      const runs = rleEncodeU16(data);
      expect(Array.from(rleDecodeU16(runs, data.length))).toEqual(Array.from(data));
      const encoded = encodeVoxelData(data);
      expect(Array.from(decodeVoxelData(encoded, data.length))).toEqual(Array.from(data));
    }
  });

  it('compresses uniform data well', () => {
    const data = new Uint16Array(64 * 64 * 64).fill(3);
    expect(encodeVoxelData(data).length).toBeLessThan(40);
  });

  it('rejects data of the wrong length', () => {
    const encoded = encodeVoxelData(Uint16Array.from([1, 1, 2]));
    expect(() => decodeVoxelData(encoded, 2)).toThrow(/longer/);
    expect(() => decodeVoxelData(encoded, 4)).toThrow(/shorter/);
    expect(() => decodeVoxelData('!!!!', 1)).toThrow();
  });

  it('base64 matches the platform implementation', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 33, 256]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 31 + 7) % 256);
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bytes));
    }
  });
});
