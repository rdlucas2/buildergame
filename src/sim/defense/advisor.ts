import type { Defense, DefenseAction } from './defense';
import { BASE_SIZE, DefenseBase, LOOKOUT } from './base';
import { MAX_ROOM, roomFor } from './design';
import { CORE, blockCost } from './materials';

/**
 * Sensible moves for a Warren Defense round, worked out by code that knows the rules: what a
 * player (or a bot) could build or buy right now, each as named, ready-to-apply actions. A bot's
 * brain chooses among these; it never has to invent block coordinates.
 */
export interface BuildOption {
  id: string;
  /** Short, for menus and logs. */
  label: string;
  /** What it does and why it might help, for a brain to weigh. */
  description: string;
  actions: DefenseAction[];
  /** Block budget it uses, and points it spends. */
  budget: number;
  points: number;
}

type Cell = { x: number; y: number; z: number };

/** The strongest material that can be built with now. */
function strongest(d: Defense): string {
  return d.tiers >= 5 ? 'iron' : d.tiers >= 4 ? 'stone_bricks' : 'cobblestone';
}

/** Cells of the warren's outer ring (the footprint's edge). */
function ring(d: Defense): Array<{ x: number; z: number }> {
  const f = d.base.footprint();
  if (!f) return [];
  const out: Array<{ x: number; z: number }> = [];
  for (let z = f.z0; z <= f.z1; z++) for (let x = f.x0; x <= f.x1; x++) if (x === f.x0 || x === f.x1 || z === f.z0 || z === f.z1) out.push({ x, z });
  return out;
}

/** Wall tops of the ring only 3 high: a fourth course there keeps tigers (which leap 3) out. */
function lowWallTops(d: Defense): Cell[] {
  const b = d.base;
  return ring(d)
    .filter(({ x, z }) => b.solidAt(x, 2, z) && !b.solidAt(x, 3, z))
    .map(({ x, z }) => ({ x, y: 3, z }));
}

/**
 * Holes broken through the ring: wall columns open at heights 1 and 2 next to wall that still
 * stands (a rabbits' doorway is only open at height 0). Putting back those two blocks leaves at most
 * a doorway.
 */
function breaches(d: Defense): Cell[] {
  const b = d.base;
  const out: Cell[] = [];
  for (const { x, z } of ring(d)) {
    if (b.solidAt(x, 1, z) || b.solidAt(x, 2, z)) continue;
    const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => b.solidAt(x + dx, 1, z + dz));
    if (beside) out.push({ x, y: 1, z }, { x, y: 2, z });
  }
  return out;
}

/** Blocks right above the rabbits' 1-high doorways: where wolves break in first. */
function lintels(d: Defense): Cell[] {
  const b = d.base;
  return ring(d)
    .filter(({ x, z }) => !b.solidAt(x, 0, z) && b.solidAt(x, 1, z))
    .map(({ x, z }) => ({ x, y: 1, z }));
}

/**
 * Top blocks of the outer walls, every other one along the ring, that could become lookout posts:
 * posts built into the top course stay level with the walkway, so defenders can walk to them.
 */
function postSpots(d: Defense): Cell[] {
  const b = d.base;
  const out: Cell[] = [];
  for (const { x, z } of ring(d)) {
    if ((x + z) % 2 !== 0) continue;
    let top = -1;
    for (let y = b.size.y - 1; y >= 0; y--)
      if (b.solidAt(x, y, z)) {
        top = y;
        break;
      }
    const m = top >= 2 ? b.materialAt(x, top, z) : null;
    if (m && m !== LOOKOUT && m !== CORE) out.push({ x, y: top, z });
  }
  return out;
}

/** How far out from the warren's walls a new ring of walls goes. */
export const EXPANSION_GAP = 4;

/**
 * A new ring of walls `EXPANSION_GAP` cells outside the warren's footprint (null when it wouldn't
 * fit in the building area): stone, 3 high (4 once tigers are coming), every other top block a
 * lookout post, a 1-high rabbit gap in the middle of each side (as in the starter warren, so rabbits
 * that leave can get back in), and steps up inside two corners. The ground between the rings
 * becomes room for more rabbits.
 */
