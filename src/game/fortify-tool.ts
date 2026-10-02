import { Group, LineBasicMaterial, Vector3, type PerspectiveCamera } from 'three';
import type { Vec3 } from '../core/math';
import { raycastVoxels } from '../core/raycast';
import { OutlineBox } from '../render/highlight';
import type { ActionResult, Defense } from '../sim/defense/defense';
import { blockCost } from '../sim/defense/materials';

/** How far away the crosshair can build. */
const REACH = 48;

/**
 * Fortify mode: build and break the warren's blocks where the crosshair points, within the
 * buildable area and the block budget. An outline marks the block aimed at, and a second box shows
 * where a new block would go (green when it fits the budget, red when it doesn't).
 */
export class FortifyTool {
  readonly group = new Group();
  active = false;
  voxel: Vec3 | null = null;
  place: Vec3 | null = null;
  private readonly hoverBox = new OutlineBox(new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }), 0.02);
  private readonly okBox = new OutlineBox(new LineBasicMaterial({ color: 0x3ddc84 }), 0.04);
  private readonly badBox = new OutlineBox(new LineBasicMaterial({ color: 0xff4d4d }), 0.04);
  private readonly areaBox = new OutlineBox(new LineBasicMaterial({ color: 0xe8a040, transparent: true, opacity: 0.55 }), 0);
  private readonly tmpDir = new Vector3();

  constructor() {
    this.group.name = 'fortify';
    this.group.add(this.hoverBox.object, this.okBox.object, this.badBox.object, this.areaBox.object);
  }

  setActive(on: boolean, defense: Defense | null): void {
    this.active = on && !!defense;
    if (!this.active) {
      this.voxel = null;
      this.place = null;
      for (const b of [this.hoverBox, this.okBox, this.badBox, this.areaBox]) b.hide();
      return;
    }
    const base = defense!.base;
    this.areaBox.setBox({ x: base.origin.x, y: 0, z: base.origin.z }, base.size);
  }

  /** Finds the block under the crosshair and where a new one would go. */
  update(camera: PerspectiveCamera, defense: Defense | null, material: string): void {
    if (!this.active || !defense) return;
    const base = defense.base;
    const dir = camera.getWorldDirection(this.tmpDir);
    const ray = { origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, direction: { x: dir.x, y: dir.y, z: dir.z } };
    const hit = raycastVoxels(ray, REACH, (x, y, z) => y < 0 || base.solidAt(x, y, z));
    this.voxel = null;
    this.place = null;
    if (hit) {
      if (hit.voxel.y >= 0) this.voxel = { ...hit.voxel };
      const p = { x: hit.voxel.x + hit.normal.x, y: hit.voxel.y + hit.normal.y, z: hit.voxel.z + hit.normal.z };
      if (base.contains(p.x, p.y, p.z) && !base.solidAt(p.x, p.y, p.z)) this.place = p;
    }
    if (this.voxel && base.contains(this.voxel.x, this.voxel.y, this.voxel.z)) this.hoverBox.setBox(this.voxel, { x: 1, y: 1, z: 1 });
    else this.hoverBox.hide();
    const fits = defense.base.cost() + blockCost(material) <= defense.budget;
    if (this.place) {
      (fits ? this.okBox : this.badBox).setBox(this.place, { x: 1, y: 1, z: 1 });
      (fits ? this.badBox : this.okBox).hide();
    } else {
      this.okBox.hide();
      this.badBox.hide();
    }
  }

  build(defense: Defense, material: string): ActionResult {
    if (!this.place) return { ok: false, reason: 'Aim at the ground or a block inside the warren area.' };
    return defense.apply({ type: 'place', ...this.place, material });
  }

  breakBlock(defense: Defense): ActionResult {
    if (!this.voxel) return { ok: false, reason: 'Aim at a warren block.' };
    return defense.apply({ type: 'remove', ...this.voxel });
  }

  /** The material of the block under the crosshair (for picking it), if any. */
  pick(defense: Defense): string | null {
    return this.voxel ? defense.base.materialAt(this.voxel.x, this.voxel.y, this.voxel.z) : null;
  }

  dispose(): void {
    for (const b of [this.hoverBox, this.okBox, this.badBox, this.areaBox]) b.dispose();
  }
}
