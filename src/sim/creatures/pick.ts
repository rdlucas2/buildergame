import { defOf } from './species';
import type { Activity, Creature } from './types';

/**
 * The living creature nearest along a ray (origin, unit direction) within `maxDistance`, or null.
 * Each creature is treated as an upright box around its position.
 */
export function pickCreature(
  creatures: readonly Creature[],
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDistance: number,
  accept?: (c: Creature) => boolean,
): { creature: Creature; distance: number } | null {
  let best: Creature | null = null;
  let bestT = maxDistance;
  for (const c of creatures) {
    if (c.deadFor >= 0 || (accept && !accept(c))) continue;
    const [r, h] = defOf(c).box;
    const t = rayBox(origin, dir, c.x - r, c.y, c.z - r, c.x + r, c.y + h, c.z + r);
    if (t !== null && t < bestT) {
      bestT = t;
      best = c;
    }
  }
  return best ? { creature: best, distance: bestT } : null;
}

/** Distance along a ray (unit direction) to where it enters a box, or null when it misses. */
export function rayBox(
  o: { x: number; y: number; z: number },
  d: { x: number; y: number; z: number },
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): number | null {
  let tmin = 0;
  let tmax = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [o.x, d.x, x0, x1],
    [o.y, d.y, y0, y1],
    [o.z, d.z, z0, z1],
  ];
  for (const [p, v, lo, hi] of axes) {
    if (Math.abs(v) < 1e-9) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let a = (lo - p) / v;
    let b = (hi - p) / v;
    if (a > b) [a, b] = [b, a];
    tmin = Math.max(tmin, a);
    tmax = Math.min(tmax, b);
    if (tmin > tmax) return null;
  }
  return tmin;
}

const ACTIVITY_LABEL: Record<Activity, string> = {
  idle: 'Resting a moment',
  wander: 'Wandering',
  seekFood: 'Looking for food',
  graze: 'Grazing',
  seekWater: 'Looking for water',
  drink: 'Drinking',
  seekShelter: 'Heading for shelter',
  rest: 'Sleeping',
  flee: 'Running for its life',
  hide: 'Hiding',
  patrol: 'On the prowl',
  ambush: 'Lying in wait',
  stalk: 'Stalking',
  pounce: 'Pouncing',
  eat: 'Eating',
  post: 'Heading to its post',
  guard: 'On guard',
  raid: 'Closing in',
  breach: 'Breaking through',
  bite: 'Attacking',
};

/** A short human description of what a creature is doing. */
export function describeActivity(c: Creature): string {
  if (c.deadFor >= 0) {
    switch (c.cause) {
      case 'eaten':
        return 'Caught';
      case 'slain':
        return 'Driven off';
      case 'age':
        return 'Died of old age';
      case 'thirst':
        return 'Died of thirst';
      default:
        return 'Starved';
    }
  }
  return ACTIVITY_LABEL[c.activity];
}
