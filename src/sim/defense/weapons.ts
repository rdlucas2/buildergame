/** A defender's weapon. Projectile weapons fly at `speed`; hitscan ones strike instantly. */
export interface WeaponDef {
  id: string;
  name: string;
  /** Damage per hit (per pellet for spread weapons). */
  damage: number;
  /** Reach in cells. */
  range: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Projectile speed in cells per second. */
  speed: number;
  /** Projectiles per shot, fanned out by `spread` radians. */
  pellets?: number;
  spread?: number;
  /** Radius of damage around the point of impact. */
  splash?: number;
  /** How many extra predators a projectile passes through. */
  pierce?: number;
  /** Hits instantly along the line of sight (beams). */
  hitscan?: boolean;
}

export const WEAPONS: Readonly<Record<string, WeaponDef>> = {
  slingshot: { id: 'slingshot', name: 'Slingshot', damage: 5, range: 14, cooldown: 1.0, speed: 20 },
};

export const DEFAULT_WEAPON = 'slingshot';

/** Damage per second of one defender with this weapon (before misses and modifiers). */
export function dps(w: WeaponDef): number {
  return (w.damage * (w.pellets ?? 1)) / w.cooldown;
}
