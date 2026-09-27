import { Group, type Mesh, type PerspectiveCamera, Vector3 } from 'three';
import { checkPlacement, type PlacementCheck } from '../core/collision';
import { aabbFromPosSize, type AABB, type Vec3 } from '../core/math';
import { rayPlaneY, raycastVoxels } from '../core/raycast';
import { normalizeRotation, rotatedSize, type Rotation } from '../core/rotation';
import type { Structure } from '../core/structure';
import { UndoStack } from '../core/undo';
import { createPlacement, placementVoxelAt, touchWorld, type Placement, type World } from '../core/world';
import { WorldIndex } from '../core/world-index';
import { GhostPreview } from '../render/ghost';
import { createGround } from '../render/ground';
import { OutlineBox } from '../render/highlight';
import { PlacementRenderer } from '../render/placement-renderer';
import type { StructureGeometryCache } from '../render/structure-geometry';
import type { VoxelMaterials } from '../render/voxel-materials';
import type { StructureLibrary } from '../storage/library';
import { REACH } from './structure-mode';

export interface PlacingState {
  structure: Structure;
  rotation: Rotation;
  /** Extra height above the targeted surface. */
  lift: number;
  /** Placement being moved (restored on cancel). */
  moving: Placement | null;
  target: Vec3 | null;
  check: PlacementCheck | null;
}

/**
 * The player's world: ground, every placed structure, and the tools to place, move and remove them.
 * All collision goes through `checkPlacement` so structures can never overlap.
 */
export class WorldMode {
  readonly group = new Group();
  readonly index: WorldIndex;
  readonly undo = new UndoStack(200);
  placing: PlacingState | null = null;
  hoveredId: string | null = null;
  hoverVoxel: Vec3 | null = null;
  onChange?: () => void;
  /** Fine-grained placement events, used by the ecosystem to update sky cover incrementally. */
  /** Distance along the view ray to the first block or the ground (Infinity when neither is in reach). */
  hitDistance = Infinity;
  onPlacementAdded?: (p: Placement) => void;
  onPlacementRemoved?: (id: string) => void;
  onPlacementsReset?: (placements: readonly Placement[]) => void;

  private readonly renderer: PlacementRenderer;
  private ground: Mesh | null = null;
  private readonly ghost: GhostPreview;
  private readonly hoverBox: OutlineBox;
  private readonly tmpDir = new Vector3();
  private _world: World;

  constructor(
    world: World,
    private readonly library: StructureLibrary,
    private readonly cache: StructureGeometryCache,
    materials: VoxelMaterials,
  ) {
    this._world = world;
    this.index = new WorldIndex((id) => this.library.get(id));
    this.renderer = new PlacementRenderer(cache, materials);
    this.group.add(this.renderer.group);
    this.ghost = new GhostPreview(materials);
    this.group.add(this.ghost.group);
    this.hoverBox = new OutlineBox(materials.outlineHover, 0.03);
    this.group.add(this.hoverBox.object);
    this.load(world);
  }

  get world(): World {
    return this._world;
  }

  /** Half-open box every placement must fit inside: the ground square, up to a generous height. */
  get worldBounds(): AABB {
    const half = Math.floor(this._world.ground.size / 2);
    return aabbFromPosSize({ x: -half, y: 0, z: -half }, { x: this._world.ground.size, y: 1024, z: this._world.ground.size });
  }

  /** Replaces the current world. Placements whose structure is missing are dropped and reported. */
  load(world: World): string[] {
    this.cancelPlacing();
    this.clearObjects();
    if (this.ground) {
      this.group.remove(this.ground);
      this.ground.geometry.dispose();
      (this.ground.material as { dispose(): void }).dispose();
    }
    // Wild worlds draw their own ground from the simulation (see TerrainView).
    this.ground = world.ecosystem ? null : createGround(world.ground.size, world.ground.material);
    if (this.ground) this.group.add(this.ground);

    const dropped: string[] = [];
    const kept: Placement[] = [];
    for (const p of world.placements) {
      if (this.library.get(p.structureId)) kept.push(p);
      else dropped.push(p.structureId);
    }
    this._world = { ...world, placements: kept };
    this.index.load(this._world);
    for (const p of kept) this.addObject(p);
    this.onPlacementsReset?.(kept);
    this.undo.clear();
    if (dropped.length) this.onChange?.();
    return dropped;
  }

