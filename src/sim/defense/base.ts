import type { BaseState } from '../../core/defense-state';
import { AIR, VoxelGrid, type Size3 } from '../../core/voxel-grid';
import { blockCost, blockHp } from './materials';

/** Size of the area a warren can be built in, centred on the base site. */
export const BASE_SIZE: Size3 = { x: 48, y: 16, z: 48 };

/** Material that marks a defender's post: defenders stand on top of it. */
export const LOOKOUT = 'lookout';


/** What happened to a block that took damage. */
export type DamageResult = 'none' | 'damaged' | 'broken';

/**
 * The warren: an editable grid of blocks anchored in the world, where every block has hit points
 * and can be broken. Blocks cost budget by material; broken blocks free their budget again.
 * Coordinates in the public methods are world cells.
 */
export class DefenseBase {
  readonly origin: { x: number; z: number };
  readonly grid: VoxelGrid;
  readonly palette: string[];
  /** Damage per voxel, in tenths of a hit point (so slow chewing still adds up). */
  readonly damageMap: Uint16Array;
  /** Strength levels bought per material tier, and an overall hit-point multiplier. */
  strength: number[] = [];
  hpMultiplier = 1;
  /** Bumped on every change (damage included), so views and caches know when to refresh. */
  version = 0;
  /** Bumped only when a block appears or disappears. */
  shape = 0;
  /** Called with the world cell of every block that appears, changes or disappears. */
  onChange?: (x: number, y: number, z: number) => void;
  /** The same, for a view that draws the base (kept separate from the simulation's listener). */
  onViewChange?: (x: number, y: number, z: number) => void;
  private costCache = -1;
  private postsCache: { version: number; posts: Array<{ x: number; y: number; z: number }> } | null = null;
  private footprintCache: { version: number; area: { x0: number; z0: number; x1: number; z1: number } | null } | null = null;

  constructor(state: Pick<BaseState, 'origin'> & Partial<BaseState>) {
    const size = state.size ?? BASE_SIZE;
    this.origin = { x: state.origin.x, z: state.origin.z };
    this.grid = new VoxelGrid(size, state.voxels ? new Uint16Array(state.voxels) : undefined);
    this.palette = [...(state.palette ?? [])];
    this.damageMap = state.damage && state.damage.length === this.grid.length ? new Uint16Array(state.damage) : new Uint16Array(this.grid.length);
  }

  get size(): Size3 {
    return this.grid.size;
  }

  /** The grid's centre in world cells. */
  get center(): { x: number; z: number } {
    return { x: this.origin.x + Math.floor(this.grid.size.x / 2), z: this.origin.z + Math.floor(this.grid.size.z / 2) };
  }

  /** True when the world cell lies inside the buildable area. */
  contains(x: number, y: number, z: number): boolean {
    return this.grid.inBounds(x - this.origin.x, y, z - this.origin.z);
  }

  /** True when the world cell column lies inside the buildable area. */
  containsColumn(x: number, z: number): boolean {
    const lx = x - this.origin.x;
    const lz = z - this.origin.z;
    return lx >= 0 && lz >= 0 && lx < this.grid.size.x && lz < this.grid.size.z;
  }

  solidAt(x: number, y: number, z: number): boolean {
    return this.grid.get(x - this.origin.x, y, z - this.origin.z) !== AIR;
  }

  materialAt(x: number, y: number, z: number): string | null {
    const v = this.grid.get(x - this.origin.x, y, z - this.origin.z);
    return v === AIR ? null : (this.palette[v - 1] ?? null);
  }

  maxHpAt(x: number, y: number, z: number): number {
    const m = this.materialAt(x, y, z);
    return m ? blockHp(m, this.strength, this.hpMultiplier) : 0;
  }

  /** Hit points a block has left (0 for air). */
  hpAt(x: number, y: number, z: number): number {
    if (!this.contains(x, y, z)) return 0;
    const max = this.maxHpAt(x, y, z);
    return max ? Math.max(0, max - this.damageMap[this.index(x, y, z)] / 10) : 0;
  }

  /** Damage taken, from 0 (intact) to 1 (about to break). */
  wearAt(x: number, y: number, z: number): number {
    const max = this.maxHpAt(x, y, z);
    return max ? Math.min(1, this.damageMap[this.index(x, y, z)] / 10 / max) : 0;
  }

  /** Sets a block (or clears it with null), fully repaired. Returns false outside the area. */
  set(x: number, y: number, z: number, material: string | null): boolean {
    if (!this.contains(x, y, z)) return false;
    const i = this.index(x, y, z);
    this.grid.data[i] = material === null ? AIR : this.slot(material);
    this.damageMap[i] = 0;
    this.changed(x, y, z);
    return true;
  }

