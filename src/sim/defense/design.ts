import type { DefenseModifiers } from '../../core/defense-state';
import type { Structure } from '../../core/structure';
import { BASE_SIZE, DefenseBase } from './base';
import { CORE, blockCost } from './materials';
import { buildStarterWarren } from './starter';

/** One block of a warren design, relative to the design's own corner. */
export interface PlanBlock {
  x: number;
  y: number;
  z: number;
  material: string;
}

/** A warren designed in the builder: what a round starts with instead of the starter warren. */
export interface WarrenPlan {
  name: string;
  blocks: PlanBlock[];
}

/** Rabbits the warren has room for per cell of open ground inside it (the starter warren: 40). */
export const ROOM_PER_CELL = 0.25;
export const MIN_ROOM = 12;
/** However big the warren, no more rabbits than this (the simulation has to keep up). */
export const MAX_ROOM = 120;

/** Room for rabbits in a warren with `enclosed` cells of open ground inside, plus upgrades. */
export function roomFor(enclosed: number, extra = 0): number {
  return Math.max(MIN_ROOM, Math.min(MAX_ROOM, Math.round(enclosed * ROOM_PER_CELL) + extra));
}

/** What a design adds up to, and what (if anything) stops it being played. */
export interface PlanStats {
  size: { x: number; y: number; z: number };
  blocks: number;
  cost: number;
  posts: number;
  /** Rabbits it has room for (before upgrades). */
  room: number;
  /** Whether it has its one core: a single 2×2 block, 2 high. */
  core: 'ok' | 'missing' | 'wrong';
  /** Why it can't be played (with `budget`), or null when it can. */
  problem: string | null;
}

export function planSize(plan: WarrenPlan): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const b of plan.blocks) {
    x = Math.max(x, b.x + 1);
    y = Math.max(y, b.y + 1);
    z = Math.max(z, b.z + 1);
  }
  return { x, y, z };
}

/** The core blocks form exactly one 2×2×2 cube. */
export function coreState(blocks: readonly PlanBlock[]): PlanStats['core'] {
  const core = blocks.filter((b) => b.material === CORE);
  if (core.length === 0) return 'missing';
  if (core.length !== 8) return 'wrong';
  const x0 = Math.min(...core.map((b) => b.x));
  const y0 = Math.min(...core.map((b) => b.y));
  const z0 = Math.min(...core.map((b) => b.z));
  const cube = core.every((b) => b.x - x0 < 2 && b.y - y0 < 2 && b.z - z0 < 2);
  return cube ? 'ok' : 'wrong';
}

/** Stamps a design into `base` with its footprint centred on `site`. */
export function placePlan(base: DefenseBase, plan: WarrenPlan, site: { x: number; z: number }): void {
  const size = planSize(plan);
  const x0 = site.x - Math.floor(size.x / 2);
  const z0 = site.z - Math.floor(size.z / 2);
  for (const b of plan.blocks) base.set(x0 + b.x, b.y, z0 + b.z, b.material);
  base.coreDamage = 0;
}

/** The middle of a design's core, relative to the design's corner (null without one). */
export function coreOf(plan: WarrenPlan): { x: number; z: number } | null {
  const core = plan.blocks.filter((b) => b.material === CORE);
  if (core.length === 0) return null;
  return { x: core.reduce((s, b) => s + b.x + 0.5, 0) / core.length, z: core.reduce((s, b) => s + b.z + 0.5, 0) / core.length };
}

/** Cost, posts, room and core of a design; with a budget, also whether it is too dear to play. */
export function planStats(plan: WarrenPlan, budget = Infinity, modifiers: Partial<DefenseModifiers> = {}): PlanStats {
  const size = planSize(plan);
  const base = new DefenseBase({ origin: { x: 0, z: 0 } });
  const fits = size.x <= BASE_SIZE.x && size.y <= BASE_SIZE.y && size.z <= BASE_SIZE.z;
  if (fits) placePlan(base, plan, { x: Math.floor(BASE_SIZE.x / 2), z: Math.floor(BASE_SIZE.z / 2) });
  const cost = plan.blocks.reduce((s, b) => s + blockCost(b.material), 0);
  const core = coreState(plan.blocks);
  const stats: PlanStats = { size, blocks: plan.blocks.length, cost, posts: fits ? base.posts().length : 0, room: fits ? roomFor(base.enclosedFloor(), modifiers.rabbits ?? 0) : 0, core, problem: null };
  if (!fits) stats.problem = `It is ${size.x}×${size.y}×${size.z}; a warren must fit in ${BASE_SIZE.x}×${BASE_SIZE.y}×${BASE_SIZE.z}.`;
  else if (core === 'missing') stats.problem = 'It has no core: place the core (a warren has exactly one).';
  else if (core === 'wrong') stats.problem = 'Its core is broken up: a warren has exactly one core, a 2×2 block 2 high.';
  else if (cost > budget) stats.problem = `It costs ${cost} budget; a round starts with ${budget}.`;
  return stats;
}

/** The starter warren as a design (the designer's template). */
export function starterPlan(): WarrenPlan {
  const base = new DefenseBase({ origin: { x: 0, z: 0 } });
  const site = { x: Math.floor(BASE_SIZE.x / 2), z: Math.floor(BASE_SIZE.z / 2) };
  buildStarterWarren(base, site);
  const blocks: PlanBlock[] = [];
  const { x: sx, y: sy, z: sz } = base.size;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const m = base.materialAt(x, y, z);
    if (m) blocks.push({ x, y, z, material: m });
  }
  const x0 = Math.min(...blocks.map((b) => b.x));
  const z0 = Math.min(...blocks.map((b) => b.z));
  return { name: 'Starter warren', blocks: blocks.map((b) => ({ ...b, x: b.x - x0, z: b.z - z0 })) };
}

/** True for a library structure that is a warren design (it has the core). */
export function isWarrenDesign(s: Structure): boolean {
  const slot = s.palette.findIndex((p) => p.material === CORE) + 1;
  if (slot === 0) return false;
  for (let i = 0; i < s.voxels.data.length; i++) if (s.voxels.data[i] === slot) return true;
  return false;
}

/** A library structure as a warren design. */
export function planOf(s: Structure): WarrenPlan {
  const blocks: PlanBlock[] = [];
  const { x: sx, y: sy, z: sz } = s.voxels.size;
  for (let y = 0; y < sy; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const v = s.voxels.get(x, y, z);
        if (v) blocks.push({ x, y, z, material: s.palette[v - 1].material });
      }
  return { name: s.name, blocks };
}
