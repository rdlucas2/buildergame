import { raycastVoxels } from '../../core/raycast';
import { TICK_SECONDS } from '../clock';
import { defOf, rayBox, type Creature, type Population } from '../creatures';
import { lineOfSight } from '../senses';
import type { SolidMap } from '../solids';
import type { WeaponDef } from './weapons';

/** A shot in flight. Positions in world units; `dir` is a unit vector. */
export interface Projectile {
  id: number;
  x: number;
  y: number;
  z: number;
  dir: { x: number; y: number; z: number };
  speed: number;
  /** Distance it may still travel. */
  left: number;
  damage: number;
  weapon: string;
  owner: number;
  /** Extra predators it can still pass through. */
  pierce: number;
  splash: number;
  /** Predators it already hit (a piercing shot hits each one once). */
  hit: number[];
  /** Position at the previous tick, for smooth rendering. */
  px: number;
  py: number;
  pz: number;
}

/** Height of a rabbit's eyes above the cell it stands in (where its shots start). */
export const EYE = 0.6;

/**
 * Projectiles fired by defenders: they fly in straight lines, stop at blocks, and damage the first
 * predator in their way (more with pierce, and around the impact with splash).
 */
export class Combat {
  projectiles: Projectile[] = [];
  private nextId = 1;
  /** Shots fired, for statistics. */
  fired = 0;

  constructor(
    private readonly pop: Population,
    private readonly solids: SolidMap,
  ) {}

  /**
   * Fires at `target`, leading it by its current velocity. `damageMult` scales the damage. Returns
   * false (and fires nothing) when a block is in the way of the shot.
   */
  fire(owner: Creature, target: Creature, weapon: WeaponDef, damageMult = 1, angleOffset = 0): boolean {
    const ox = owner.x;
    const oy = owner.y + EYE;
    const oz = owner.z;
    const [, h] = defOf(target).box;
    let tx = target.x;
    const ty = target.y + h * 0.5;
    let tz = target.z;
    if (!weapon.hitscan) {
      const vx = (target.x - target.px) / TICK_SECONDS;
      const vz = (target.z - target.pz) / TICK_SECONDS;
      const t = Math.hypot(tx - ox, ty - oy, tz - oz) / weapon.speed;
      tx += vx * t;
      tz += vz * t;
    }
    if (!angleOffset && !lineOfSight(this.solids, ox, oy, oz, tx, ty, tz)) return false;
    let dx = tx - ox;
    const dy = ty - oy;
    let dz = tz - oz;
    if (angleOffset) {
      const c = Math.cos(angleOffset);
      const s = Math.sin(angleOffset);
      [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
    }
    const len = Math.hypot(dx, dy, dz) || 1;
    const p: Projectile = {
      id: this.nextId++,
      x: ox,
      y: oy,
      z: oz,
      px: ox,
      py: oy,
      pz: oz,
      dir: { x: dx / len, y: dy / len, z: dz / len },
      speed: weapon.speed,
      left: weapon.range * 1.25,
      damage: weapon.damage * damageMult,
      weapon: weapon.id,
      owner: owner.id,
      pierce: weapon.pierce ?? 0,
      splash: weapon.splash ?? 0,
      hit: [],
    };
    this.fired++;
    if (weapon.hitscan) {
      this.travel(p, p.left);
      return true;
    }
    this.projectiles.push(p);
    return true;
  }

  tick(): void {
    if (this.projectiles.length === 0) return;
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      const step = Math.min(p.left, p.speed * TICK_SECONDS);
      if (this.travel(p, step) && p.left > 0) keep.push(p);
    }
    this.projectiles = keep;
  }

  /** Moves a shot `dist` along its path, resolving hits. Returns false when it is spent. */
  private travel(p: Projectile, dist: number): boolean {
    const wall = raycastVoxels({ origin: { x: p.x, y: p.y, z: p.z }, direction: p.dir }, dist, (x, y, z) => y >= 0 && this.solids.solid(x, y, z));
    const reach = wall ? wall.distance : dist;
    // Every predator along the segment, nearest first.
    const hits: Array<{ c: Creature; t: number }> = [];
    for (const c of this.pop.creatures) {
      if (c.species !== 'predator' || c.deadFor >= 0 || p.hit.includes(c.id)) continue;
      const [r, h] = defOf(c).box;
      const t = rayBox(p, p.dir, c.x - r, c.y, c.z - r, c.x + r, c.y + h, c.z + r);
      if (t !== null && t <= reach) hits.push({ c, t });
    }
    hits.sort((a, b) => a.t - b.t || a.c.id - b.c.id);
    const owner = this.pop.get(p.owner);
    for (const { c, t } of hits) {
      this.strike(p, c, owner, t);
      if (p.pierce <= 0) {
        p.left = 0;
        return false;
      }
      p.pierce--;
    }
    p.x += p.dir.x * reach;
    p.y += p.dir.y * reach;
    p.z += p.dir.z * reach;
    p.left -= reach;
    if (wall) {
      if (p.splash > 0) this.burst(p, owner, p.x, p.y, p.z, null);
      p.left = 0;
      return false;
    }
    return true;
  }

  private strike(p: Projectile, c: Creature, owner: Creature | undefined, t: number): void {
    p.hit.push(c.id);
    this.pop.damage(c, p.damage, { cause: 'slain', killer: owner, weapon: p.weapon });
    if (p.splash > 0) this.burst(p, owner, p.x + p.dir.x * t, p.y + p.dir.y * t, p.z + p.dir.z * t, c);
  }

  /** Splash damage: full damage at the centre falling to half at the edge, to every predator in reach. */
  private burst(p: Projectile, owner: Creature | undefined, x: number, y: number, z: number, skip: Creature | null): void {
    for (const c of this.pop.creatures) {
      if (c === skip || c.species !== 'predator' || c.deadFor >= 0) continue;
      const d = Math.hypot(c.x - x, c.y + 0.5 - y, c.z - z);
      if (d > p.splash) continue;
      this.pop.damage(c, p.damage * (1 - 0.5 * (d / p.splash)), { cause: 'slain', killer: owner, weapon: p.weapon });
    }
  }
}
