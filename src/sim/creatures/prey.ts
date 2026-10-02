import type { Cell } from '../navigation';
import { PREY_SENSES, notices, type Senses } from '../senses';
import type { Population } from './population';
import { defOf } from './species';
import type { Behaviour, Creature } from './types';

/** How far rabbits look for a safe place to run to. */
const FLEE_RADIUS = 24;
/** Rabbits stay hidden this long after they last noticed a predator. */
const HIDE_SECONDS = 8;
/** Rabbits keep grazing while a predator they notice is farther than this, unless it is hunting. */
const WARY_DISTANCE = 7;
/** Asleep, rabbits only hear what comes close. */
const PREY_ASLEEP: Senses = { ...PREY_SENSES, sight: 0 };
/** Nodes a rabbit may search on its way home (home can be a fair way off, through a narrow gap). */
const HOME_NODES = 4000;
/** Predator activities that mean "coming for you", wherever the predator is. */
const HUNTING = new Set(['stalk', 'pounce', 'raid', 'breach', 'bite']);

/** An area a rabbit treats as home (inclusive world cells): it runs back to it, and never out of it. */
export interface HomeArea {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const atHome = (h: HomeArea, x: number, z: number): boolean => x >= h.x0 && x <= h.x1 && z >= h.z0 && z <= h.z1;

/**
 * A rabbit going about its life: graze, drink, sleep (somewhere safe if possible), raise young,
 * and run for safety when a predator comes close or starts hunting.
 */
export const PREY: Behaviour = {
  needs: true,
  decide: (pop, c, env) => decidePrey(pop, c, env.night),
  interval: (pop) => 0.3 + pop.rng.next() * 0.3,
};

/**
 * One decision for a rabbit. `breedBoost` scales its chance to breed (a game mode may favour
 * breeders), `mayBreed` lets a mode keep some rabbits from breeding, and with a `home` the rabbit
 * runs home from danger and stays inside it while threatened.
 */
export function decidePrey(pop: Population, c: Creature, night: boolean, opts: { breedBoost?: number; mayBreed?: boolean; home?: HomeArea | null } = {}): void {
  const home = opts.home ?? null;
  // Arrivals turn into the activity they were heading for.
  if (c.step >= c.path.length && c.path.length > 0) {
    const arrived = c.activity;
    c.path = [];
    c.step = 0;
    if (arrived === 'flee') {
      c.activity = 'hide';
      c.wait = HIDE_SECONDS;
    } else if (arrived === 'seekWater' && pop.atShore(c)) return void (c.activity = 'drink');
    else if (arrived === 'seekFood' && pop.foodHere(c) >= 30) return void (c.activity = 'graze');
    else if (arrived === 'seekShelter') return void (c.activity = 'rest');
  }
  const thirsty = c.hydration < 0.25;
  const starving = c.satiety < 0.25;
  const desperate = c.hydration < 0.12 || c.satiety < 0.12;

  // Danger comes first: hide where predators can't reach, or run.
  const threat = nearestThreat(pop, c);
  if (threat && !desperate) {
    c.target = threat.id;
    if (home && !atHome(home, Math.floor(c.x), Math.floor(c.z))) return runHome(pop, c, threat, home);
    // Safe cells keep out predators 2 blocks tall; a smaller one (a fox) can follow, so run from it.
    const followable = defOf(threat).body.height < 2;
    if (followable) return runFrom(pop, c, threat, home);
    if (pop.safeHere(c)) {
      if (c.activity !== 'rest') {
        c.activity = 'hide';
        c.path = [];
      }
      c.wait = Math.max(c.wait, HIDE_SECONDS);
      return;
    }
    if (c.activity === 'flee' && c.path.length > c.step) {
      const goal = c.path[c.path.length - 1];
      // Keep running while the destination is safe or still takes us away from the threat.
      if (pop.safety.isSafe(goal.x, goal.y, goal.z) || farther(goal, c, threat)) return;
    }
    return flee(pop, c, threat, home);
  }
  if (c.activity === 'hide' && c.wait > 0 && !thirsty && !starving) return;

  // Keep doing a useful thing rather than dithering, unless something else became urgent.
  const moving = c.path.length > c.step;
  if (c.activity === 'drink' && c.hydration < 0.99 && pop.atShore(c)) return;
  if (c.activity === 'graze' && c.satiety < 0.97 && pop.foodHere(c) >= 15 && !thirsty) return;
  if (moving && c.activity === 'seekWater') return;
  if (moving && c.activity === 'seekFood' && !thirsty) return;
  if (moving && c.activity === 'seekShelter' && !thirsty && !starving) return;

  if (thirsty) return pop.goDrink(c);
  if (starving) return pop.goEat(c);
  if (c.hydration < 0.45) return pop.goDrink(c);
  if (c.satiety < 0.55) return pop.goEat(c);
  if (night || c.energy < 0.25) {
    if (c.activity === 'rest' && (night || c.energy < 0.9)) return;
    return pop.goRest(c);
  }
  const mayBreed = opts.mayBreed ?? true;
  if (mayBreed && pop.canBreed(c) && pop.rng.chance(pop.breedChance(c.species, opts.breedBoost)) && pop.mateNear(c, (o) => o.role !== 'defender')) pop.breed(c);
  if (c.satiety < 0.85 && pop.foodHere(c) >= 60) return void (c.activity = 'graze');
  if (c.hydration < 0.75) {
    const s = pop.shores.nearest(c.x, c.z, 12);
    if (s) return pop.goDrink(c);
  }
  if (home && !atHome(home, Math.floor(c.x), Math.floor(c.z))) goHome(pop, c, home);
  else if (pop.rng.chance(0.3)) pop.wander(c, 8);
  else {
    c.activity = 'idle';
    c.path = [];
  }
}

/**
 * The closest predator this rabbit notices and is worried by: one that is close, or one that is
 * hunting. Asleep, it only hears the ones close by.
 */
export function nearestThreat(pop: Population, c: Creature): Creature | null {
  const senses = c.activity === 'rest' ? PREY_ASLEEP : PREY_SENSES;
  let best: Creature | null = null;
  let bestD = Infinity;
  for (const p of pop.creatures) {
    if (p.species !== 'predator' || p.deadFor >= 0) continue;
    const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2;
    if (d >= bestD || d > senses.sight * senses.sight + senses.hearing * senses.hearing) continue;
    if (d > WARY_DISTANCE * WARY_DISTANCE && !HUNTING.has(p.activity)) continue;
    const stealth = defOf(p).abilities.stealth ?? 0;
    const sees = stealth > 0 ? { ...senses, sight: senses.sight * (1 - stealth) } : senses;
    if (notices(pop.nav.solids, c, sees, p.x, p.y, p.z, 1)) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Is `goal` farther from the threat than the creature is now? */
function farther(goal: Cell, c: Creature, threat: Creature): boolean {
  return (goal.x + 0.5 - threat.x) ** 2 + (goal.z + 0.5 - threat.z) ** 2 > (c.x - threat.x) ** 2 + (c.z - threat.z) ** 2;
}

/** Runs for the nearest safe place (at home, if it has one), or failing that away from the threat. */
export function flee(pop: Population, c: Creature, threat: Creature, home: HomeArea | null = null): void {
  const cx = Math.floor(c.x);
  const cz = Math.floor(c.z);
  const safe = pop.safety.nearestSafe(cx, c.y, cz, FLEE_RADIUS);
  if (safe && (!home || atHome(home, safe.x, safe.z)) && pop.route(c, safe, true)) {
    c.activity = 'flee';
    return;
  }
  runFrom(pop, c, threat, home);
}

/** Runs straight away from the threat (turning aside when the way is blocked), staying at home if it has one. */
function runFrom(pop: Population, c: Creature, threat: Creature, home: HomeArea | null = null): void {
  if (c.activity === 'flee' && c.path.length > c.step && farther(c.path[c.path.length - 1], c, threat)) return;
  const body = defOf(c).body;
  const away = Math.atan2(c.x - threat.x, c.z - threat.z);
  for (const turn of home ? [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9] : [0, 0.6, -0.6, 1.2, -1.2]) {
    const a = away + turn;
    let x = Math.round(c.x + Math.sin(a) * 10);
    let z = Math.round(c.z + Math.cos(a) * 10);
    if (home) {
      // Run to the far side of home rather than out of it.
      x = Math.max(home.x0 + 1, Math.min(home.x1 - 1, x));
      z = Math.max(home.z0 + 1, Math.min(home.z1 - 1, z));
      if (!farther({ x, y: c.y, z }, c, threat)) continue;
    }
    if (!pop.nav.inBounds(x, z)) continue;
    const y = pop.nav.surfaceBelow(x, c.y + 1, z, body);
    if (y !== null && pop.route(c, { x, y, z }, true)) {
      c.activity = 'flee';
      return;
    }
  }
  c.activity = 'hide';
  c.path = [];
  c.wait = 2;
}

/** Runs back home from a threat, or keeps running if it already is. */
function runHome(pop: Population, c: Creature, threat: Creature, home: HomeArea): void {
  if (c.activity === 'flee' && c.path.length > c.step) {
    const goal = c.path[c.path.length - 1];
    if (atHome(home, goal.x, goal.z)) return;
  }
  if (routeHome(pop, c, home, true)) return void (c.activity = 'flee');
  runFrom(pop, c, threat);
}

/** Walks back home when there is nothing better to do. */
function goHome(pop: Population, c: Creature, home: HomeArea): void {
  if (routeHome(pop, c, home, false)) c.activity = 'wander';
  else pop.wander(c, 8);
}

/** Plans a way to somewhere inside home, trying the middle first, then a few cells around it. */
function routeHome(pop: Population, c: Creature, home: HomeArea, urgent: boolean): boolean {
  const body = defOf(c).body;
  const mx = Math.floor((home.x0 + home.x1) / 2);
  const mz = Math.floor((home.z0 + home.z1) / 2);
  for (let attempt = 0; attempt < 3; attempt++) {
    const x = attempt === 0 ? mx : Math.round(pop.rng.range(home.x0 + 1, home.x1 - 1));
    const z = attempt === 0 ? mz : Math.round(pop.rng.range(home.z0 + 1, home.z1 - 1));
    const y = pop.nav.surfaceBelow(x, 1, z, body);
    if (y !== null && pop.route(c, { x, y, z }, urgent, HOME_NODES)) return true;
  }
  return false;
}
