import type { SolidMap } from './solids';
import { cellIndex, inGround, type Terrain } from './terrain';

/** How a creature fits the world: body height, how far it can step or leap up, and drop down. */
export interface Body {
  height: number;
  climb: number;
  drop: number;
}

export const PREY_BODY: Body = { height: 1, climb: 1, drop: 3 };
/** Predators stand 2 tall and leap 2 up: a 1-high gap stops them, and so does a wall 3 or more high. */
export const PREDATOR_BODY: Body = { height: 2, climb: 2, drop: 3 };

export interface Cell {
  x: number;
  y: number;
  z: number;
}

const DIRS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Extra cost for moving through water (creatures can wade and swim, slowly). */
const WATER_COST = 3;

function key(x: number, y: number, z: number): number {
  return ((y * 4096 + (z + 2048)) * 4096) + (x + 2048);
}

/**
 * Movement rules and path-finding over the voxel world. A creature stands in an air cell whose
 * cell below is solid, or on the ground (y = 0), with `height` cells of clearance. It can move to a
 * neighbouring column by stepping up at most `climb` cells (with headroom to do so) or dropping at
 * most `drop` cells.
 */
export class Navigator {
  constructor(
    readonly solids: SolidMap,
    readonly terrain: Terrain,
  ) {}

  inBounds(x: number, z: number): boolean {
    return inGround(this.terrain.size, x, z);
  }

  isWater(x: number, z: number): boolean {
    return inGround(this.terrain.size, x, z) && this.terrain.water[cellIndex(this.terrain.size, x, z)] === 1;
  }

  clear(x: number, y: number, z: number, height: number): boolean {
    for (let i = 0; i < height; i++) if (this.solids.solid(x, y + i, z)) return false;
    return true;
  }

  /** Can a body of this height stand at (x, y, z)? */
  standable(x: number, y: number, z: number, body: Body): boolean {
    if (!this.inBounds(x, z) || y < 0) return false;
    return this.solids.solid(x, y - 1, z) && this.clear(x, y, z, body.height);
  }

  /** Where a creature at height `y` would stand after moving into column (x, z), or null. */
  landing(fromX: number, y: number, fromZ: number, x: number, z: number, body: Body): number | null {
    if (!this.inBounds(x, z)) return null;
    if (this.standable(x, y, z, body)) return y;
    for (let up = 1; up <= body.climb; up++) {
      // Leaping up needs headroom above the creature before it moves.
      if (this.solids.solid(fromX, y + body.height + up - 1, fromZ)) break;
      if (this.standable(x, y + up, z, body)) return y + up;
    }
    if (!this.clear(x, y, z, body.height)) return null;
    for (let down = 1; down <= body.drop; down++) if (this.standable(x, y - down, z, body)) return y - down;
    return null;
  }

  /** Lowest standable height in a column at or below `fromY` (used to place creatures and targets). */
  surfaceBelow(x: number, fromY: number, z: number, body: Body): number | null {
    for (let y = fromY; y >= 0; y--) if (this.standable(x, y, z, body)) return y;
    return null;
  }

  /**
   * Cheap check for the common case: both ends on open ground (y = 0) with nothing built along the
   * straight line between them, so a creature can simply walk there.
   */
  straightOnGround(a: Cell, b: Cell): boolean {
    if (a.y !== 0 || b.y !== 0) return false;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const n = Math.max(Math.abs(dx), Math.abs(dz));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(a.x + (dx * i) / Math.max(1, n));
      const z = Math.round(a.z + (dz * i) / Math.max(1, n));
      if (!this.inBounds(x, z) || !this.solids.openColumn(x, z)) return false;
    }
    return true;
  }

  /**
   * Calls `visit` for every position a body standing at `c` can move to in one step (eight
   * directions, never cutting a corner), with the cost of the step.
   */
  forEachMove(c: Cell, body: Body, visit: (x: number, y: number, z: number, cost: number) => void): void {
    for (const [dx, dz, base] of DIRS) {
      if (dx !== 0 && dz !== 0) {
        // No cutting corners: both side cells must be passable at this height.
        if (this.landing(c.x, c.y, c.z, c.x + dx, c.z, body) !== c.y || this.landing(c.x, c.y, c.z, c.x, c.z + dz, body) !== c.y) continue;
      }
      const nx = c.x + dx;
      const nz = c.z + dz;
      const ny = this.landing(c.x, c.y, c.z, nx, nz, body);
      if (ny === null) continue;
      visit(nx, ny, nz, base * (ny === 0 && this.isWater(nx, nz) ? WATER_COST : 1) + (ny > c.y ? 0.5 : 0));
    }
  }

  /**
   * A* from `start` to `goal` (or to any cell `isGoal` accepts). Explores at most `maxNodes` cells
   * and returns the path (excluding the start) or null when no path is found within the budget.
   */
  findPath(start: Cell, goal: Cell, body: Body, maxNodes = 2000, isGoal?: (c: Cell) => boolean): Cell[] | null {
    const reached = isGoal ?? ((c: Cell) => c.x === goal.x && c.z === goal.z && Math.abs(c.y - goal.y) <= body.climb);
    const h = (x: number, y: number, z: number) => {
      const dx = Math.abs(x - goal.x);
      const dz = Math.abs(z - goal.z);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz) + Math.abs(y - goal.y) * 0.5;
    };
    const open = new MinHeap();
    const g = new Map<number, number>();
    const came = new Map<number, number>();
    const cells = new Map<number, Cell>();
    const sk = key(start.x, start.y, start.z);
    g.set(sk, 0);
    cells.set(sk, start);
    open.push(sk, h(start.x, start.y, start.z));
    let expanded = 0;
    while (open.size > 0 && expanded < maxNodes) {
      const k = open.pop();
      const c = cells.get(k)!;
      if (k !== sk && reached(c)) return this.rebuild(came, cells, k, sk);
      expanded++;
      const gc = g.get(k)!;
      this.forEachMove(c, body, (nx, ny, nz, step) => {
        const nk = key(nx, ny, nz);
        const ng = gc + step;
        const prev = g.get(nk);
        if (prev !== undefined && prev <= ng) return;
        g.set(nk, ng);
        came.set(nk, k);
        if (!cells.has(nk)) cells.set(nk, { x: nx, y: ny, z: nz });
        open.push(nk, ng + h(nx, ny, nz));
      });
    }
    return null;
  }

  private rebuild(came: Map<number, number>, cells: Map<number, Cell>, end: number, start: number): Cell[] {
    const out: Cell[] = [];
    let k: number | undefined = end;
    while (k !== undefined && k !== start) {
      out.push(cells.get(k)!);
      k = came.get(k);
    }
    return out.reverse();
  }
}

/** Binary min-heap of numeric keys by priority. */
class MinHeap {
  private keys: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(k: number, p: number): void {
    const keys = this.keys, pri = this.pri;
    let i = keys.length;
    keys.push(k);
    pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= p) break;
      keys[i] = keys[parent];
      pri[i] = pri[parent];
      i = parent;
    }
    keys[i] = k;
    pri[i] = p;
  }

  pop(): number {
    const keys = this.keys, pri = this.pri;
    const top = keys[0];
    const lastK = keys.pop()!;
    const lastP = pri.pop()!;
    if (keys.length > 0) {
      let i = 0;
      const n = keys.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && pri[r] < pri[l] ? r : l;
        if (pri[m] >= lastP) break;
        keys[i] = keys[m];
        pri[i] = pri[m];
        i = m;
      }
      keys[i] = lastK;
      pri[i] = lastP;
    }
    return top;
  }
}
