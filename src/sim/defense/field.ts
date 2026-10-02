import { MOVE_DIRS, MinHeap, Navigator, type Body, type BreachCell, type BreachCost, type Cell } from '../navigation';
import type { SolidMap } from '../solids';
import type { Terrain } from '../terrain';

/**
 * A copy of which cells are solid in a box of columns around the warren, from the ground up to
 * `height`. Building a field asks about the same cells many times; this answers from a flat array.
 * Outside the box everything above the ground is open.
 */
export class SolidSnapshot {
  private readonly bits: Uint8Array;

  constructor(
    solids: SolidMap,
    readonly x0: number,
    readonly z0: number,
    readonly sx: number,
    readonly sz: number,
    readonly height: number,
  ) {
    this.bits = new Uint8Array(sx * sz * height);
    let i = 0;
    for (let y = 0; y < height; y++)
      for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) this.bits[i++] = solids.solid(x0 + x, y, z0 + z) ? 1 : 0;
  }

  solid(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    const lx = x - this.x0;
    const lz = z - this.z0;
    if (lx < 0 || lz < 0 || lx >= this.sx || lz >= this.sz || y >= this.height) return false;
    return this.bits[lx + this.sx * (lz + this.sz * y)] === 1;
  }

  openColumn(): boolean {
    return false;
  }

  /** A navigator that sees this snapshot instead of the live world. */
  navigator(terrain: Terrain): Navigator {
    return new Navigator(this as unknown as SolidMap, terrain);
  }
}

/**
 * How far every cell around the warren is from the nearest rabbit, for one kind of predator: in
 * path cost, counting what it costs that predator to break through blocks in the way. Built once
 * (a Dijkstra search outwards from the rabbits, over reversed moves) and shared by every predator
 * of that kind, which then just walks downhill. So the whole pack heads for the weakest wall,
 * whatever the warren's shape, without each predator searching on its own.
 */
export class BreachField {
  private readonly dist: Float32Array;
  /** Per column, a bit per height where the body can be: standing, or breaking in. */
  private readonly nodes: Uint32Array;
  /** Cells settled by the search (for tests and tuning). */
  settled = 0;

  constructor(
    private readonly snap: SolidSnapshot,
    private readonly nav: Navigator,
    readonly body: Body,
    private readonly breach: BreachCost,
    goals: Iterable<Cell>,
  ) {
    const { sx, sz, height } = snap;
    this.dist = new Float32Array(sx * sz * height).fill(Infinity);
    this.nodes = new Uint32Array(sx * sz);
    for (let lz = 0; lz < sz; lz++)
      for (let lx = 0; lx < sx; lx++) {
        const x = lx + snap.x0;
        const z = lz + snap.z0;
        let mask = 0;
        for (let y = 0; y < height; y++) {
          if (!snap.solid(x, y - 1, z)) continue;
          if (nav.standable(x, y, z, body) || nav.breachInto(x, y, z, body, breach) !== null) mask |= 1 << y;
        }
        this.nodes[lx + sx * lz] = mask;
      }
    this.search(goals);
  }

  private index(x: number, y: number, z: number): number {
    const lx = x - this.snap.x0;
    const lz = z - this.snap.z0;
    if (lx < 0 || lz < 0 || lx >= this.snap.sx || lz >= this.snap.sz || y < 0 || y >= this.snap.height) return -1;
    return lx + this.snap.sx * (lz + this.snap.sz * y);
  }

  private isNode(x: number, y: number, z: number): boolean {
    const lx = x - this.snap.x0;
    const lz = z - this.snap.z0;
    if (lx < 0 || lz < 0 || lx >= this.snap.sx || lz >= this.snap.sz || y < 0 || y >= this.snap.height) return false;
    return (this.nodes[lx + this.snap.sx * lz] & (1 << y)) !== 0;
  }

  /** Path cost from (x, y, z) to the nearest rabbit; Infinity when unknown or out of reach. */
  at(x: number, y: number, z: number): number {
    const i = this.index(x, y, z);
    return i < 0 ? Infinity : this.dist[i];
  }

  private search(goals: Iterable<Cell>): void {
    const { sx, sz } = this.snap;
    const layer = sx * sz;
    const heap = new MinHeap();
    for (const g of goals) {
      if (!this.isNode(g.x, g.y, g.z)) continue;
      const i = this.index(g.x, g.y, g.z);
      if (this.dist[i] === 0) continue;
      this.dist[i] = 0;
      heap.push(i, 0);
    }
    const { nav, body, breach } = this;
    const from: Cell = { x: 0, y: 0, z: 0 };
    while (heap.size > 0) {
      const i = heap.pop();
      const d = this.dist[i];
      const cy = Math.floor(i / layer);
      const rest = i - cy * layer;
      const cz = Math.floor(rest / sx) + this.snap.z0;
      const cx = (rest % sx) + this.snap.x0;
      this.settled++;
      // Every cell that can step into (cx, cy, cz): the neighbouring columns, at heights it could
      // climb or drop from (or the same height, breaking in).
      for (const [dx, dz, base] of MOVE_DIRS) {
        const px = cx - dx;
        const pz = cz - dz;
        const lx = px - this.snap.x0;
        const lz = pz - this.snap.z0;
        if (lx < 0 || lz < 0 || lx >= sx || lz >= sz) continue;
        const mask = this.nodes[lx + sx * lz];
        if (mask === 0) continue;
        const lo = Math.max(0, cy - body.climb);
        const hi = Math.min(this.snap.height - 1, cy + body.drop);
        for (let py = lo; py <= hi; py++) {
          if ((mask & (1 << py)) === 0) continue;
          const pi = lx + sx * (lz + sz * py);
          if (this.dist[pi] <= d) continue;
          from.x = px;
          from.y = py;
          from.z = pz;
          const cost = nav.stepTo(from, dx, dz, base, body, breach);
          if (cost < 0 || nav.landY !== cy) continue;
          const nd = d + cost;
          if (nd < this.dist[pi]) {
            this.dist[pi] = nd;
            heap.push(pi, nd);
          }
        }
      }
    }
  }

  /**
   * Up to `max` steps downhill from `start`, on the live map `nav`: each step is the move with the
   * lowest step cost plus distance left. Stops after a step that breaks in (the predator has to
   * break through first) or at a rabbit's cell. Empty when `start` is off the field.
   */
  descend(nav: Navigator, start: Cell, max: number): BreachCell[] {
    const path: BreachCell[] = [];
    let cur: Cell = start;
    let here = this.at(cur.x, cur.y, cur.z);
    if (!Number.isFinite(here)) return path;
    for (let n = 0; n < max && here > 0; n++) {
      let best: BreachCell | null = null;
      let bestScore = Infinity;
      let bestDist = here;
      nav.forEachMove(
        cur,
        this.body,
        (x, y, z, cost, broken) => {
          const d = this.at(x, y, z);
          if (d >= here || cost + d >= bestScore) return;
          bestScore = cost + d;
          bestDist = d;
          best = broken ? { x, y, z, breach: true } : { x, y, z };
        },
        this.breach,
      );
      if (!best) break;
      const step: BreachCell = best;
      path.push(step);
      if (step.breach) break;
      cur = step;
      here = bestDist;
    }
    return path;
  }
}