  /** Damages a block by `amount` hit points; it breaks (and disappears) when they run out. */
  damage(x: number, y: number, z: number, amount: number): DamageResult {
    if (amount <= 0 || !this.solidAt(x, y, z)) return 'none';
    const i = this.index(x, y, z);
    const max = this.maxHpAt(x, y, z) * 10;
    const dealt = Math.max(1, Math.round(amount * 10));
    if (this.damageMap[i] + dealt >= max) {
      this.grid.data[i] = AIR;
      this.damageMap[i] = 0;
      this.changed(x, y, z);
      return 'broken';
    }
    this.damageMap[i] += dealt;
    this.version++;
    return 'damaged';
  }

  /** Repairs a block's damage. Returns the hit points restored. */
  repair(x: number, y: number, z: number): number {
    if (!this.solidAt(x, y, z)) return 0;
    const i = this.index(x, y, z);
    const restored = this.damageMap[i] / 10;
    if (restored === 0) return 0;
    this.damageMap[i] = 0;
    this.version++;
    return restored;
  }

  /** Total budget cost of every block standing. */
  cost(): number {
    if (this.costCache >= 0) return this.costCache;
    const slotCost = this.palette.map((m) => blockCost(m));
    let total = 0;
    const d = this.grid.data;
    for (let i = 0; i < d.length; i++) if (d[i] !== AIR) total += slotCost[d[i] - 1];
    this.costCache = total;
    return total;
  }

  blocks(): number {
    return this.grid.count();
  }

  /** Every damaged block with its wear (0–1), in world cells. */
  damaged(): Array<{ x: number; y: number; z: number; wear: number }> {
    const out: Array<{ x: number; y: number; z: number; wear: number }> = [];
    const { x: sx, z: sz } = this.grid.size;
    const dm = this.damageMap;
    for (let i = 0; i < dm.length; i++) {
      if (dm[i] === 0) continue;
      const lx = i % sx;
      const lz = Math.floor(i / sx) % sz;
      const y = Math.floor(i / (sx * sz));
      const x = lx + this.origin.x;
      const z = lz + this.origin.z;
      out.push({ x, y, z, wear: this.wearAt(x, y, z) });
    }
    return out;
  }

  /**
   * Places where a defender can stand guard: the top of every lookout block that has room above
   * it, in world cells (the cell the defender stands in).
   */
  posts(): Array<{ x: number; y: number; z: number }> {
    if (this.postsCache && this.postsCache.version === this.shape) return this.postsCache.posts;
    const posts: Array<{ x: number; y: number; z: number }> = [];
    const slot = this.palette.indexOf(LOOKOUT) + 1;
    if (slot > 0) {
      const { x: sx, y: sy, z: sz } = this.grid.size;
      for (let y = 0; y < sy; y++)
        for (let z = 0; z < sz; z++)
          for (let x = 0; x < sx; x++) {
            if (this.grid.get(x, y, z) !== slot || this.grid.get(x, y + 1, z) !== AIR) continue;
            posts.push({ x: x + this.origin.x, y: y + 1, z: z + this.origin.z });
          }
    }
    this.postsCache = { version: this.shape, posts };
    return posts;
  }

  /** The columns the warren's blocks span (inclusive world cells), or null when it has none. */
  footprint(): { x0: number; z0: number; x1: number; z1: number } | null {
    if (this.footprintCache && this.footprintCache.version === this.shape) return this.footprintCache.area;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const { x: sx, y: sy, z: sz } = this.grid.size;
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++)
        for (let y = 0; y < sy; y++) {
          if (this.grid.get(x, y, z) === AIR) continue;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          z0 = Math.min(z0, z);
          z1 = Math.max(z1, z);
          break;
        }
    const area = x0 === Infinity ? null : { x0: x0 + this.origin.x, z0: z0 + this.origin.z, x1: x1 + this.origin.x, z1: z1 + this.origin.z };
    this.footprintCache = { version: this.shape, area };
    return area;
  }

  /** True when the column has any block in it (the ground below gets no sky). */
  columnCovered(x: number, z: number): boolean {
    const lx = x - this.origin.x;
    const lz = z - this.origin.z;
    for (let y = 0; y < this.grid.size.y; y++) if (this.grid.get(lx, y, lz) !== AIR) return true;
    return false;
  }

  toState(): BaseState {
    return {
      origin: { ...this.origin },
      size: { ...this.grid.size },
      palette: [...this.palette],
      voxels: new Uint16Array(this.grid.data),
      damage: new Uint16Array(this.damageMap),
    };
  }

  private index(x: number, y: number, z: number): number {
    return this.grid.index(x - this.origin.x, y, z - this.origin.z);
  }

  private slot(material: string): number {
    let i = this.palette.indexOf(material);
    if (i < 0) {
      this.palette.push(material);
      i = this.palette.length - 1;
    }
    return i + 1;
  }

  private changed(x: number, y: number, z: number): void {
    this.version++;
    this.shape++;
    this.costCache = -1;
    this.onChange?.(x, y, z);
    this.onViewChange?.(x, y, z);
  }
}
