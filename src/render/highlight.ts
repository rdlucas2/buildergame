import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments } from 'three';

/** Wireframe box that can be moved and resized to outline a voxel, a placement or a build volume. */
export class OutlineBox {
  readonly object: LineSegments;

  constructor(material: LineBasicMaterial, private readonly inflate = 0.01) {
    this.object = new LineSegments(new EdgesGeometry(new BoxGeometry(1, 1, 1)), material);
    this.object.visible = false;
    this.object.renderOrder = 20;
  }

  /** Outline the half-open box [min, min + size). */
  setBox(min: { x: number; y: number; z: number }, size: { x: number; y: number; z: number }): void {
    const i = this.inflate;
    this.object.scale.set(size.x + 2 * i, size.y + 2 * i, size.z + 2 * i);
    this.object.position.set(min.x + size.x / 2, min.y + size.y / 2, min.z + size.z / 2);
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.geometry.dispose();
  }
}
