import { NO_MODIFIERS, type DefenseModifiers } from '../../core/defense-state';
import type { PlayerProfile } from '../../core/profile';
import { WEAPON_LIST } from './weapons';

/**
 * The Warren Council: permanent upgrades bought with Clover between rounds. Each level makes every
 * later round a little easier; fully upgraded, a warren is about two and a half times as strong.
 */
export interface UpgradeDef {
  id: string;
  name: string;
  maxLevel: number;
  /** Clover for the first level; each further level costs `growth` times more. */
  cost: number;
  growth: number;
  /** What the upgrade does at `level` (0 when not bought). */
  effect: (level: number) => string;
  /** Adds this upgrade's effect at `level` to round modifiers. */
  apply: (m: DefenseModifiers, level: number) => void;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Damage and block hit points per level of their upgrades. */
export const DAMAGE_PER_LEVEL = 0.15;
export const WALLS_PER_LEVEL = 0.125;

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'damage',
    name: 'Weapon Drills',
    maxLevel: 15,
    cost: 15,
    growth: 1.25,
    effect: (l) => `Defenders do ${pct(DAMAGE_PER_LEVEL * l)} more damage`,
    apply: (m, l) => void (m.damage *= 1 + DAMAGE_PER_LEVEL * l),
  },
  {
    id: 'walls',
    name: 'Masonry Lore',
    maxLevel: 8,
    cost: 15,
    growth: 1.35,
    effect: (l) => `Warren blocks have ${pct(WALLS_PER_LEVEL * l)} more hit points`,
    apply: (m, l) => void (m.blockHp *= 1 + WALLS_PER_LEVEL * l),
  },
  {
    id: 'budget',
    name: 'Stockpile',
    maxLevel: 8,
    cost: 12,
    growth: 1.35,
    effect: (l) => `Rounds start with ${50 * l} more block budget`,
    apply: (m, l) => void (m.budget += 50 * l),
  },
  {
    id: 'rabbits',
    name: 'Founding Colony',
    maxLevel: 8,
    cost: 15,
    growth: 1.35,
    effect: (l) => `Rounds start with ${l} more rabbit${l === 1 ? '' : 's'}, and the warren holds ${l} more`,
    apply: (m, l) => void (m.rabbits += l),
  },
  {
    id: 'armour',
    name: 'Thick Coats',
    maxLevel: 8,
    cost: 12,
    growth: 1.35,
    effect: (l) => `Rabbits take ${pct(0.04 * l)} less damage from bites`,
    apply: (m, l) => void (m.armour *= 1 - 0.04 * l),
  },
  {
    id: 'fertility',
    name: 'Spring Meadow',
    maxLevel: 8,
    cost: 10,
    growth: 1.35,
    effect: (l) => `Breeders raise young ${pct(0.0625 * l)} more often`,
    apply: (m, l) => void (m.fertility *= 1 + 0.0625 * l),
  },
  {
    id: 'startWeapon',
    name: 'Armory Stock',
    maxLevel: 3,
    cost: 50,
    growth: 2.2,
    effect: (l) => (l === 0 ? 'Rounds start with the slingshot only' : `Rounds start with the ${WEAPON_LIST[l].name} (and everything before it)`),
    apply: (m, l) => void (m.startWeapon = Math.max(m.startWeapon, l)),
  },
  {
    id: 'rerolls',
    name: 'Second Thoughts',
    maxLevel: 3,
    cost: 40,
    growth: 2,
    effect: (l) => `${l} perk offer${l === 1 ? '' : 's'} a round can be redealt`,
    apply: (m, l) => void (m.rerolls += l),
  },
  {
    id: 'cards',
    name: 'Wider Choice',
    maxLevel: 1,
    cost: 150,
    growth: 1,
    effect: (l) => `${3 + l} cards in every perk offer`,
    apply: (m, l) => void (m.cards += l),
  },
];

export const UPGRADE: Readonly<Record<string, UpgradeDef>> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** Clover for the next level of an upgrade (Infinity when it is maxed out). */
export function upgradePrice(id: string, level: number): number {
  const u = UPGRADE[id];
  if (!u || level >= u.maxLevel) return Infinity;
  return Math.round(u.cost * u.growth ** level);
}

/** Clover to buy every level of every upgrade. */
export function totalUpgradeCost(): number {
  let sum = 0;
  for (const u of UPGRADES) for (let l = 0; l < u.maxLevel; l++) sum += upgradePrice(u.id, l);
  return sum;
}

/** Round modifiers from upgrade levels. */
export function modifiersFor(levels: Readonly<Record<string, number>>): DefenseModifiers {
  const m: DefenseModifiers = { ...NO_MODIFIERS };
  for (const u of UPGRADES) {
    const l = Math.max(0, Math.min(u.maxLevel, Math.floor(levels[u.id] ?? 0)));
    if (l > 0) u.apply(m, l);
  }
  return m;
}

/** Every upgrade at `fraction` of its levels (rounded down): for tests and the balance runner. */
export function levelsAt(fraction: number): Record<string, number> {
  return Object.fromEntries(UPGRADES.map((u) => [u.id, Math.floor(u.maxLevel * fraction)]));
}

export type BuyResult = { ok: true; profile: PlayerProfile } | { ok: false; reason: string };

/** Buys the next level of an upgrade, returning the updated profile. */
export function buyUpgrade(profile: PlayerProfile, id: string): BuyResult {
  const u = UPGRADE[id];
  if (!u) return { ok: false, reason: 'No such upgrade.' };
  const level = profile.upgrades[id] ?? 0;
  const price = upgradePrice(id, level);
  if (!Number.isFinite(price)) return { ok: false, reason: `${u.name} is fully upgraded.` };
  if (profile.clover < price) return { ok: false, reason: `Needs ${price} Clover.` };
  return { ok: true, profile: { ...profile, clover: profile.clover - price, upgrades: { ...profile.upgrades, [id]: level + 1 } } };
}