export function expansion(d: Defense): Array<{ x: number; y: number; z: number; material: string }> | null {
  const b = d.base;
  const f = b.footprint();
  // Only while it makes room for more rabbits.
  if (!f || d.room >= MAX_ROOM) return null;
  const x0 = f.x0 - EXPANSION_GAP;
  const z0 = f.z0 - EXPANSION_GAP;
  const x1 = f.x1 + EXPANSION_GAP;
  const z1 = f.z1 + EXPANSION_GAP;
  if (x0 < b.origin.x || z0 < b.origin.z || x1 >= b.origin.x + BASE_SIZE.x || z1 >= b.origin.z + BASE_SIZE.z) return null;
  const height = d.clock >= RAISE_FROM ? 4 : 3;
  const out: Array<{ x: number; y: number; z: number; material: string }> = [];
  const mx = Math.floor((x0 + x1) / 2);
  const mz = Math.floor((z0 + z1) / 2);
  const gap = (x: number, z: number) => (x === mx && (z === z0 || z === z1)) || (z === mz && (x === x0 || x === x1));
  const wall = (x: number, z: number) => {
    for (let y = gap(x, z) ? 1 : 0; y < height; y++) if (!b.solidAt(x, y, z)) out.push({ x, y, z, material: y === height - 1 && (x + z) % 2 === 0 ? LOOKOUT : 'cobblestone' });
  };
  for (let x = x0; x <= x1; x++) {
    wall(x, z0);
    wall(x, z1);
  }
  for (let z = z0 + 1; z < z1; z++) {
    wall(x0, z);
    wall(x1, z);
  }
  // Steps up to the walkway inside two corners: 1, 2, ... high, next to the wall.
  for (const [sx, sz, dx] of [
    [x0 + 1, z0 + 1, 1],
    [x1 - 1, z1 - 1, -1],
  ])
    for (let i = 0; i < height - 1; i++) for (let y = 0; y <= i; y++) if (!b.solidAt(sx + dx * (height - 2 - i), y, sz)) out.push({ x: sx + dx * (height - 2 - i), y, z: sz, material: 'planks' });
  return out.length ? out : null;
}

/** The next ring of walls as one all-or-nothing action, with what it costs and adds. */
export interface ExpansionPlan {
  action: DefenseAction;
  cost: number;
  /** Lookout posts it adds. */
  posts: number;
  /** Rabbits the warren will have room for. */
  room: number;
}

export function expansionPlan(d: Defense): ExpansionPlan | null {
  const blocks = expansion(d);
  if (!blocks) return null;
  const after = new DefenseBase(d.base.toState());
  for (const b of blocks) after.set(b.x, b.y, b.z, b.material);
  return {
    action: { type: 'placeMany', blocks },
    cost: blocks.reduce((s, c) => s + blockCost(c.material), 0),
    posts: blocks.filter((c) => c.material === LOOKOUT).length,
    room: roomFor(after.enclosedFloor(), d.modifiers.rabbits),
  };
}

/** Seconds into a round when new walls go up 4 high (tigers leap 3 from 8:00). */
const RAISE_FROM = 300;

/** A 5×5 roof one block up in the middle of the warren: a nursery hawks can't dive into. */
function nursery(d: Defense): Cell[] {
  const { site, base } = d;
  const out: Cell[] = [];
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (!base.solidAt(site.x + dx, 1, site.z + dz) && !base.solidAt(site.x + dx, 0, site.z + dz)) out.push({ x: site.x + dx, y: 1, z: site.z + dz });
  return out;
}

/** Up to `n` blocks of `material` at `cells`, as one all-or-nothing placement. */
function placeAll(cells: Cell[], material: string): DefenseAction[] {
  return cells.length ? [{ type: 'placeMany', blocks: cells.map((c) => ({ ...c, material })) }] : [];
}

/**
 * What could be done now, cheapest information first. Only options that are possible right now
 * (affordable, and with somewhere to build) are listed; 'wait' is always there.
 */
