import type { BaseState } from '../../core/defense-state';
import { AIR, VoxelGrid, type Size3 } from '../../core/voxel-grid';
import { CORE, STRENGTH_PER_LEVEL, blockCost, blockHp } from './materials';

/** Size of the area a warren can be built in, centred on the base site. */
export const BASE_SIZE: Size3 = { x: 48, y: 16, z: 48 };

/** Material that marks a defender's post: defenders stand on top of it. */
export const LOOKOUT = 'lookout';

/** Hit points of the warren's core (before the block upgrades multiply them). */
export const CORE_HP = 1500;


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
  /** Damage the core has taken, in tenths of a hit point: its blocks share one pool. */
  coreDamage = 0;
  private costCache = -1;
  private coreCache: { version: number; cells: Array<{ x: number; y: number; z: number }> } | null = null;
  private enclosedCache: { version: number; cells: number } | null = null;
  private postsCache: { version: number; posts: Array<{ x: number; y: number; z: number }> } | null = null;
  private footprintCache: { version: number; area: { x0: number; z0: number; x1: number; z1: number } | null } | null = null;

  constructor(state: Pick<BaseState, 'origin'> & Partial<BaseState>) {
    const size = state.size ?? BASE_SIZE;
    this.origin = { x: state.origin.x, z: state.origin.z };
    this.grid = new VoxelGrid(size, state.voxels ? new Uint16Array(state.voxels) : undefined);
    this.palette = [...(state.palette ?? [])];
    this.damageMap = state.damage && state.damage.length === this.grid.length ? new Uint16Array(state.damage) : new Uint16Array(this.grid.length);
    this.coreDamage = state.coreDamage ?? 0;
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
    if (m === CORE) return this.coreMaxHp;
    return m ? blockHp(m, this.strength, this.hpMultiplier) : 0;
  }

  /** Hit points a block has left (0 for air). A core block has what the whole core has left. */
  hpAt(x: number, y: number, z: number): number {
    if (!this.contains(x, y, z)) return 0;
    const max = this.maxHpAt(x, y, z);
    return max ? Math.max(0, max - this.damageAt(x, y, z) / 10) : 0;
  }

  /** Damage taken, from 0 (intact) to 1 (about to break). */
  wearAt(x: number, y: number, z: number): number {
    const max = this.maxHpAt(x, y, z);
    return max ? Math.min(1, this.damageAt(x, y, z) / 10 / max) : 0;
  }

  private damageAt(x: number, y: number, z: number): number {
    return this.materialAt(x, y, z) === CORE ? this.coreDamage : this.damageMap[this.index(x, y, z)];
  }

  // ---- the core ----------------------------------------------------------------------------

  /** Hit points of the whole core: tougher with the block upgrades, and with every reinforcement. */
  get coreMaxHp(): number {
    return Math.round(CORE_HP * this.hpMultiplier * (1 + STRENGTH_PER_LEVEL * this.reinforced));
  }

  /** Reinforcements bought for the whole warren: the lowest strength level of any tier. */
  get reinforced(): number {
    return this.strength.length ? Math.min(...this.strength) : 0;
  }

  /**
   * Open ground inside the warren: cells a predator 2 blocks tall can't walk to from outside without
   * breaking in (a 1-high rabbit gap doesn't let it through). This is the room the rabbits have.
   */
  enclosedFloor(): number {
    if (this.enclosedCache && this.enclosedCache.version === this.shape) return this.enclosedCache.cells;
    const { x: sx, z: sz } = this.grid.size;
    // The grid plus a ring of open ground around it, where the search starts.
    const w = sx + 2;
    const h = sz + 2;
    const blocked = (lx: number, lz: number) => lx >= 0 && lz >= 0 && lx < sx && lz < sz && (this.grid.get(lx, 0, lz) !== AIR || this.grid.get(lx, 1, lz) !== AIR);
    const seen = new Uint8Array(w * h);
    const queue: number[] = [];
    for (let i = 0; i < w; i++)
      for (const j of [0, h - 1]) {
        queue.push(i + j * w);
        seen[i + j * w] = 1;
      }
    for (let j = 1; j < h - 1; j++)
      for (const i of [0, w - 1]) {
        queue.push(i + j * w);
        seen[i + j * w] = 1;
      }
    while (queue.length > 0) {
      const k = queue.pop()!;
      const i = k % w;
      const j = Math.floor(k / w);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const nk = ni + nj * w;
        if (seen[nk] || blocked(ni - 1, nj - 1)) continue;
        seen[nk] = 1;
        queue.push(nk);
      }
    }
    let cells = 0;
    for (let lz = 0; lz < sz; lz++) for (let lx = 0; lx < sx; lx++) if (!seen[lx + 1 + (lz + 1) * w] && this.grid.get(lx, 0, lz) === AIR) cells++;
    this.enclosedCache = { version: this.shape, cells };
    return cells;
  }

  /** Hit points the core has left (0 once it has fallen, or when there is none). */
  get coreHp(): number {
    return this.coreCells().length ? Math.max(0, this.coreMaxHp - this.coreDamage / 10) : 0;
  }

  /** The core's blocks, in world cells (empty once it has fallen). */
  coreCells(): Array<{ x: number; y: number; z: number }> {
    if (this.coreCache && this.coreCache.version === this.shape) return this.coreCache.cells;
    const cells: Array<{ x: number; y: number; z: number }> = [];
    const slot = this.palette.indexOf(CORE) + 1;
    if (slot > 0) {
      const d = this.grid.data;
      const { x: sx, z: sz } = this.grid.size;
      for (let i = 0; i < d.length; i++) if (d[i] === slot) cells.push({ x: (i % sx) + this.origin.x, y: Math.floor(i / (sx * sz)), z: (Math.floor(i / sx) % sz) + this.origin.z });
    }
    this.coreCache = { version: this.shape, cells };
    return cells;
  }

  /** Puts a fresh core of `w`×`w` blocks, `h` high, centred on (cx, cz). */
  placeCore(cx: number, cz: number, w = 2, h = 2): void {
    for (const c of this.coreCells()) this.set(c.x, c.y, c.z, null);
    const x0 = cx - Math.floor((w - 1) / 2);
    const z0 = cz - Math.floor((w - 1) / 2);
    for (let y = 0; y < h; y++) for (let z = z0; z < z0 + w; z++) for (let x = x0; x < x0 + w; x++) this.set(x, y, z, CORE);
    this.coreDamage = 0;
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

  /**
   * Damages a block by `amount` hit points; it breaks (and disappears) when they run out. Damage to
   * any core block comes off the whole core, which falls all at once.
   */
  damage(x: number, y: number, z: number, amount: number): DamageResult {
    if (amount <= 0 || !this.solidAt(x, y, z)) return 'none';
    if (this.materialAt(x, y, z) === CORE) {
      this.coreDamage += Math.max(1, Math.round(amount * 10));
      if (this.coreDamage < this.coreMaxHp * 10) {
        this.version++;
        return 'damaged';
      }
      for (const c of [...this.coreCells()]) {
        this.grid.data[this.index(c.x, c.y, c.z)] = AIR;
        this.changed(c.x, c.y, c.z);
      }
      this.coreDamage = 0;
      return 'broken';
    }
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

  /** Repairs up to `amount` hit points of a block's damage (all of it by default). Returns the hit points restored. */
  repair(x: number, y: number, z: number, amount = Infinity): number {
    if (!this.solidAt(x, y, z)) return 0;
    if (this.materialAt(x, y, z) === CORE) {
      const tenths = Math.min(this.coreDamage, Math.floor(amount * 10));
      if (tenths <= 0) return 0;
      this.coreDamage -= tenths;
      this.version++;
      return tenths / 10;
    }
    const i = this.index(x, y, z);
    const tenths = Math.min(this.damageMap[i], Math.floor(amount * 10));
    if (tenths <= 0) return 0;
    this.damageMap[i] -= tenths;
    this.version++;
    return tenths / 10;
  }

  /** Hit points of damage across every block. */
  totalDamage(): number {
    let sum = this.coreCells().length ? this.coreDamage : 0;
    for (let i = 0; i < this.damageMap.length; i++) sum += this.damageMap[i];
    return sum / 10;
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

  /** Every damaged block with its wear (0–1), in world cells. A damaged core counts once. */
  damaged(): Array<{ x: number; y: number; z: number; wear: number }> {
    const out: Array<{ x: number; y: number; z: number; wear: number }> = [];
    const core = this.coreCells()[0];
    if (core && this.coreDamage > 0) out.push({ ...core, wear: this.wearAt(core.x, core.y, core.z) });
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
      coreDamage: this.coreDamage,
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
