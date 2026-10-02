import type { Cell } from '../navigation';
import { notices } from '../senses';
import type { Population } from './population';
import { defOf } from './species';
import type { Behaviour, Creature } from './types';

/** Predators start a sprint from this close. */
const POUNCE_RANGE = 6;
const POUNCE_SECONDS = 3;
const POUNCE_SPEED = 2.2;
const STALK_SPEED = 0.55;
const CHASE_NODES = 300;
/** A predator catches prey within this distance (and at most a step up or down). */
const CATCH_DISTANCE = 1;
const MEAL = 0.65;
const MEAL_SECONDS = 6;
const HUNGRY = 0.75;
/** Predators smell prey this far away (no line of sight needed), which draws them towards the herd. */
const SMELL_RADIUS = 64;
/** Fed wolves drift back towards the pack when they are farther than this from the nearest one. */
const PACK_RADIUS = 10;

/**
 * A wild wolf: tracks rabbits by scent, lies in wait by the water, stalks what it sees and pounces.
 * When fed it drinks, sleeps through the midday sun, stays near its pack and raises young.
 */
export const WOLF: Behaviour = {
  needs: true,
  decide: (pop, c, env) => decideWolf(pop, c, env.light),
  interval: (pop, c) => (c.activity === 'pounce' ? 0.25 : 0.4 + pop.rng.next() * 0.3),
  act: (pop, c, dt) => {
    if (c.activity === 'pounce') {
      c.stamina = Math.max(0, c.stamina - dt / POUNCE_SECONDS);
      if (c.path.length > c.step) pop.follow(c, dt, POUNCE_SPEED);
      tryCatch(pop, c);
      if (c.activity === 'pounce' && (c.stamina <= 0 || c.wait <= 0)) {
        c.activity = 'idle';
        c.path = [];
      }
      return true;
    }
    if (c.activity === 'stalk') {
      if (c.path.length > c.step) pop.follow(c, dt, STALK_SPEED);
      tryCatch(pop, c);
      return true;
    }
    return false;
  },
};

function decideWolf(pop: Population, c: Creature, light: number): void {
  if (c.step >= c.path.length && c.path.length > 0) {
    const arrived = c.activity;
    c.path = [];
    c.step = 0;
    if (arrived === 'seekWater' && pop.atShore(c)) return void (c.activity = 'drink');
    if (arrived === 'ambush') faceWater(pop, c);
  }
  if (c.activity === 'eat' && c.wait > 0) return;
  if (c.activity === 'drink' && c.hydration < 0.99 && pop.atShore(c)) return;

  const hungry = c.satiety < HUNGRY;
  if (c.hydration < 0.3) {
    if (c.activity === 'seekWater' && c.path.length > c.step) return;
    return pop.goDrink(c);
  }
  if (hungry && c.energy > 0.08) {
    const current = c.activity === 'pounce' || c.activity === 'stalk' ? pop.get(c.target) : undefined;
    const prey = spotPrey(pop, c) ?? (current && current.deadFor < 0 && c.activity === 'pounce' && c.wait > 0 ? current : null);
    if (prey) {
      const d = Math.hypot(prey.x - c.x, prey.z - c.z);
      if (c.activity === 'pounce' && c.wait > 0 && c.stamina > 0) return chase(pop, c, prey);
      if (d <= POUNCE_RANGE && c.stamina > 0.35) {
        c.activity = 'pounce';
        c.wait = POUNCE_SECONDS;
        return chase(pop, c, prey);
      }
      return stalk(pop, c, prey);
    }
    if (c.activity === 'pounce' || c.activity === 'stalk') {
      c.activity = 'idle';
      c.path = [];
    }
    if (c.activity === 'ambush' && (c.path.length > c.step || c.wait > 0)) return;
    if (c.activity === 'patrol' && c.path.length > c.step) return;
    if (c.hydration < 0.6) return pop.goDrink(c);
    // Follow the scent of the nearest prey: lie in wait by the water it drinks from, or prowl towards it.
    const scent = pop.nearest(c, 'prey', SMELL_RADIUS);
    if (scent && pop.rng.chance(0.5)) return goAmbush(pop, c, scent);
    return patrol(pop, c, scent);
  }

  // Fed: drink, sleep through the brightest part of the day, raise young, roam a little.
  if (c.hydration < 0.6) {
    if (c.activity === 'seekWater' && c.path.length > c.step) return;
    return pop.goDrink(c);
  }
  if (c.energy < 0.3 || light > 0.85) {
    if (c.activity !== 'rest') {
      c.activity = 'rest';
      c.path = [];
    }
    return;
  }
  if (c.activity === 'rest' && c.energy < 0.9) return;
  if (pop.canBreed(c) && pop.rng.chance(pop.breedChance(c.species)) && pop.mateNear(c)) pop.breed(c);
  if (c.activity === 'wander' && c.path.length > c.step) return;
  const mate = pop.nearest(c, 'predator', 80);
  if (mate && Math.hypot(mate.x - c.x, mate.z - c.z) > PACK_RADIUS && pop.goNear(c, mate, 4)) return;
  if (pop.rng.chance(0.3)) pop.wander(c, 14);
  else {
    c.activity = 'idle';
    c.path = [];
  }
}

