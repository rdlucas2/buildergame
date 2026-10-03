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
/** The warren designer's blocks: the four walls, the lookout post and the core. */
export const WARREN_HOTBAR = ['planks', 'cobblestone', 'stone_bricks', 'iron', 'lookout', 'core'];
/** The core, which the warren designer places (and removes) as one 2×2 block, 2 high. */
const CORE = 'core';
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
  /** When true, saving creates a new structure instead of updating `editing` (used for examples). */
  readonly asCopy: boolean;
  hover: HoverState = { voxel: null, place: null };
  /** Designing a warren: the warren's blocks only, a fixed building area, and exactly one core. */
  readonly warren: boolean;
  /** Bumped whenever a block changes (so costly summaries are only worked out again when needed). */
  revision = 0;

  private readonly mesh: ChunkedGridMesh;
  private readonly floor: Mesh;
  private readonly volumeBox: OutlineBox;
  private readonly hoverBox: OutlineBox;
  private readonly placeBox: OutlineBox;
  private readonly tmpDir = new Vector3();

  constructor(
    private readonly materials: VoxelMaterials,
    opts: { existing?: Structure; hotbar?: string[]; asCopy?: boolean; warren?: { area: Size3 } } = {},
  ) {
    this.editing = opts.existing ?? null;
    this.asCopy = !!opts.asCopy && !!opts.existing;
    this.warren = !!opts.warren;
    this.hotbar = [...(opts.warren ? WARREN_HOTBAR : (opts.hotbar ?? DEFAULT_HOTBAR))];
    const existing = opts.existing;
    const need = existing ? existing.voxels.size : { x: 1, y: 1, z: 1 };
    const edge = (n: number) => Math.min(MAX_STRUCTURE_EDGE, Math.max(DEFAULT_VOLUME, n + 8));
    // A warren is built in the same area a round gives it.
    this.volume = opts.warren ? { x: Math.max(opts.warren.area.x, need.x), y: Math.max(opts.warren.area.y, need.y), z: Math.max(opts.warren.area.z, need.z) } : { x: edge(need.x), y: edge(need.y), z: edge(need.z) };
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
    if (i < 0 || i >= this.hotbar.length || this.warren) return;
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

  /** Places the selected material at the hovered empty cell (the whole core, when that is selected). */
  place(): boolean {
    const cell = this.hover.place;
    if (!cell) return false;
    if (this.selectedMaterial === CORE) return this.placeCore(cell);
    return this.setVoxel(cell, this.selectedMaterial);
  }

  /** Removes the hovered block (the whole core, if it is part of the core). */
  remove(): boolean {
    const cell = this.hover.voxel;
    if (!cell) return false;
    if (this.materialAt(cell) === CORE) return this.replaceCore(null);
    return this.setVoxel(cell, null);
  }

  private materialAt(c: Vec3): string | null {
    const v = this.grid.get(c.x, c.y, c.z);
    return v === AIR ? null : (this.palette[v - 1]?.material ?? null);
  }

  /** The core's blocks now in the volume. */
  coreCells(): Vec3[] {
    const slot = this.palette.findIndex((p) => p.material === CORE) + 1;
    const out: Vec3[] = [];
    if (slot === 0) return out;
    const { x: sx, y: sy, z: sz } = this.volume;
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (this.grid.get(x, y, z) === slot) out.push({ x, y, z });
    return out;
  }

  /**
   * Puts the core (2×2, 2 high) with its corner at `cell`, moving it if there is one already: a
   * warren has exactly one. Refused where it doesn't fit or would overlap other blocks.
   */
  placeCore(cell: Vec3): boolean {
    const cells: Vec3[] = [];
    for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) for (let x = 0; x < 2; x++) cells.push({ x: cell.x + x, y: cell.y + y, z: cell.z + z });
    if (!cells.every((c) => this.inVolume(c) && (this.grid.get(c.x, c.y, c.z) === AIR || this.materialAt(c) === CORE))) return false;
    return this.replaceCore(cells);
  }

  /** Swaps the core's blocks for `cells` (or removes it, with null) as one undoable step. */
  private replaceCore(cells: Vec3[] | null): boolean {
    const old = this.coreCells();
    const slot = paletteSlotFor(this.palette, CORE);
    const changes = new Map<string, { cell: Vec3; before: number; after: number }>();
    for (const c of old) changes.set(`${c.x},${c.y},${c.z}`, { cell: c, before: slot, after: AIR });
    for (const c of cells ?? []) {
      const k = `${c.x},${c.y},${c.z}`;
      changes.set(k, { cell: c, before: changes.get(k)?.before ?? this.grid.get(c.x, c.y, c.z), after: slot });
    }
    const list = [...changes.values()].filter((c) => c.before !== c.after);
    if (list.length === 0) return false;
    const apply = (useAfter: boolean) => {
      for (const c of list) {
        this.grid.set(c.cell.x, c.cell.y, c.cell.z, useAfter ? c.after : c.before);
        this.revision++;
        this.mesh.markVoxel(c.cell.x, c.cell.y, c.cell.z);
      }
    };
    this.undo.push({ label: cells ? 'place the core' : 'remove the core', execute: () => apply(true), undo: () => apply(false) });
    return true;
  }

  /** The blocks as a warren design, relative to their own corner. */
  toPlan(name: string): { name: string; blocks: Array<{ x: number; y: number; z: number; material: string }> } {
    const blocks: Array<{ x: number; y: number; z: number; material: string }> = [];
    const b = this.grid.tightBounds();
    if (!b) return { name, blocks };
    for (let y = b.min.y; y < b.max.y; y++)
      for (let z = b.min.z; z < b.max.z; z++)
        for (let x = b.min.x; x < b.max.x; x++) {
          const m = this.materialAt({ x, y, z });
          if (m) blocks.push({ x: x - b.min.x, y, z: z - b.min.z, material: m });
        }
    return { name, blocks };
  }

  /** Starts a new design from `blocks` (relative to their corner), centred in the volume. */
  loadBlocks(blocks: ReadonlyArray<{ x: number; y: number; z: number; material: string }>): void {
    const sx = Math.max(0, ...blocks.map((b) => b.x + 1));
    const sz = Math.max(0, ...blocks.map((b) => b.z + 1));
    const ox = Math.floor((this.volume.x - sx) / 2);
    const oz = Math.floor((this.volume.z - sz) / 2);
    for (const b of blocks) {
      this.grid.set(b.x + ox, b.y, b.z + oz, paletteSlotFor(this.palette, b.material));
      this.revision++;
        this.mesh.markVoxel(b.x + ox, b.y, b.z + oz);
    }
  }

  /** Copies the hovered block's material into the selected hotbar slot (selects its slot, in a warren). */
  pick(): string | null {
    const cell = this.hover.voxel;
    if (!cell) return null;
    const v = this.grid.get(cell.x, cell.y, cell.z);
    const entry = this.palette[v - 1];
    if (!entry) return null;
    if (this.warren) {
      const i = this.hotbar.indexOf(entry.material);
      if (i < 0) return null;
      this.selected = i;
      return entry.material;
    }
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
      this.revision++;
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
        this.revision++;
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
      author: author || (this.asCopy ? '' : base?.author) || '',
      voxels: this.grid,
      palette: this.palette,
      ...(base && !this.asCopy ? { id: base.id, createdAt: base.createdAt } : {}),
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
