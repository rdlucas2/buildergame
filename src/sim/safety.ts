import { PREDATOR_BODY, PREY_BODY, type Body, type Cell, type Navigator } from './navigation';

/** How far around a cluster of structures the safety map looks (open ground beyond is unsafe). */
export const SAFETY_MARGIN = 8;

interface Rect {
  x0: number;
  z0: number;
  /** Exclusive. */
  x1: number;
  z1: number;
}

interface Region {
  rect: Rect;
  key: string;
  /** Positions a predator can reach, or catch prey at (next to a reachable position). */
  danger: Set<number>;
  /** Positions prey can walk into from outside that no predator can reach or catch them at. */
  safe: Cell[];
}

function posKey(x: number, y: number, z: number): number {
  return (y * 4096 + (z + 2048)) * 4096 + (x + 2048);
}

/** Largest number of positions one flood fill visits before giving up on a region. */
const MAX_FILL = 400_000;

/**
 * Where prey are safe from predators. Around every cluster of structures (expanded by
 * SAFETY_MARGIN), flood-fill the positions a predator can reach from the open edge, using its body
 * size and leap. Positions prey can reach from outside, which predators can neither reach nor catch
 * prey at from a neighbouring position, are safe: a room behind a 1-high door, a pen behind a wall
 * too tall to leap. Open ground away from structures is never safe.
 *
 * Rebuilt lazily after structures change. Regions whose structures didn't change are reused.
 */
export class SafetyMap {
  private regions: Region[] = [];
  private dirty = true;
  /** Bumped on every rebuild, so views know when to redraw. */
  version = 0;

  constructor(
    private readonly nav: Navigator,
    private readonly predator: Body = PREDATOR_BODY,
    private readonly prey: Body = PREY_BODY,
  ) {}

  invalidate(): void {
    this.dirty = true;
  }

  /** Is a creature standing at (x, y, z) out of every predator's reach? */
  isSafe(x: number, y: number, z: number): boolean {
    this.ensure();
    const r = this.regionAt(x, z);
    return !!r && !r.danger.has(posKey(x, y, z));
  }

