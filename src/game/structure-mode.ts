import { Group, type Mesh, type PerspectiveCamera, Vector3 } from 'three';
import type { Vec3 } from '../core/math';
import { rayPlaneY, raycastVoxels } from '../core/raycast';
import {
  MAX_STRUCTURE_EDGE,
  createStructure,
  normalizeStructure,
  paletteSlotFor,
  type PaletteEntry,
  type Structure,
} from '../core/structure';
import { UndoStack } from '../core/undo';
import { AIR, VoxelGrid, type Size3 } from '../core/voxel-grid';
import { ChunkedGridMesh } from '../render/chunked-grid-mesh';
import { createGround } from '../render/ground';
import { OutlineBox } from '../render/highlight';
import { meshPaletteFromEntries } from '../render/mesh-palette';
import type { VoxelMaterials } from '../render/voxel-materials';

export const DEFAULT_HOTBAR = ['stone', 'planks', 'brick', 'glass', 'grass', 'log', 'white', 'red', 'lantern'];
export const DEFAULT_VOLUME = 64;
export const REACH = 160;

export interface HoverState {
  /** Solid voxel under the crosshair, if any. */
  voxel: Vec3 | null;
  /** Empty cell where a new block would go (adjacent to the hovered face or on the floor). */
  place: Vec3 | null;
}

/**
 * The build workshop: a bounded voxel volume the player fills block by block. Nothing here touches
 * the world; saving produces a normalized Structure for the library.
 */
export class StructureMode {
  readonly group = new Group();
  readonly volume: Size3;
  readonly grid: VoxelGrid;
  readonly palette: PaletteEntry[];
  readonly hotbar: string[];
  selected = 0;
  readonly undo = new UndoStack(1000);
  readonly editing: Structure | null;
  hover: HoverState = { voxel: null, place: null };

  private readonly mesh: ChunkedGridMesh;
  private readonly floor: Mesh;
  private readonly volumeBox: OutlineBox;
  private readonly hoverBox: OutlineBox;
  private readonly placeBox: OutlineBox;
  private readonly tmpDir = new Vector3();

  constructor(
    private readonly materials: VoxelMaterials,
    opts: { existing?: Structure; hotbar?: string[] } = {},
  ) {
    this.editing = opts.existing ?? null;
    this.hotbar = [...(opts.hotbar ?? DEFAULT_HOTBAR)];
    const existing = opts.existing;
    const need = existing ? existing.voxels.size : { x: 1, y: 1, z: 1 };
    const edge = (n: number) => Math.min(MAX_STRUCTURE_EDGE, Math.max(DEFAULT_VOLUME, n + 8));
    this.volume = { x: edge(need.x), y: edge(need.y), z: edge(need.z) };
    this.palette = existing ? existing.palette.map((p) => ({ ...p })) : [];
    if (existing) {
      const offset = {
        x: Math.floor((this.volume.x - need.x) / 2),
        y: 0,
        z: Math.floor((this.volume.z - need.z) / 2),
      };
      this.grid = existing.voxels.resized(this.volume, offset);
    } else {
      this.grid = new VoxelGrid(this.volume);
    }
    for (const id of this.hotbar) paletteSlotFor(this.palette, id);

    this.mesh = new ChunkedGridMesh(this.grid, meshPaletteFromEntries(this.palette), materials, 16);
    this.group.add(this.mesh.group);

    const floorSize = Math.max(this.volume.x, this.volume.z) + 64;
    this.floor = createGround(floorSize, 'marble');
    this.floor.position.set(this.volume.x / 2, -0.001, this.volume.z / 2);
    this.group.add(this.floor);

    this.volumeBox = new OutlineBox(materials.outlineBounds, 0.02);
    this.volumeBox.setBox({ x: 0, y: 0, z: 0 }, this.volume);
    this.group.add(this.volumeBox.object);
    this.hoverBox = new OutlineBox(materials.outlineHover, 0.012);
    this.group.add(this.hoverBox.object);
    this.placeBox = new OutlineBox(materials.outline, 0.006);
    this.group.add(this.placeBox.object);
  }

  /** Where the camera starts so the volume's floor is in view. */
  startPose(): { position: [number, number, number]; yaw: number; pitch: number } {
    return { position: [this.volume.x / 2, 6, this.volume.z / 2 + 14], yaw: 0, pitch: -0.32 };
  }

  get selectedMaterial(): string {
    return this.hotbar[this.selected];
  }

  selectSlot(i: number): void {
    if (i >= 0 && i < this.hotbar.length) this.selected = i;
  }

  setSlotMaterial(i: number, materialId: string): void {
    if (i < 0 || i >= this.hotbar.length) return;
    this.hotbar[i] = materialId;
    paletteSlotFor(this.palette, materialId);
  }

  inVolume(p: Vec3): boolean {
    return p.x >= 0 && p.y >= 0 && p.z >= 0 && p.x < this.volume.x && p.y < this.volume.y && p.z < this.volume.z;
  }

