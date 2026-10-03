import { decidePrey, type Behaviour, type Creature, type Population } from '../creatures';
import type { DefenseContext } from './context';

/** Defenders leave their post to eat or drink only when this low, and only when no predator is near. */
const CRITICAL = 0.2;
const SAFE_TO_LEAVE = 16;
const FORAGING = new Set(['seekWater', 'drink', 'seekFood', 'graze']);

/**
 * A defender rabbit: walks to its post (a lookout on the warren wall, or a spot inside) and shoots
 * at predators in range and in sight. It does not breed, and during waves it gets hungry and
 * thirsty at half the usual rate; it slips away to eat and drink only when it must and it is safe.
 */
export function makeDefender(ctx: DefenseContext): Behaviour {
  return {
    needs: true,
    needsRate: () => (ctx.inWave() ? 0.5 : 1),
    decide: (pop, c, env) => {
      const critical = c.hydration < CRITICAL || c.satiety < CRITICAL;
      const foraging = FORAGING.has(c.activity) && (c.hydration < 0.8 || c.satiety < 0.8);
      if ((critical || foraging) && !threatNear(pop, c, SAFE_TO_LEAVE)) {
        decidePrey(pop, c, env.night, { mayBreed: false });
        return;
      }
      const post = ctx.postFor(c);
      if (post) {
        if (Math.floor(c.x) === post.x && Math.floor(c.z) === post.z && c.y === post.y) {
          c.activity = 'guard';
          c.path = [];
          return;
        }
        if (c.activity === 'post' && c.path.length > c.step) return;
        if (pop.route(c, post)) {
          c.activity = 'post';
          return;
        }
        ctx.postUnreachable(c);
      }
      if (c.activity === 'post' && c.path.length > c.step) return;
      c.activity = 'guard';
      c.path = [];
    },
    interval: (pop) => 0.4 + pop.rng.next() * 0.2,
    act: (pop, c, dt) => {
      c.reload = Math.max(0, c.reload - dt);
      if (c.reload <= 0 && c.activity !== 'drink' && c.activity !== 'graze') shoot(ctx, pop, c);
      if (c.activity === 'graze' || c.activity === 'drink') return false;
      if (c.path.length > c.step) pop.follow(c, dt, c.activity === 'flee' ? 1.5 : 1);
      return true;
    },
  };
}

function shoot(ctx: DefenseContext, pop: Population, c: Creature): void {
  const w = ctx.weaponFor(c);
  const target = ctx.findTarget(c, w, w.range);
  if (!target) return;
  c.heading = Math.atan2(target.x - c.x, target.z - c.z);
  const pellets = w.pellets ?? 1;
  const crit = ctx.critChance(c, w);
  const mult = crit > 0 && pop.rng.next() < crit ? 2 : 1;
  // The middle pellet goes straight at the target; if even that is blocked, hold fire.
  if (!ctx.combat.fire(c, target, w, mult)) return;
  for (let i = 1; i < pellets; i++) {
    const offset = (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * ((w.spread ?? 0) / Math.max(1, pellets - 1));
    ctx.combat.fire(c, target, w, mult, offset);
  }
  c.reload = w.cooldown;
}

/** Is a predator within `radius` cells? */
function threatNear(pop: Population, c: Creature, radius: number): boolean {
  const r2 = radius * radius;
  for (const o of pop.creatures) {
    if (o.species !== 'predator' || o.deadFor >= 0) continue;
    if ((o.x - c.x) ** 2 + (o.z - c.z) ** 2 <= r2) return true;
  }
  return false;
}
