import { defOf, type Behaviour, type Creature, type Population } from '../creatures';
import type { DefenseContext } from './context';

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
/** A predator starts breaking a block from this close. */
const CHEW_REACH = 1.3;

/**
 * A predator of a defense wave: it heads for the nearest rabbit, finds its way into the warren
 * (squeezing through gaps if it is small enough, otherwise breaking through the weakest wall), and
 * bites. It has no needs and never breeds.
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
  const prey = pop.nearest(c, 'prey', 2000);
  if (!prey) {
    if (c.path.length <= c.step) headFor(pop, c, ctx.site.x, ctx.site.z);
    c.activity = 'raid';
    return;
  }
  c.target = prey.id;
  const d = Math.hypot(prey.x - c.x, prey.z - c.z);
  if (d <= BITE_REACH && Math.abs(prey.y - c.y) <= 1) {
    c.activity = 'bite';
    c.path = [];
    return;
  }
  const planning = c.activity === 'raid' || c.activity === 'breach';
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
  if (c.path.length > c.step) pop.follow(c, dt, 1);
  // Snap at prey that wanders into reach.
  const prey = pop.get(c.target);
  if (prey && prey.deadFor < 0 && Math.abs(prey.y - c.y) <= 1 && Math.hypot(prey.x - c.x, prey.z - c.z) <= BITE_REACH) {
    c.activity = 'bite';
    c.path = [];
  }
  return true;
}

/** Tougher (later) predators bite and break blocks harder, though less than their extra hit points. */
function toughness(c: Creature): number {
  const def = defOf(c);
  return Math.sqrt((c.maxHp ?? def.maxHp) / def.maxHp);
}

/** Plans a walk to a ground cell near (x, z). */
function headFor(pop: Population, c: Creature, x: number, z: number): void {
  const tx = Math.round(x);
  const tz = Math.round(z);
  if (!pop.nav.inBounds(tx, tz)) return;
  const y = pop.nav.surfaceBelow(tx, 2, tz, defOf(c).body) ?? 0;
  if (!pop.route(c, { x: tx, y, z: tz })) pop.wander(c, 6);
}