  /** Recomputes what the crosshair points at. */
  update(camera: PerspectiveCamera): void {
    const dir = camera.getWorldDirection(this.tmpDir);
    const ray = { origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, direction: { x: dir.x, y: dir.y, z: dir.z } };
    const hit = raycastVoxels(ray, REACH, (x, y, z) => this.grid.get(x, y, z) !== AIR);
    const tFloor = rayPlaneY(ray, 0);
    let voxel: Vec3 | null = null;
    let place: Vec3 | null = null;

    if (tFloor !== null && tFloor <= REACH && (!hit || tFloor < hit.distance)) {
      const px = Math.floor(ray.origin.x + dir.x * tFloor);
      const pz = Math.floor(ray.origin.z + dir.z * tFloor);
      const cell = { x: px, y: 0, z: pz };
      if (this.inVolume(cell) && this.grid.get(px, 0, pz) === AIR) place = cell;
    } else if (hit) {
      voxel = hit.voxel;
      if (hit.normal.x !== 0 || hit.normal.y !== 0 || hit.normal.z !== 0) {
        const cell = { x: hit.voxel.x + hit.normal.x, y: hit.voxel.y + hit.normal.y, z: hit.voxel.z + hit.normal.z };
        if (this.inVolume(cell) && this.grid.get(cell.x, cell.y, cell.z) === AIR) place = cell;
      }
    }
    this.hover = { voxel, place };
    if (voxel) this.hoverBox.setBox(voxel, { x: 1, y: 1, z: 1 });
    else this.hoverBox.hide();
    if (place) this.placeBox.setBox(place, { x: 1, y: 1, z: 1 });
    else this.placeBox.hide();
    this.mesh.update();
  }

  /** Places the selected material at the hovered empty cell. */
  place(): boolean {
    const cell = this.hover.place;
    if (!cell) return false;
    return this.setVoxel(cell, this.selectedMaterial);
  }

  /** Removes the hovered block. */
  remove(): boolean {
    const cell = this.hover.voxel;
    if (!cell) return false;
    return this.setVoxel(cell, null);
  }

  /** Copies the hovered block's material into the selected hotbar slot. */
  pick(): string | null {
    const cell = this.hover.voxel;
    if (!cell) return null;
    const v = this.grid.get(cell.x, cell.y, cell.z);
    const entry = this.palette[v - 1];
    if (!entry) return null;
    this.setSlotMaterial(this.selected, entry.material);
    return entry.material;
  }

  /** Sets one voxel (materialId or null for air) as an undoable command. */
  setVoxel(cell: Vec3, materialId: string | null): boolean {
    if (!this.inVolume(cell)) return false;
    const before = this.grid.get(cell.x, cell.y, cell.z);
    const after = materialId === null ? AIR : paletteSlotFor(this.palette, materialId);
    if (before === after) return false;
    const apply = (v: number) => {
      this.grid.set(cell.x, cell.y, cell.z, v);
      this.mesh.markVoxel(cell.x, cell.y, cell.z);
    };
    this.undo.push({ label: materialId === null ? 'remove block' : 'place block', execute: () => apply(after), undo: () => apply(before) });
    return true;
  }

  /** Fills a box with a material (used by tests and future tools). */
  fillBox(min: Vec3, max: Vec3, materialId: string | null): number {
    const cells: Array<{ cell: Vec3; before: number }> = [];
    const after = materialId === null ? AIR : paletteSlotFor(this.palette, materialId);
    for (let y = min.y; y < max.y; y++)
      for (let z = min.z; z < max.z; z++)
        for (let x = min.x; x < max.x; x++) {
          const cell = { x, y, z };
          if (!this.inVolume(cell)) continue;
          const before = this.grid.get(x, y, z);
          if (before !== after) cells.push({ cell, before });
        }
    if (cells.length === 0) return 0;
    const apply = (useAfter: boolean) => {
      for (const c of cells) {
        this.grid.set(c.cell.x, c.cell.y, c.cell.z, useAfter ? after : c.before);
        this.mesh.markVoxel(c.cell.x, c.cell.y, c.cell.z);
      }
    };
    this.undo.push({ label: 'fill', execute: () => apply(true), undo: () => apply(false) });
    return cells.length;
  }

  /** Current length × height × depth of what has been built, and block count. */
  dimensions(): { size: Size3 | null; blocks: number } {
    const b = this.grid.tightBounds();
    return { size: b ? { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z } : null, blocks: this.grid.count() };
  }

  get isEmpty(): boolean {
    return this.grid.isEmpty();
  }

  /** Normalized structure ready for the library. Throws EmptyStructureError when nothing was built. */
  toStructure(name: string, author: string): Structure {
    const base = this.editing;
    const raw = createStructure({
      name,
      author: author || base?.author || '',
      voxels: this.grid,
      palette: this.palette,
      ...(base ? { id: base.id, createdAt: base.createdAt } : {}),
    });
    return normalizeStructure(raw);
  }

  flushMesh(): void {
    this.mesh.update();
  }

  dispose(): void {
    this.mesh.dispose();
    this.floor.geometry.dispose();
    (this.floor.material as { dispose(): void }).dispose();
    this.volumeBox.dispose();
    this.hoverBox.dispose();
    this.placeBox.dispose();
  }

  get materialsRef(): VoxelMaterials {
    return this.materials;
  }
}
