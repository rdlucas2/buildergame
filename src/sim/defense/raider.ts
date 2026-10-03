import { defOf, type Behaviour, type Creature, type Population } from '../creatures';
import type { DefenseContext } from './context';
import { toughness } from './waves';

/** How close a predator must be to bite. */
const BITE_REACH = 1.1;
/** Farther than this from its prey, a predator walks straight towards it over open ground. */
const APPROACH = 22;
/** Closer than this to its prey, a predator plans its own way to it rather than follow the field. */
const CHASE = 3;
/** Nodes a predator may explore when chasing prey close by. */
const CHASE_NODES = 200;
/** Steps taken down the breach field before looking again. */
const FIELD_STEPS = 10;
/** Seconds a planned route is kept before it is planned again. */
const REPLAN = 2;
/** Pouncers (tigers) sprint at their prey from this close. */
const POUNCE_RANGE = 6;
/** A predator starts breaking a block from this close. */
const CHEW_REACH = 1.3;

/**
 * A predator of a defense wave: it heads for the nearest breeder, finds its way into the warren
 * (squeezing through gaps if it is small enough, otherwise breaking through the weakest wall), and
 * bites; any rabbit that comes within reach gets bitten too. Once no breeders are left it goes for
 * the warren's core and gnaws at it. It has no needs and never breeds.
 */
export function makeRaider(ctx: DefenseContext): Behaviour {
  return {
    needs: false,
    decide: (pop, c) => decideRaider(ctx, pop, c),
    interval: (pop) => 0.35 + pop.rng.next() * 0.2,
    act: (pop, c, dt) => actRaider(ctx, pop, c, dt),
  };
}

function decideRaider(ctx: DefenseContext, pop: Population, c: Creature): void {
  // A rabbit right there gets bitten, defender or not.
  const near = pop.nearest(c, 'prey', BITE_REACH, (o) => Math.abs(o.y - c.y) <= 1);
  if (near) {
    c.target = near.id;
    c.activity = 'bite';
    c.path = [];
    return;
  }
  // Breeders first: they are the warren's future.
  const prey = pop.nearest(c, 'prey', 2000, (o) => o.role !== 'defender');
  if (!prey) return decideCore(ctx, pop, c);
  c.target = prey.id;
  const d = Math.hypot(prey.x - c.x, prey.z - c.z);
  if (d <= BITE_REACH && Math.abs(prey.y - c.y) <= 1) {
    c.activity = 'bite';
    c.path = [];
    return;
  }
  const planning = c.activity === 'raid' || c.activity === 'breach' || c.activity === 'pounce';
  if (planning && c.path.length > c.step && c.wait > 0) return;
  if (d > APPROACH) {
    // Close the distance across open ground first; plan the way in once near.
    const k = (d - APPROACH * 0.6) / d;
    headFor(pop, c, c.x + (prey.x - c.x) * k, c.z + (prey.z - c.z) * k);
    c.activity = 'raid';
    c.wait = REPLAN;
    return;
  }
  const preyCell = { x: Math.floor(prey.x), y: prey.y, z: Math.floor(prey.z) };
  if (d <= CHASE && pop.route(c, preyCell, false, CHASE_NODES, ctx.breachCost(c))) {
    c.activity = 'raid';
    c.wait = REPLAN;
    return;
  }
  // Head down the breach field: to the nearest rabbit, through the weakest wall if need be.
  const steps = ctx.fieldPath(c, FIELD_STEPS);
  if (steps.length > 0) {
    c.path = steps;
    c.step = 0;
    c.activity = 'raid';
    c.wait = REPLAN;
    return;
  }
  // Off the field, or no way in at all: drift closer and try again soon.
  if (c.path.length <= c.step) headFor(pop, c, prey.x, prey.z);
  c.activity = 'raid';
  c.wait = 0.5;
}

