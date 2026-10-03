import type { Defense, DefenseAction } from './defense';
import { TIERS, blockCost, tierOf } from './materials';

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

/** Wall tops every few blocks along the ring, without a lookout yet. */
function lookoutSpots(d: Defense): Cell[] {
  const b = d.base;
  const f = b.footprint();
  if (!f) return [];
  const out: Cell[] = [];
  for (const { x, z } of ring(d)) {
    if ((x - f.x0) % 4 !== 0 || (z - f.z0) % 4 !== 0) continue;
    for (let y = 1; y < b.size.y - 1; y++)
      if (b.solidAt(x, y - 1, z) && !b.solidAt(x, y, z) && !b.solidAt(x, y + 1, z)) {
        if (b.materialAt(x, y - 1, z) !== 'lookout') out.push({ x, y, z });
        break;
      }
  }
  return out;
}

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

  const posts = lookoutSpots(d);
  add({ id: 'more-lookouts', label: 'More lookouts', description: `Add ${posts.length} lookout posts on the walls so more defenders can shoot from high up.`, actions: placeAll(posts, 'lookout'), budget: posts.length * blockCost('lookout'), points: 0 });

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

  // Strength for the tier most of the walls are made of.
  const counts = new Map<number, number>();
  for (const { x, z } of ring(d)) for (let y = 0; y < 4; y++) {
    const m = d.base.materialAt(x, y, z);
    if (m) counts.set(tierOf(m), (counts.get(tierOf(m)) ?? 0) + 1);
  }
  const wallTier = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (wallTier !== undefined && Number.isFinite(d.strengthPrice(wallTier)))
    add({ id: `strengthen-${wallTier}`, label: `Strengthen ${TIERS[wallTier].name.toLowerCase()}`, description: `+25% hit points for every ${TIERS[wallTier].name.toLowerCase()} block (most of the walls) for ${d.strengthPrice(wallTier)} points.`, actions: [{ type: 'strengthen', tier: wallTier }], budget: 0, points: d.strengthPrice(wallTier) });

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