export function buildOptions(d: Defense): BuildOption[] {
  if (d.over) return [];
  const free = d.budget - d.base.cost();
  const best = strongest(d);
  const out: BuildOption[] = [];
  const add = (o: BuildOption) => {
    if (o.actions.length > 0 && o.budget <= free && o.points <= d.points) out.push(o);
  };

  const holes = breaches(d);
  add({ id: 'rebuild-breaches', label: 'Rebuild breaches', description: `Close ${holes.length / 2} hole(s) predators broke in the walls, in ${best}.`, actions: placeAll(holes, best), budget: holes.length * blockCost(best), points: 0 });

  const tops = lowWallTops(d);
  add({ id: 'raise-walls', label: 'Raise the walls', description: 'Add a fourth course on top of the 3-high walls so tigers (from 8:00) cannot leap in.', actions: placeAll(tops, 'cobblestone'), budget: tops.length * blockCost('cobblestone'), points: 0 });

  const roof = nursery(d);
  add({ id: 'roof-nursery', label: 'Roof a nursery', description: 'A 5x5 roof in the middle of the warren for rabbits to hide under from hawks (from 12:00).', actions: placeAll(roof, 'planks'), budget: roof.length * blockCost('planks'), points: 0 });

  const posts = postSpots(d).slice(0, 16);
  add({
    id: 'more-lookouts',
    label: 'More lookouts',
    description: `Make ${posts.length} top blocks of the outer walls into lookout posts, so more defenders can shoot from them.`,
    actions: posts.flatMap((c): DefenseAction[] => [{ type: 'remove', ...c }, { type: 'place', ...c, material: LOOKOUT }]),
    budget: posts.reduce((s, c) => s + blockCost(LOOKOUT) - blockCost(d.base.materialAt(c.x, c.y, c.z) ?? LOOKOUT), 0),
    points: 0,
  });

  const ring = expansionPlan(d);
  if (ring)
    add({
      id: 'expand-warren',
      label: 'Expand the warren',
      description: `Build a new ring of walls ${EXPANSION_GAP} blocks outside the warren, with ${ring.posts} lookout posts along its top: room for ${ring.room} rabbits (${d.room} now) and more defenders.`,
      actions: [ring.action],
      budget: ring.cost,
      points: 0,
    });

  const weak = lintels(d).filter((c) => d.base.materialAt(c.x, c.y, c.z) !== best);
  const swap = weak.reduce((s, c) => s + blockCost(best) - blockCost(d.base.materialAt(c.x, c.y, c.z) ?? best), 0);
  add({
    id: 'reinforce-doorways',
    label: 'Reinforce doorways',
    description: `Rebuild the blocks over the rabbits' doorways (where wolves break in first) in ${best}.`,
    actions: weak.flatMap((c): DefenseAction[] => [{ type: 'remove', ...c }, { type: 'place', ...c, material: best }]),
    budget: swap,
    points: 0,
  });

  if (d.repairPrice > 0) add({ id: 'repair', label: 'Repair', description: `Mend damaged blocks for up to ${d.repairPrice} points.`, actions: [{ type: 'repair' }], budget: 0, points: Math.min(d.points, d.repairPrice) });
  add({ id: 'buy-budget', label: 'More budget', description: `Buy 100 more block budget for ${d.budgetPrice} points.`, actions: [{ type: 'buyBudget' }], budget: 0, points: d.budgetPrice });

  if (Number.isFinite(d.reinforcePrice))
    add({ id: 'reinforce', label: 'Reinforce the warren', description: `+25% hit points for every block and the core for ${d.reinforcePrice} points.`, actions: [{ type: 'reinforce' }], budget: 0, points: d.reinforcePrice });

  if (d.nextWaveIn >= 5) add({ id: 'call-wave', label: 'Call the next wave', description: `Bring the next wave ${Math.round(d.nextWaveIn)} s early for bonus points (it comes before it is at full strength).`, actions: [{ type: 'callWave' }], budget: 0, points: 0 });

  out.push({ id: 'wait', label: 'Wait', description: 'Save the budget and points for later.', actions: [], budget: 0, points: 0 });
  return out;
}

/**
 * The actions an action, or a build option named by id, stands for right now (null when there is
 * no such option now). Bots and the game's debug API act through this.
 */
export function expand(d: Defense, input: DefenseAction | { option: string }): DefenseAction[] | null {
  if (!('option' in input)) return [input];
  return buildOptions(d).find((o) => o.id === input.option)?.actions ?? null;
}
