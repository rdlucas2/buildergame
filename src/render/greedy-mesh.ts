/**
 * Greedy voxel mesher with baked ambient occlusion. Pure TypeScript: it only needs a sampler and a
 * palette, and returns flat typed arrays ready for a BufferGeometry.
 *
 * Faces of adjacent voxels with the same material and the same AO corner values are merged into
 * one quad per run, which keeps vertex counts low even for huge flat surfaces.
 */
import type { Vec3 } from '../core/math';

export interface VoxelSampler {
  /** Voxel value at any coordinate; must return 0 outside the data. */
  get(x: number, y: number, z: number): number;
}

export interface MeshPalette {
  /** Linear RGB in 0..1 for a non-zero voxel value. */
  colorOf(value: number): [number, number, number];
  isTransparent(value: number): boolean;
  isEmissive(value: number): boolean;
}

export interface MeshRegion {
  min: Vec3;
  /** Exclusive. */
  max: Vec3;
}

export type MeshPass = 'opaque' | 'transparent';

export interface GreedyMeshOptions {
  pass?: MeshPass;
  /** Bake ambient occlusion into vertex colours (default true). */
  ao?: boolean;
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  quadCount: number;
}

/** Brightness multiplier per AO level (0 = fully occluded corner, 3 = open). */
export const AO_LEVELS: readonly [number, number, number, number] = [0.5, 0.68, 0.84, 1];

const EMPTY: MeshData = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  colors: new Float32Array(0),
  indices: new Uint32Array(0),
  vertexCount: 0,
  quadCount: 0,
};