  /** Nearest safe position to (x, y, z) within `maxDistance` cells (horizontal), or null. */
  nearestSafe(x: number, y: number, z: number, maxDistance: number): Cell | null {
    this.ensure();
    let best: Cell | null = null;
    let bestD = maxDistance * maxDistance;
    for (const r of this.regions) {
      const { rect } = r;
      const dx = Math.max(rect.x0 - x, 0, x - (rect.x1 - 1));
      const dz = Math.max(rect.z0 - z, 0, z - (rect.z1 - 1));
      if (dx * dx + dz * dz > bestD) continue;
      for (const c of r.safe) {
        const d = (c.x - x) ** 2 + (c.z - z) ** 2 + (c.y - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  /** Every safe position prey can walk into, for drawing the overlay. */
  safeCells(): Cell[] {
    this.ensure();
    const out: Cell[] = [];
    for (const r of this.regions) for (const c of r.safe) out.push(c);
    return out;
  }

  /** The version after bringing the map up to date (it changes whenever the map is rebuilt). */
  get currentVersion(): number {
    this.ensure();
    return this.version;
  }

  get regionCount(): number {
    this.ensure();
    return this.regions.length;
  }

  private regionAt(x: number, z: number): Region | undefined {
    for (const r of this.regions) if (x >= r.rect.x0 && x < r.rect.x1 && z >= r.rect.z0 && z < r.rect.z1) return r;
    return undefined;
  }

  private ensure(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.rebuild();
  }

  private rebuild(): void {
    const index = this.nav.solids.index;
    const half = this.nav.terrain.half;
    // One rectangle per placement, grown by the margin, then merged until none overlap.
    let rects: Array<{ rect: Rect; ids: string[] }> = [];
    for (const p of index.all()) {
      const b = index.boundsOf(p.id);
      if (!b) continue;
      rects.push({
        rect: {
          x0: Math.max(-half, b.min.x - SAFETY_MARGIN),
          z0: Math.max(-half, b.min.z - SAFETY_MARGIN),
          x1: Math.min(half, b.max.x + SAFETY_MARGIN),
          z1: Math.min(half, b.max.z + SAFETY_MARGIN),
        },
        ids: [p.id],
      });
    }
    for (let merged = true; merged; ) {
      merged = false;
      const out: typeof rects = [];
      for (const r of rects) {
        const host = out.find((o) => o.rect.x0 < r.rect.x1 && r.rect.x0 < o.rect.x1 && o.rect.z0 < r.rect.z1 && r.rect.z0 < o.rect.z1);
        if (!host) {
          out.push({ rect: { ...r.rect }, ids: [...r.ids] });
          continue;
        }
        host.rect = {
          x0: Math.min(host.rect.x0, r.rect.x0),
          z0: Math.min(host.rect.z0, r.rect.z0),
          x1: Math.max(host.rect.x1, r.rect.x1),
          z1: Math.max(host.rect.z1, r.rect.z1),
        };
        host.ids.push(...r.ids);
        merged = true;
      }
      rects = out;
    }
    const previous = new Map(this.regions.map((r) => [r.key, r]));
    this.regions = rects.map(({ rect, ids }) => {
      const key = `${rect.x0},${rect.z0},${rect.x1},${rect.z1}|${ids.sort().join(',')}`;
      return previous.get(key) ?? this.analyse(rect, key);
    });
    this.version++;
  }

  private analyse(rect: Rect, key: string): Region {
    const reach = this.fill(rect, this.predator);
    const danger = new Set<number>();
    for (const k of reach) {
      const x = (k % 4096) - 2048;
      const z = (Math.floor(k / 4096) % 4096) - 2048;
      const y = Math.floor(k / (4096 * 4096));
      // A predator here can catch prey in its own column or the four next to it, a step up or down.
      for (let dy = -1; dy <= 1; dy++) {
        if (y + dy < 0) continue;
        danger.add(posKey(x, y + dy, z));
        danger.add(posKey(x + 1, y + dy, z));
        danger.add(posKey(x - 1, y + dy, z));
        danger.add(posKey(x, y + dy, z + 1));
        danger.add(posKey(x, y + dy, z - 1));
      }
    }
    const safe: Cell[] = [];
    for (const k of this.fill(rect, this.prey)) {
      if (danger.has(k)) continue;
      safe.push({ x: (k % 4096) - 2048, y: Math.floor(k / (4096 * 4096)), z: (Math.floor(k / 4096) % 4096) - 2048 });
    }
    return { rect, key, danger, safe };
  }

  /** Every position a body can reach inside the rectangle, starting from its open border. */
  private fill(rect: Rect, body: Body): Set<number> {
    const seen = new Set<number>();
    const queue: Cell[] = [];
    const inside = (x: number, z: number) => x >= rect.x0 && x < rect.x1 && z >= rect.z0 && z < rect.z1;
    const seed = (x: number, z: number) => {
      if (!this.nav.standable(x, 0, z, body)) return;
      const k = posKey(x, 0, z);
      if (seen.has(k)) return;
      seen.add(k);
      queue.push({ x, y: 0, z });
    };
    for (let x = rect.x0; x < rect.x1; x++) {
      seed(x, rect.z0);
      seed(x, rect.z1 - 1);
    }
    for (let z = rect.z0; z < rect.z1; z++) {
      seed(rect.x0, z);
      seed(rect.x1 - 1, z);
    }
    for (let head = 0; head < queue.length && seen.size < MAX_FILL; head++) {
      this.nav.forEachMove(queue[head], body, (x, y, z) => {
        if (!inside(x, z)) return;
        const k = posKey(x, y, z);
        if (seen.has(k)) return;
        seen.add(k);
        queue.push({ x, y, z });
      });
    }
    return seen;
  }
}