  /** Rebuilds every placement of a structure (after it was edited). */
  refreshStructure(structureId: string): void {
    this.renderer.invalidateStructure(structureId);
    for (const p of this._world.placements) {
      if (p.structureId !== structureId) continue;
      this.index.remove(p.id);
      this.onPlacementRemoved?.(p.id);
      if (this.library.get(structureId)) {
        this.index.add(p);
        this.addObject(p);
        this.onPlacementAdded?.(p);
      }
    }
  }

  placementsOf(structureId: string): Placement[] {
    return this._world.placements.filter((p) => p.structureId === structureId);
  }

  /** Removes every placement of a structure (when it is deleted from the library). */
  removeAllOf(structureId: string): number {
    const ids = this.placementsOf(structureId).map((p) => p.id);
    for (const id of ids) this.removePlacement(id, false);
    if (ids.length) this.onChange?.();
    return ids.length;
  }

  // ---- placement tools -------------------------------------------------------------------

  startPlacing(structure: Structure, opts: { rotation?: Rotation; moving?: Placement | null } = {}): void {
    this.cancelPlacing();
    this.placing = { structure, rotation: opts.rotation ?? 0, lift: 0, moving: opts.moving ?? null, target: null, check: null };
    this.ghost.setGeometry(this.cache.get(structure));
    this.ghost.hide();
  }

  rotatePlacing(delta = 1): void {
    if (!this.placing) return;
    this.placing.rotation = normalizeRotation(this.placing.rotation + delta);
  }

  liftPlacing(delta: number): void {
    if (!this.placing) return;
    this.placing.lift = Math.max(0, this.placing.lift + delta);
  }

  /** Stops placing. A structure that was being moved goes back where it was. */
  cancelPlacing(): void {
    const p = this.placing;
    if (!p) return;
    this.placing = null;
    this.ghost.hide();
    if (p.moving) {
      this.addPlacement(p.moving, false);
      this.onChange?.();
    }
  }

  /** Places the previewed structure if the spot is free. Returns the new placement or null. */
  confirmPlacement(): Placement | null {
    const p = this.placing;
    if (!p || !p.target || !p.check?.ok) return null;
    const placement = createPlacement(p.structure.id, p.target, p.rotation);
    const moving = p.moving;
    this.undo.push({
      label: 'place structure',
      execute: () => this.addPlacement(placement, false),
      undo: () => this.removePlacement(placement.id, false),
    });
    if (moving) {
      // Moving is finished: drop the ghost so the moved structure is not duplicated.
      this.placing = null;
      this.ghost.hide();
    }
    this.onChange?.();
    return placement;
  }

  /** Directly evaluates a candidate position (also used by tests and by the update loop). */
  evaluate(structure: Structure, position: Vec3, rotation: Rotation): PlacementCheck {
    return checkPlacement(this.index, structure, position, rotation, { mode: 'voxel', worldBounds: this.worldBounds });
  }

  /** Removes the structure under the crosshair. */
  removeHovered(): Placement | null {
    if (!this.hoveredId) return null;
    const p = this.index.get(this.hoveredId);
    if (!p) return null;
    this.undo.push({
      label: 'remove structure',
      execute: () => this.removePlacement(p.id, false),
      undo: () => this.addPlacement(p, false),
    });
    this.onChange?.();
    return p;
  }

  /** Lifts the structure under the crosshair into placing mode so it can be moved. */
  pickUpHovered(): Placement | null {
    if (!this.hoveredId) return null;
    const p = this.index.get(this.hoveredId);
    const s = p && this.library.get(p.structureId);
    if (!p || !s) return null;
    this.removePlacement(p.id, false);
    this.startPlacing(s, { rotation: p.rotation, moving: p });
    this.onChange?.();
    return p;
  }

  addPlacement(p: Placement, notify = true): void {
    if (this.index.get(p.id)) return;
    this._world = touchWorld({ ...this._world, placements: [...this._world.placements, p] });
    this.index.add(p);
    this.addObject(p);
    this.onPlacementAdded?.(p);
    if (notify) this.onChange?.();
  }

  removePlacement(id: string, notify = true): Placement | undefined {
    const p = this.index.remove(id);
    if (!p) return undefined;
    this._world = touchWorld({ ...this._world, placements: this._world.placements.filter((x) => x.id !== id) });
    this.removeObject(id);
    this.onPlacementRemoved?.(id);
    if (notify) this.onChange?.();
    return p;
  }

