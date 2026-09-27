import { BufferAttribute, BufferGeometry } from 'three';
import type { MeshData } from './greedy-mesh';

/** Wraps mesher output in a BufferGeometry, or returns null for an empty mesh. */
export function meshDataToGeometry(m: MeshData): BufferGeometry | null {
  if (m.quadCount === 0) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  g.setAttribute('color', new BufferAttribute(m.colors, 3));
  g.setIndex(new BufferAttribute(m.indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