/** The nearest prey this predator can see (or hear) that isn't somewhere it can't be caught. */
function spotPrey(pop: Population, c: Creature): Creature | null {
  const senses = defOf(c).senses;
  const reach = senses.sight * senses.sight;
  let best: Creature | null = null;
  let bestD = Infinity;
  for (const p of pop.creatures) {
    if (p.species !== 'prey' || p.deadFor >= 0) continue;
    const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2;
    if (d >= bestD || d > reach) continue;
    if (pop.safety.isSafe(Math.floor(p.x), p.y, Math.floor(p.z))) continue;
    if (notices(pop.nav.solids, c, senses, p.x, p.y, p.z, 0.4)) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Creeps towards prey, slowly, to get within pouncing range unnoticed. */
function stalk(pop: Population, c: Creature, prey: Creature): void {
  c.target = prey.id;
  if (pop.route(c, { x: Math.floor(prey.x), y: prey.y, z: Math.floor(prey.z) }, false, CHASE_NODES)) c.activity = 'stalk';
  else {
    c.activity = 'idle';
    c.path = [];
  }
}

/** Sprints for the prey's current position (re-planned several times a second). */
function chase(pop: Population, c: Creature, prey: Creature): void {
  c.target = prey.id;
  if (!pop.route(c, { x: Math.floor(prey.x), y: prey.y, z: Math.floor(prey.z) }, true, CHASE_NODES)) {
    // It got somewhere we can't follow.
    c.activity = 'idle';
    c.path = [];
    c.wait = 0;
  }
}

/** Picks a spot near the water prey drink from, preferably with cover beside it, and waits there. */
function goAmbush(pop: Population, c: Creature, scent: Creature): void {
  const body = defOf(c).body;
  const shore = pop.shores.nearest(scent.x, scent.z, 40);
  if (!shore) return patrol(pop, c, scent);
  let best: Cell | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 10; i++) {
    const a = pop.rng.range(0, Math.PI * 2);
    const r = pop.rng.range(3, 9);
    const x = Math.round(shore.x + Math.cos(a) * r);
    const z = Math.round(shore.z + Math.sin(a) * r);
    if (!pop.nav.inBounds(x, z) || pop.nav.isWater(x, z) || !pop.nav.standable(x, 0, z, body)) continue;
    const score = cover(pop, x, z) * 2 + pop.veg.biomassAt(x, z) / 255 - Math.hypot(x - c.x, z - c.z) * 0.02 + pop.rng.next() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y: 0, z };
    }
  }
  if (best && pop.route(c, best)) {
    c.activity = 'ambush';
    c.wait = pop.rng.range(30, 70);
    return;
  }
  patrol(pop, c, scent);
}

/** Prowls towards the scent of prey, or roams widely when there is none. */
function patrol(pop: Population, c: Creature, scent: Creature | null): void {
  if (scent && pop.goNear(c, scent, 10)) {
    c.activity = 'patrol';
    return;
  }
  pop.wander(c, 28);
  if (c.activity === 'wander') c.activity = 'patrol';
}

/** Solid blocks around a ground cell, up to predator height: somewhere to lurk behind. */
function cover(pop: Population, x: number, z: number): number {
  let n = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (let y = 0; y < 2; y++) if ((dx || dz) && pop.nav.solids.solid(x + dx, y, z + dz)) n++;
  return n;
}

function faceWater(pop: Population, c: Creature): void {
  const s = pop.shores.nearest(c.x, c.z, 20);
  if (s) c.heading = Math.atan2(s.x + 0.5 - c.x, s.z + 0.5 - c.z);
}

/** A catch: prey within reach dies and feeds the predator. */
function tryCatch(pop: Population, c: Creature): void {
  const prey = pop.get(c.target);
  if (!prey || prey.deadFor >= 0) return;
  if (Math.abs(prey.y - c.y) > 1 || Math.hypot(prey.x - c.x, prey.z - c.z) > CATCH_DISTANCE) return;
  pop.die(prey, { cause: 'eaten', killer: c });
  c.satiety = Math.min(1, c.satiety + MEAL);
  c.heading = Math.atan2(prey.x - c.x, prey.z - c.z);
  c.activity = 'eat';
  c.wait = MEAL_SECONDS;
  c.path = [];
  c.target = -1;
}
