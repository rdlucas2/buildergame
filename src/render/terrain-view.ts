import {
  CanvasTexture,
  DataTexture,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { hash3 } from '../sim/rng';
import { isShore } from '../sim/terrain';
import type { Ecosystem } from '../sim/ecosystem';

export type Overlay = 'none' | 'food' | 'sky' | 'water';
export const OVERLAYS: readonly Overlay[] = ['none', 'food', 'sky', 'water'];

const DIRT = [124, 98, 64];
const LUSH = [74, 146, 46];
const WATER = [52, 116, 186];

/**
 * The ground of a wild world, drawn from the simulation: one texel per ground cell showing water
 * and grass (bare earth to lush green), or an overlay that explains the rules (where food is,
 * where the sky is blocked, where creatures can drink). A faint grid plane sits on top.
 */
export class TerrainView {
  readonly group = new Group();
  private readonly data: Uint8Array;
  private readonly texture: DataTexture;
  private readonly jitter: Int8Array;
  private readonly shore: Uint8Array;
  private readonly ground: Mesh;
  private readonly grid: Mesh;
  private overlay: Overlay = 'none';
  private row = 0;
  private passQueued = true;

  constructor(private readonly eco: Ecosystem) {
    const size = eco.size;
    this.data = new Uint8Array(size * size * 4);
    this.jitter = new Int8Array(size * size);
    this.shore = new Uint8Array(size * size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const i = x + z * size;
        this.jitter[i] = (hash3(x, z, eco.seed) % 17) - 8;
        this.shore[i] = isShore(eco.terrain, x - eco.terrain.half, z - eco.terrain.half) ? 1 : 0;
      }
    }
    this.texture = new DataTexture(this.data, size, size, RGBAFormat, UnsignedByteType);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = 4;

    const geom = new PlaneGeometry(size, size);
    geom.rotateX(-Math.PI / 2);
    this.ground = new Mesh(geom, new MeshLambertMaterial({ map: this.texture }));
    this.ground.name = 'wild-ground';
    this.group.add(this.ground);

    const gridGeom = new PlaneGeometry(size, size);
    gridGeom.rotateX(-Math.PI / 2);
    const gridTex = createGridLinesTexture();
    gridTex.wrapS = gridTex.wrapT = RepeatWrapping;
    gridTex.repeat.set(size / 16, size / 16);
    this.grid = new Mesh(
      gridGeom,
      new MeshBasicMaterial({ map: gridTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    this.grid.renderOrder = 1;
    this.group.add(this.grid);

    this.refreshAll();
  }

  get currentOverlay(): Overlay {
    return this.overlay;
  }

  setOverlay(o: Overlay): void {
    if (o === this.overlay) return;
    this.overlay = o;
    this.refreshAll();
  }

  /** Recolours every cell right away and uploads the texture. */
  refreshAll(): void {
    this.paintRows(0, this.eco.size);
    this.texture.needsUpdate = true;
    this.row = 0;
    this.passQueued = false;
  }

  /** Asks for a fresh pass; it is painted gradually over the next frames by `update`. */
  requestRefresh(): void {
    this.passQueued = true;
  }

  /** Paints up to `rows` rows of a pending pass, uploading when the pass completes. */
  update(rows = 128): void {
    if (!this.passQueued) return;
    const size = this.eco.size;
    const end = Math.min(size, this.row + rows);
    this.paintRows(this.row, end);
    this.row = end;
    if (this.row >= size) {
      this.texture.needsUpdate = true;
      this.row = 0;
      this.passQueued = false;
    }
  }

  private paintRows(from: number, to: number): void {
    const size = this.eco.size;
    const water = this.eco.terrain.water;
    const biomass = this.eco.vegetation.biomass;
    const cover = this.eco.vegetation.cover;
    const d = this.data;
    const o = this.overlay;
    // Texture row r shows ground row z = size - 1 - r (the plane's v axis runs towards -z).
    for (let r = from; r < to; r++) {
      const z = size - 1 - r;
      for (let x = 0; x < size; x++) {
        const i = x + z * size;
        const p = (x + r * size) * 4;
        let cr: number, cg: number, cb: number;
        const j = this.jitter[i];
        if (water[i]) {
          if (o === 'water') [cr, cg, cb] = [64, 196, 236];
          else if (o === 'food' || o === 'sky') [cr, cg, cb] = [34, 58, 96];
          else [cr, cg, cb] = [WATER[0] + (j >> 1), WATER[1] + (j >> 1), WATER[2] + j];
        } else {
          const t = biomass[i] / 255;
          cr = DIRT[0] + (LUSH[0] - DIRT[0]) * t + j;
          cg = DIRT[1] + (LUSH[1] - DIRT[1]) * t + j;
          cb = DIRT[2] + (LUSH[2] - DIRT[2]) * t + j * 0.5;
          if (o === 'food') {
            // heat map: dark earth → yellow → bright green
            if (t < 0.5) [cr, cg, cb] = [70 + 360 * t, 40 + 320 * t, 30];
            else [cr, cg, cb] = [250 - 380 * (t - 0.5), 200 + 40 * (t - 0.5), 30 + 60 * (t - 0.5)];
          } else if (o === 'sky') {
            if (cover[i] > 0) [cr, cg, cb] = [168, 92, 226];
            else [cr, cg, cb] = [cr * 0.55, cg * 0.55, cb * 0.55];
          } else if (o === 'water') {
            if (this.shore[i]) [cr, cg, cb] = [250, 226, 92];
            else [cr, cg, cb] = [cr * 0.5, cg * 0.5, cb * 0.5];
          }
        }
        d[p] = cr < 0 ? 0 : cr > 255 ? 255 : cr;
        d[p + 1] = cg < 0 ? 0 : cg > 255 ? 255 : cg;
        d[p + 2] = cb < 0 ? 0 : cb > 255 ? 255 : cb;
        d[p + 3] = 255;
      }
    }
  }

  /** Colour of one cell as the view last painted it, for tests. */
  colorAt(x: number, z: number): [number, number, number] {
    const size = this.eco.size;
    const half = size >> 1;
    const r = size - 1 - (z + half);
    const p = (x + half + r * size) * 4;
    return [this.data[p], this.data[p + 1], this.data[p + 2]];
  }

  dispose(): void {
    this.texture.dispose();
    for (const m of [this.ground, this.grid]) {
      m.geometry.dispose();
      const mat = m.material as MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
  }
}

/** Transparent 16×16-cell tile of faint voxel lines, drawn over the terrain colours. */
function createGridLinesTexture(): CanvasTexture {
  const px = 16 * 8;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, px, px);
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 16; i++) {
    const p = i * 8 + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, px);
    ctx.moveTo(0, p);
    ctx.lineTo(px, p);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, px - 2, px - 2);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}
