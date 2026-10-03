/** Weapon families: perks that boost a family boost every weapon in it. */
export type WeaponClass = 'sling' | 'bow' | 'firearm' | 'heavy' | 'energy';

export const WEAPON_CLASSES: readonly WeaponClass[] = ['sling', 'bow', 'firearm', 'heavy', 'energy'];

export const CLASS_NAMES: Readonly<Record<WeaponClass, string>> = {
  sling: 'Slings',
  bow: 'Bows',
  firearm: 'Firearms',
  heavy: 'Cannons',
  energy: 'Energy weapons',
};

/** A defender's weapon. Projectile weapons fly at `speed`; hitscan ones strike instantly. */
export interface WeaponDef {
  id: string;
  name: string;
  class: WeaponClass;
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
  /** Colour and size of the shot as drawn. */
  color: string;
  size: number;
}

/**
 * Every weapon, weakest first. Each step is worth roughly half as much again in damage per second,
 * and the later ones add reach, piercing, spread or splash.
 */
export const WEAPON_LIST: readonly WeaponDef[] = [
  { id: 'slingshot', name: 'Slingshot', class: 'sling', damage: 5, range: 14, cooldown: 1.0, speed: 20, color: '#b9b4aa', size: 0.14 },
  { id: 'bow', name: 'Bow', class: 'bow', damage: 9, range: 18, cooldown: 1.2, speed: 28, color: '#c9a86a', size: 0.12 },
  { id: 'crossbow', name: 'Crossbow', class: 'bow', damage: 16, range: 20, cooldown: 1.4, speed: 34, pierce: 1, color: '#8a6a3a', size: 0.14 },
  { id: 'musket', name: 'Musket', class: 'firearm', damage: 30, range: 22, cooldown: 1.8, speed: 45, color: '#4a4a4a', size: 0.12 },
  { id: 'rifle', name: 'Rifle', class: 'firearm', damage: 30, range: 26, cooldown: 1.2, speed: 60, color: '#d8c060', size: 0.1 },
  { id: 'shotgun', name: 'Shotgun', class: 'firearm', damage: 9, range: 12, cooldown: 1.3, speed: 40, pellets: 6, spread: 0.3, color: '#e0d0a0', size: 0.08 },
  { id: 'cannon', name: 'Cannon', class: 'heavy', damage: 60, range: 24, cooldown: 2.6, speed: 22, splash: 2.5, color: '#2a2a2a', size: 0.3 },
  { id: 'laser', name: 'Laser', class: 'energy', damage: 14, range: 28, cooldown: 0.35, speed: 0, hitscan: true, color: '#ff3048', size: 0.06 },
  { id: 'plasma', name: 'Plasma Rifle', class: 'energy', damage: 45, range: 26, cooldown: 0.8, speed: 40, splash: 1.8, pierce: 2, color: '#40e0ff', size: 0.22 },
];

export const WEAPONS: Readonly<Record<string, WeaponDef>> = Object.fromEntries(WEAPON_LIST.map((w) => [w.id, w]));

export const DEFAULT_WEAPON = 'slingshot';

/** Damage per second of one defender with this weapon (before misses and modifiers). */
export function dps(w: WeaponDef): number {
  return (w.damage * (w.pellets ?? 1)) / w.cooldown;
}

/**
 * A rough worth for comparing weapons: damage per second, more for shots that pass through or burst
 * among several predators (waves come in crowds).
 */
export function weaponScore(w: WeaponDef): number {
  return dps(w) * (1 + 0.4 * (w.pierce ?? 0)) * (1 + 0.5 * (w.splash ?? 0));
}
