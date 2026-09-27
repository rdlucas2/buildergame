import { Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { createStructureObject, type StructureGeometry } from './structure-geometry';
import type { VoxelMaterials } from './voxel-materials';

/** Renders a structure from a three-quarter view into a small JPEG data URL for the library. */
export function renderThumbnail(renderer: WebGLRenderer, geometry: StructureGeometry, materials: VoxelMaterials, width = 320, height = 240): string {
  const scene = new Scene();
  scene.background = new Color(0x87b7e6);
  scene.add(new HemisphereLight(0xcfe8ff, 0x6b7a4c, 0.9));
  const sun = new DirectionalLight(0xfff2d6, 1.6);
  sun.position.set(3, 6, 4);
  scene.add(sun);

  const obj = createStructureObject(geometry, materials);
  const s = geometry.size;
  obj.position.set(-s.x / 2, -s.y / 2, -s.z / 2);
  scene.add(obj);

  const radius = Math.max(0.5, 0.5 * Math.hypot(s.x, s.y, s.z));
  const fov = 40;
  const camera = new PerspectiveCamera(fov, width / height, 0.1, radius * 20);
  const dist = (radius / Math.sin((fov * Math.PI) / 360)) * 1.05;
  camera.position.set(1, 0.75, 1.25).normalize().multiplyScalar(dist);
  camera.lookAt(0, 0, 0);

  const target = new WebGLRenderTarget(width, height, { colorSpace: SRGBColorSpace });
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  renderer.setRenderTarget(prevTarget);
  target.dispose();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  const row = width * 4;
  for (let y = 0; y < height; y++) img.data.set(pixels.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.82);
}
