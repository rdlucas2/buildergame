/**
 * Run-length encoding of 16-bit voxel data plus base64 transport.
 * Runs are stored as little-endian u16 pairs [value, length], length 1..65535.
 */

export function rleEncodeU16(data: Uint16Array): Uint16Array {
  const runs: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let n = 1;
    while (i + n < data.length && data[i + n] === v && n < 0xffff) n++;
    runs.push(v, n);
    i += n;
  }
  return Uint16Array.from(runs);
}

export function rleDecodeU16(runs: Uint16Array, expectedLength: number): Uint16Array {
  if (runs.length % 2 !== 0) throw new Error('RLE data has an odd number of values');
  const out = new Uint16Array(expectedLength);
  let pos = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const v = runs[i];
    const n = runs[i + 1];
    if (n === 0) throw new Error('RLE run length of zero');
    if (pos + n > expectedLength) throw new Error('RLE data longer than expected');
    out.fill(v, pos, pos + n);
    pos += n;
  }
  if (pos !== expectedLength) throw new Error(`RLE data shorter than expected (${pos} of ${expectedLength})`);
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['='.charCodeAt(0)] = 0;
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const rem = bytes.length - i;
    const n = (bytes[i] << 16) | ((rem > 1 ? bytes[i + 1] : 0) << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (rem > 1 ? B64[(n >> 6) & 63] : '=') + '=';
  }
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) throw new Error('base64 length must be a multiple of 4');
  let pad = 0;
  if (clean.endsWith('==')) pad = 2;
  else if (clean.endsWith('=')) pad = 1;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)], b = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = B64_LOOKUP[clean.charCodeAt(i + 2)], d = B64_LOOKUP[clean.charCodeAt(i + 3)];
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('invalid base64 character');
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

export function u16ToBytesLE(arr: Uint16Array): Uint8Array {
  const out = new Uint8Array(arr.length * 2);
  for (let i = 0; i < arr.length; i++) {
    out[2 * i] = arr[i] & 0xff;
    out[2 * i + 1] = (arr[i] >> 8) & 0xff;
  }
  return out;
}

export function bytesLEToU16(bytes: Uint8Array): Uint16Array {
  if (bytes.length % 2 !== 0) throw new Error('byte length must be even for u16 data');
  const out = new Uint16Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
  return out;
}

/** Voxel data → "rle-u16-base64" string. */
export function encodeVoxelData(data: Uint16Array): string {
  return bytesToBase64(u16ToBytesLE(rleEncodeU16(data)));
}

/** "rle-u16-base64" string → voxel data of exactly `expectedLength` values. */
export function decodeVoxelData(encoded: string, expectedLength: number): Uint16Array {
  return rleDecodeU16(bytesLEToU16(base64ToBytes(encoded)), expectedLength);
}
