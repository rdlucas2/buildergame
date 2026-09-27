import { CanvasTexture, Mesh, MeshLambertMaterial, NearestFilter, PlaneGeometry, RepeatWrapping, LinearMipMapLinearFilter } from 'three';
import { getMaterial } from '../core/materials';

/** Flat ground plane with a subtle voxel grid so players can read positions while building. */
export function createGround(size: number, materialId: string, options: { grid?: boolean } = {}): Mesh {
  const base = getMaterial(materialId)?.color ?? '#5da130';
  const texture = createGridTexture(base, options.grid ?? true);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(size / 16, size / 16);
  const geom = new PlaneGeometry(size, size);
  geom.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geom, new MeshLambertMaterial({ map: texture }));
  mesh.name = 'ground';
  mesh.receiveShadow = true;
  return mesh;
}

/** 16×16 voxel tile: base colour, faint lines every voxel, a stronger line on the tile border. */
export function createGridTexture(baseColor: string, grid: boolean): CanvasTexture {
  const px = 16 * 8;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, px, px);
  if (grid) {
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
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
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, px - 2, px - 2);
  }
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = LinearMipMapLinearFilter;
  tex.anisotropy = 4;
  tex.colorSpace = 'srgb';
  return tex;
}