function actRaider(ctx: DefenseContext, pop: Population, c: Creature, dt: number): boolean {
  const def = defOf(c);
  // At the core with no breeders left: gnaw it.
  if (c.target === -1 && c.activity !== 'bite') {
    const b = ctx.coreNear(c);
    if (b) {
      c.activity = 'breach';
      c.path = [];
      c.heading = Math.atan2(b.x + 0.5 - c.x, b.z + 0.5 - c.z);
      ctx.chew(c, b.x, b.y, b.z, def.blockDamage * toughness(c) * dt);
      return true;
    }
  }
  if (c.activity === 'bite') {
    const prey = pop.get(c.target);
    if (!prey || prey.deadFor >= 0 || Math.abs(prey.y - c.y) > 1 || Math.hypot(prey.x - c.x, prey.z - c.z) > BITE_REACH + 0.3) {
      c.activity = 'raid';
      c.think = 0;
      return true;
    }
    c.heading = Math.atan2(prey.x - c.x, prey.z - c.z);
    if (c.cooldown <= 0) {
      pop.damage(prey, def.bite * toughness(c) * ctx.biteMult(prey), { cause: 'eaten', killer: c });
      c.cooldown = def.biteCooldown;
    }
    return true;
  }
  const next = c.path[c.step];
  if (next?.breach && Math.hypot(next.x + 0.5 - c.x, next.z + 0.5 - c.z) <= CHEW_REACH) {
    for (let i = 0; i < def.body.height; i++) {
      if (!pop.nav.solids.solid(next.x, next.y + i, next.z)) continue;
      c.activity = 'breach';
      c.heading = Math.atan2(next.x + 0.5 - c.x, next.z + 0.5 - c.z);
      // Tougher (later) predators break blocks faster too, like they bite harder.
      ctx.chew(c, next.x, next.y + i, next.z, def.blockDamage * toughness(c) * dt);
      return true;
    }
    if (c.activity === 'breach') c.activity = 'raid';
  }
  // Snap at prey that wanders into reach; pouncers sprint the last few cells to it.
  const prey = pop.get(c.target);
  const close = prey && prey.deadFor < 0 && Math.hypot(prey.x - c.x, prey.z - c.z) <= POUNCE_RANGE;
  const pounce = close ? (def.abilities.pounce ?? 1) : 1;
  if (pounce > 1 && c.activity === 'raid') c.activity = 'pounce';
  if (c.path.length > c.step) pop.follow(c, dt, pounce);
  if (prey && prey.deadFor < 0 && Math.abs(prey.y - c.y) <= 1 && Math.hypot(prey.x - c.x, prey.z - c.z) <= BITE_REACH) {
    c.activity = 'bite';
    c.path = [];
  }
  return true;
}

/** With no breeders left: make for the core, through the walls, and gnaw at it. */
function decideCore(ctx: DefenseContext, pop: Population, c: Creature): void {
  c.target = -1;
  // Already at it: keep gnawing (no planning needed).
  if (ctx.coreNear(c)) {
    c.activity = 'breach';
    c.path = [];
    return;
  }
  const core = ctx.coreSpot();
  const planning = c.activity === 'raid' || c.activity === 'breach';
  if (planning && c.path.length > c.step && c.wait > 0) return;
  c.activity = 'raid';
  if (!core) {
    if (c.path.length <= c.step) headFor(pop, c, ctx.site.x, ctx.site.z);
    return;
  }
  const d = Math.hypot(core.x - c.x, core.z - c.z);
  if (d > APPROACH) {
    const k = (d - APPROACH * 0.6) / d;
    headFor(pop, c, c.x + (core.x - c.x) * k, c.z + (core.z - c.z) * k);
    c.wait = REPLAN;
    return;
  }
  const steps = ctx.fieldPath(c, FIELD_STEPS);
  if (steps.length > 0) {
    c.path = steps;
    c.step = 0;
    c.wait = REPLAN;
    return;
  }
  // Off the field (or crowded out of the cells beside the core): edge closer, and try again soon.
  if (c.path.length <= c.step && d > 3) headFor(pop, c, core.x, core.z);
  else if (c.path.length <= c.step) pop.wander(c, 2);
  c.wait = 1;
}

/** Plans a walk to a ground cell near (x, z). */
function headFor(pop: Population, c: Creature, x: number, z: number): void {
  const tx = Math.round(x);
  const tz = Math.round(z);
  if (!pop.nav.inBounds(tx, tz)) return;
  const y = pop.nav.surfaceBelow(tx, 2, tz, defOf(c).body) ?? 0;
  if (!pop.route(c, { x: tx, y, z: tz })) pop.wander(c, 6);
}
