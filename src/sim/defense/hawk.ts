import { defOf, type Behaviour, type Creature, type Population } from '../creatures';
import type { DefenseContext } from './context';
import { toughness } from './waves';

/** Height (cells above the ground) hawks cruise at: over any wall. */
export const HAWK_ALTITUDE = 10;
/** Within this many cells of its prey (across the ground), a hawk dives. */
const DIVE_RANGE = 4;
/** Seconds per cell climbed or dived. */
const CLIMB_SECONDS = 0.15;
const DIVE_SECONDS = 0.1;
/** Seconds a hawk climbs away after a strike before it dives again. */
const RECOVER_SECONDS = 1.5;
/** How close a hawk must be to strike. */
const STRIKE_REACH = 0.9;
/** Radius of the circle hawks fly over the warren when no rabbit is in the open. */
const CIRCLE_RADIUS = 12;

/**
 * A hawk: flies straight over walls at height, picks the nearest rabbit out in the open, and dives
 * to strike. It can't reach a rabbit under a roof: with every rabbit covered, it circles and waits.
 * It ignores paths and the breach field, and never breaks blocks.
 */
export function makeHawk(ctx: DefenseContext): Behaviour {
  return {
    needs: false,
    decide: (pop, c) => decideHawk(pop, c),
    interval: (pop) => 0.25 + pop.rng.next() * 0.1,
    act: (pop, c, dt) => actHawk(ctx, pop, c, dt),
  };
}

/** Is this rabbit out in the open, where a hawk can get at it? */
function exposed(pop: Population, prey: Creature): boolean {
  return !pop.roofed(Math.floor(prey.x), prey.y, Math.floor(prey.z));
}

function decideHawk(pop: Population, c: Creature): void {
  let best: Creature | null = null;
  let bestD = Infinity;
  for (const p of pop.creatures) {
    if (p.species !== 'prey' || p.deadFor >= 0 || !exposed(pop, p)) continue;
    const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  c.target = best ? best.id : -1;
  if (c.activity !== 'bite') c.activity = best ? (Math.sqrt(bestD) < DIVE_RANGE ? 'pounce' : 'stalk') : 'raid';
  c.path = [];
}

function actHawk(ctx: DefenseContext, pop: Population, c: Creature, dt: number): boolean {
  const def = defOf(c);
  c.reload = Math.max(0, c.reload - dt);
  const prey = c.target >= 0 ? pop.get(c.target) : undefined;
  const live = prey && prey.deadFor < 0 && exposed(pop, prey) ? prey : null;
  // Where to fly: at the prey, or round the warren when there is none in the open.
  let tx: number;
  let tz: number;
  let ty = HAWK_ALTITUDE;
  if (live) {
    tx = live.x;
    tz = live.z;
    const across = Math.hypot(tx - c.x, tz - c.z);
    if (across < DIVE_RANGE && c.reload <= 0) ty = live.y;
  } else {
    const a = Math.atan2(c.x - ctx.site.x, c.z - ctx.site.z) + 0.6;
    tx = ctx.site.x + Math.sin(a) * CIRCLE_RADIUS;
    tz = ctx.site.z + Math.cos(a) * CIRCLE_RADIUS;
  }
  // Across: straight at it, never into a block.
  const dx = tx - c.x;
  const dz = tz - c.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 1e-6) {
    c.heading = Math.atan2(dx, dz);
    const step = Math.min(dist, def.speed * dt);
    const nx = c.x + (dx / dist) * step;
    const nz = c.z + (dz / dist) * step;
    if (!pop.nav.solids.solid(Math.floor(nx), c.y, Math.floor(nz))) {
      c.x = nx;
      c.z = nz;
    } else ty = Math.max(ty, c.y + 1); // a wall ahead: go over it
  }
  // Up and down, a cell at a time (the population counts `wait` down).
  if (c.wait <= 0 && ty !== c.y) {
    const up = ty > c.y;
    const next = c.y + (up ? 1 : -1);
    if (up || !pop.nav.solids.solid(Math.floor(c.x), next, Math.floor(c.z))) c.y = next;
    c.wait = up ? CLIMB_SECONDS : DIVE_SECONDS;
  }
  // Strike, then climb away to dive again.
  if (live && c.cooldown <= 0 && c.y === live.y && Math.hypot(live.x - c.x, live.z - c.z) <= STRIKE_REACH) {
    pop.damage(live, def.bite * toughness(c) * ctx.biteMult(live), { cause: 'eaten', killer: c });
    c.cooldown = def.biteCooldown;
    c.reload = RECOVER_SECONDS;
    c.activity = 'bite';
  } else if (c.activity === 'bite' && c.reload <= 0) c.activity = 'stalk';
  return true;
}