export function greedyMesh(sampler: VoxelSampler, region: MeshRegion, palette: MeshPalette, opts: GreedyMeshOptions = {}): MeshData {
  const pass = opts.pass ?? 'opaque';
  const useAo = opts.ao ?? true;
  const min = [region.min.x, region.min.y, region.min.z];
  const max = [region.max.x, region.max.y, region.max.z];
  const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (dims[0] <= 0 || dims[1] <= 0 || dims[2] <= 0) return EMPTY;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let quadCount = 0;

  const get = (x: number, y: number, z: number): number => sampler.get(x, y, z);
  const isT = (v: number): boolean => v !== 0 && palette.isTransparent(v);
  const inPass = (v: number): boolean => v !== 0 && (pass === 'transparent' ? isT(v) : !isT(v));
  // Face of block `a` towards neighbour `b` is drawn when b is air, or a is opaque and b is see-through.
  const faceVisible = (a: number, b: number): boolean => b === 0 || (!isT(a) && isT(b));
  const solid = (x: number, y: number, z: number): number => (get(x, y, z) !== 0 ? 1 : 0);

  const colorCache = new Map<number, [number, number, number]>();
  const colorOf = (v: number): [number, number, number] => {
    let c = colorCache.get(v);
    if (!c) {
      c = palette.colorOf(v);
      colorCache.set(v, c);
    }
    return c;
  };

  const x = [0, 0, 0];
  const q = [0, 0, 0];
  const p = [0, 0, 0]; // block owning the face
  const o = [0, 0, 0]; // the air-side cell in front of the face
  const su = [0, 0, 0];
  const sv = [0, 0, 0];

  /** AO of the 4 corners of the face of block `p` facing direction `dir` along axis d, packed 2 bits each. */
  const aoBits = (d: number, u: number, v: number, dir: number): number => {
    if (!useAo) return 0xff;
    o[0] = p[0]; o[1] = p[1]; o[2] = p[2];
    o[d] += dir;
    let bits = 0;
    // corner order matches quad vertex order: (cu,cv) = (0,0), (1,0), (1,1), (0,1)
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let c = 0; c < 4; c++) {
      const cu = corners[c][0] ? 1 : -1;
      const cv = corners[c][1] ? 1 : -1;
      su[0] = o[0]; su[1] = o[1]; su[2] = o[2]; su[u] += cu;
      sv[0] = o[0]; sv[1] = o[1]; sv[2] = o[2]; sv[v] += cv;
      const s1 = solid(su[0], su[1], su[2]);
      const s2 = solid(sv[0], sv[1], sv[2]);
      su[v] += cv;
      const cr = solid(su[0], su[1], su[2]);
      const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
      bits |= ao << (c * 2);
    }
    return bits;
  };

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    q[0] = 0; q[1] = 0; q[2] = 0; q[d] = 1;
    const mask = new Int32Array(dims[u] * dims[v]);

    for (x[d] = min[d] - 1; x[d] < max[d]; x[d]++) {
      // Build the mask for the slice between x[d] and x[d] + 1.
      let n = 0;
      for (x[v] = min[v]; x[v] < max[v]; x[v]++) {
        for (x[u] = min[u]; x[u] < max[u]; x[u]++, n++) {
          const a = get(x[0], x[1], x[2]);
          const b = get(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
          let entry = 0;
          if (x[d] >= min[d] && inPass(a) && faceVisible(a, b)) {
            p[0] = x[0]; p[1] = x[1]; p[2] = x[2];
            entry = a | (aoBits(d, u, v, +1) << 16);
          } else if (x[d] + 1 < max[d] && inPass(b) && faceVisible(b, a)) {
            p[0] = x[0] + q[0]; p[1] = x[1] + q[1]; p[2] = x[2] + q[2];
            entry = b | (aoBits(d, u, v, -1) << 16) | (1 << 24);
          }
          mask[n] = entry;
        }
      }

      // Greedy merge runs of identical mask entries into quads.
      n = 0;
      for (let j = 0; j < dims[v]; j++) {
        for (let i = 0; i < dims[u]; ) {
          const c = mask[n];
          if (c === 0) {
            i++;
            n++;
            continue;
          }
          let w = 1;
          while (i + w < dims[u] && mask[n + w] === c) w++;
          let h = 1;
          outer: for (; j + h < dims[v]; h++) {
            for (let k = 0; k < w; k++) if (mask[n + k + h * dims[u]] !== c) break outer;
          }

          const value = c & 0xffff;
          const ao = (c >> 16) & 0xff;
          const back = (c >> 24) & 1;
          const plane = x[d] + 1;

          const base = [0, 0, 0];
          base[d] = plane;
          base[u] = i + min[u];
          base[v] = j + min[v];
          const du = [0, 0, 0];
          du[u] = w;
          const dv = [0, 0, 0];
          dv[v] = h;

          const nrm = [0, 0, 0];
          nrm[d] = back ? -1 : 1;
          const rgb = colorOf(value);
          const emissive = palette.isEmissive(value);
          const vi = positions.length / 3;

          const corners = [
            [base[0], base[1], base[2]],
            [base[0] + du[0], base[1] + du[1], base[2] + du[2]],
            [base[0] + du[0] + dv[0], base[1] + du[1] + dv[1], base[2] + du[2] + dv[2]],
            [base[0] + dv[0], base[1] + dv[1], base[2] + dv[2]],
          ];
          const aoCorner = [ao & 3, (ao >> 2) & 3, (ao >> 4) & 3, (ao >> 6) & 3];
          for (let k = 0; k < 4; k++) {
            positions.push(corners[k][0], corners[k][1], corners[k][2]);
            normals.push(nrm[0], nrm[1], nrm[2]);
            const f = emissive ? 1 : AO_LEVELS[aoCorner[k]];
            colors.push(rgb[0] * f, rgb[1] * f, rgb[2] * f);
          }
          // Choose the diagonal that runs between the brighter pair to avoid AO banding.
          const flip = aoCorner[0] + aoCorner[2] < aoCorner[1] + aoCorner[3];
          const tri = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
          if (back) {
            indices.push(vi + tri[0], vi + tri[2], vi + tri[1], vi + tri[3], vi + tri[5], vi + tri[4]);
          } else {
            indices.push(vi + tri[0], vi + tri[1], vi + tri[2], vi + tri[3], vi + tri[4], vi + tri[5]);
          }
          quadCount++;

          for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * dims[u]] = 0;
          i += w;
          n += w;
        }
      }
    }
  }

  if (quadCount === 0) return EMPTY;
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    colors: Float32Array.from(colors),
    indices: Uint32Array.from(indices),
    vertexCount: positions.length / 3,
    quadCount,
  };
}