  // ---- per-frame -------------------------------------------------------------------------

  update(camera: PerspectiveCamera): void {
    const dir = camera.getWorldDirection(this.tmpDir);
    const ray = { origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, direction: { x: dir.x, y: dir.y, z: dir.z } };
    const hit = raycastVoxels(ray, REACH, (x, y, z) => this.placementAt(x, y, z) !== null);
    const tGround = rayPlaneY(ray, 0);
    const groundFirst = tGround !== null && tGround <= REACH && (!hit || tGround < hit.distance);
    this.hitDistance = Math.min(hit ? hit.distance : Infinity, tGround !== null && tGround <= REACH ? tGround : Infinity);

    this.hoveredId = null;
    this.hoverVoxel = null;
    if (!groundFirst && hit) {
      this.hoverVoxel = hit.voxel;
      this.hoveredId = this.placementAt(hit.voxel.x, hit.voxel.y, hit.voxel.z)?.id ?? null;
    }

    const p = this.placing;
    if (p) {
      const rs = rotatedSize(p.structure.voxels.size, p.rotation);
      let target: Vec3 | null = null;
      if (groundFirst && tGround !== null) {
        const cx = Math.floor(ray.origin.x + dir.x * tGround);
        const cz = Math.floor(ray.origin.z + dir.z * tGround);
        target = { x: cx - Math.floor(rs.x / 2), y: 0, z: cz - Math.floor(rs.z / 2) };
      } else if (hit && (hit.normal.x !== 0 || hit.normal.y !== 0 || hit.normal.z !== 0)) {
        const v = hit.voxel;
        const n = hit.normal;
        target = { x: v.x - Math.floor(rs.x / 2), y: v.y, z: v.z - Math.floor(rs.z / 2) };
        if (n.y > 0) target.y = v.y + 1;
        else if (n.y < 0) target.y = Math.max(0, v.y - rs.y);
        else if (n.x > 0) target.x = v.x + 1;
        else if (n.x < 0) target.x = v.x - rs.x;
        else if (n.z > 0) target.z = v.z + 1;
        else if (n.z < 0) target.z = v.z - rs.z;
      }
      if (target) target.y += p.lift;
      p.target = target;
      p.check = target ? this.evaluate(p.structure, target, p.rotation) : null;
      if (target) {
        this.ghost.setValid(!!p.check?.ok);
        this.ghost.setTransform(target, p.rotation);
      } else {
        this.ghost.hide();
      }
      this.hoverBox.hide();
    } else if (this.hoveredId) {
      const b = this.index.boundsOf(this.hoveredId);
      if (b) this.hoverBox.setBox(b.min, { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z });
    } else {
      this.hoverBox.hide();
    }
  }

  /** Placement owning a solid voxel at a world position, if any. */
  placementAt(x: number, y: number, z: number): Placement | null {
    if (y < 0) return null;
    for (const p of this.index.query({ min: { x, y, z }, max: { x: x + 1, y: y + 1, z: z + 1 } })) {
      const s = this.library.get(p.structureId);
      if (s && placementVoxelAt(s, p, x, y, z) !== 0) return p;
    }
    return null;
  }

  hoveredPlacement(): { placement: Placement; structure: Structure } | null {
    const p = this.hoveredId ? this.index.get(this.hoveredId) : undefined;
    const s = p && this.library.get(p.structureId);
    return p && s ? { placement: p, structure: s } : null;
  }

  // ---- scene sync ------------------------------------------------------------------------

  private addObject(p: Placement): void {
    const s = this.library.get(p.structureId);
    if (s) this.renderer.add(p, s);
  }

  private removeObject(id: string): void {
    this.renderer.remove(id);
  }

  private clearObjects(): void {
    this.renderer.clear();
    this.index.clear();
  }

  boundsOf(id: string): AABB | undefined {
    return this.index.boundsOf(id);
  }

  /** Number of rendered placement instances (for diagnostics). */
  get renderedCount(): number {
    return this.renderer.count;
  }

  dispose(): void {
    this.cancelPlacing();
    this.clearObjects();
    this.renderer.dispose();
    this.ghost.dispose();
    this.hoverBox.dispose();
    if (this.ground) {
      this.ground.geometry.dispose();
      (this.ground.material as { dispose(): void }).dispose();
    }
  }
}
