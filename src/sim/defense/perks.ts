import type { PerkCard, PerkKind, Rarity } from '../../core/defense-state';
import type { Rng } from '../rng';
import { CLASS_NAMES, WEAPON_CLASSES, type WeaponClass } from './weapons';

/**
 * Perks: bonuses the player picks during a round, one card out of three. Cards are drawn at random
 * (seeded), and the longer the warren holds out the rarer and stronger they get.
 */

export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const RARITY_WEIGHT = [60, 25, 10, 4, 1];
/** How much stronger each rarity is than a common card. */
const RARITY_POWER = [1, 1.4, 1.9, 2.6, 3.5];
/** Rarer cards get likelier with time: rarity r is weighted by (1 + t / RARITY_SHIFT)^r. */
const RARITY_SHIFT = 600;
/** Card strength grows by `GROWTH` (30%) over the first 20 minutes. */
const GROWTH_SPAN = 1200;
const GROWTH = 0.3;

export const RARITY_COLORS: Readonly<Record<Rarity, string>> = {
  common: '#b8c0c8',
  uncommon: '#5cc86a',
  rare: '#4a90e8',
  epic: '#b060e0',
  legendary: '#f0a030',
};

interface KindDef {
  name: string;
  /** Boosts a weapon class (or all of them). */
  weapon: boolean;
  weight: number;
  /** Amount of a common card at the start of a round. */
  base: number;
  /** Rarest-only kinds. */
  minRarity?: number;
  /** Amounts are whole numbers. */
  whole?: boolean;
}

const KINDS: Readonly<Record<PerkKind, KindDef>> = {
  damage: { name: 'Sharpened', weapon: true, weight: 10, base: 0.05 },
  rate: { name: 'Quick Draw', weapon: true, weight: 8, base: 0.04 },
  range: { name: 'Long Sight', weapon: true, weight: 4, base: 0.8 },
  crit: { name: 'Keen Eye', weapon: true, weight: 4, base: 0.04 },
  pierce: { name: 'Piercing', weapon: true, weight: 2, base: 1, minRarity: 2, whole: true },
  splash: { name: 'Explosive', weapon: true, weight: 2, base: 0.4, minRarity: 2 },
  multishot: { name: 'Multishot', weapon: true, weight: 1.5, base: 1, minRarity: 3, whole: true },
  regen: { name: 'Mending', weapon: false, weight: 3, base: 0.002 },
  armour: { name: 'Thick Fur', weapon: false, weight: 4, base: 0.05 },
  fertility: { name: 'Spring Fever', weapon: false, weight: 3, base: 0.1 },
  budget: { name: 'Supply Drop', weapon: false, weight: 3, base: 40, whole: true },
  bounty: { name: 'Bounty', weapon: false, weight: 3, base: 0.08 },
};

const PERK_KINDS = Object.keys(KINDS) as PerkKind[];

export function perkName(card: PerkCard): string {
  return KINDS[card.kind].name;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const one = (x: number) => (Math.round(x * 10) / 10).toString();

/** What a card does, in a sentence. */
export function describePerk(card: PerkCard): string {
  const who = card.target === 'all' ? 'every weapon' : CLASS_NAMES[card.target as WeaponClass] ?? card.target;
  switch (card.kind) {
    case 'damage':
      return `+${pct(card.amount)} damage for ${who}`;
    case 'rate':
      return `${pct(card.amount)} faster shooting for ${who}`;
    case 'range':
      return `+${one(card.amount)} range for ${who}`;
    case 'crit':
      return `+${pct(card.amount)} chance of a double-damage hit for ${who}`;
    case 'pierce':
      return `Shots from ${who} pass through ${card.amount} more predator${card.amount === 1 ? '' : 's'}`;
    case 'splash':
      return `+${one(card.amount)} blast radius for ${who}`;
    case 'multishot':
      return `+${card.amount} shot${card.amount === 1 ? '' : 's'} at a time for ${who}`;
    case 'regen':
      return `Warren blocks mend ${(card.amount * 100).toFixed(1)}% of their strength each second`;
    case 'armour':
      return `Rabbits take ${pct(card.amount)} less damage from bites`;
    case 'fertility':
      return `Breeders raise young ${pct(card.amount)} more often`;
    case 'budget':
      return `+${card.amount} block budget`;
    case 'bounty':
      return `+${pct(card.amount)} points from kills`;
  }
}

function pickWeighted<T>(rng: Rng, items: readonly T[], weight: (t: T) => number): T {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let r = rng.next() * total;
  for (const t of items) {
    r -= weight(t);
    if (r <= 0) return t;
  }
  return items[items.length - 1];
}

/**
 * Three different cards for a choice at round time `t`. Weapon perks target the classes of the
 * unlocked weapons, most often the main weapon's. `minRarity` raises the floor (milestone offers).
 */
export function rollOffer(rng: Rng, t: number, classes: readonly WeaponClass[], mainClass: WeaponClass, minRarity = 0, count = 3): PerkCard[] {
  const cards: PerkCard[] = [];
  const growth = 1 + (GROWTH * Math.min(t, GROWTH_SPAN)) / GROWTH_SPAN;
  const shift = 1 + t / RARITY_SHIFT;
  for (let guard = 0; cards.length < count && guard < 50; guard++) {
    const r = pickWeighted(
      rng,
      RARITIES.map((_, i) => i).filter((i) => i >= minRarity),
      (i) => RARITY_WEIGHT[i] * shift ** i,
    );
    const kind = pickWeighted(
      rng,
      PERK_KINDS.filter((k) => (KINDS[k].minRarity ?? 0) <= r),
      (k) => KINDS[k].weight,
    );
    const def = KINDS[kind];
    let target = '';
    let scale = 1;
    if (def.weapon) {
      if (rng.next() < 0.2) {
        target = 'all';
        scale = 0.6;
      } else target = pickWeighted(rng, classes, (c) => (c === mainClass ? 3 : 1));
    }
    if (cards.some((c) => c.kind === kind && c.target === target)) continue;
    let amount = def.base * RARITY_POWER[r] * growth * scale;
    if (kind === 'pierce' || kind === 'multishot') amount = r >= 4 ? 2 : 1;
    else if (kind === 'budget') amount = Math.round(amount / 10) * 10;
    else amount = Math.round(amount * 1000) / 1000;
    cards.push({ kind, target, amount, rarity: RARITIES[r] });
  }
  return cards;
}

/**
 * Everything the taken perks add up to. Weapon bonuses are kept per class. Bonuses of one kind add
 * up (two +10% damage cards make +20%) and different kinds multiply, so a run of perks makes the
 * defenders about twice as strong rather than growing without end.
 */
export interface PerkTotals {
  /** Damage multiplier. */
  damage: Record<WeaponClass, number>;
  /** Fire-rate multiplier (cooldowns are divided by it). */
  rate: Record<WeaponClass, number>;
  /** Extra range in cells. */
  range: Record<WeaponClass, number>;
  /** Chance of a double-damage hit. */
  crit: Record<WeaponClass, number>;
  pierce: Record<WeaponClass, number>;
  splash: Record<WeaponClass, number>;
  multishot: Record<WeaponClass, number>;
  /** Fraction of a block's hit points mended per second. */
  regen: number;
  /** Multiplier on bite damage rabbits take. */
  armour: number;
  /** Multiplier on breeding. */
  fertility: number;
  /** Multiplier on points from kills. */
  bounty: number;
}

const perClass = (v: number) => Object.fromEntries(WEAPON_CLASSES.map((c) => [c, v])) as Record<WeaponClass, number>;

/** Highest chance of a critical hit. */
export const MAX_CRIT = 0.6;

export function totalsOf(cards: readonly PerkCard[]): PerkTotals {
  const t: PerkTotals = {
    damage: perClass(1),
    rate: perClass(1),
    range: perClass(0),
    crit: perClass(0),
    pierce: perClass(0),
    splash: perClass(0),
    multishot: perClass(0),
    regen: 0,
    armour: 1,
    fertility: 1,
    bounty: 1,
  };
  for (const card of cards) {
    if (KINDS[card.kind].weapon) {
      const classes = card.target === 'all' ? WEAPON_CLASSES : WEAPON_CLASSES.filter((c) => c === card.target);
      for (const c of classes) {
        if (card.kind === 'damage') t.damage[c] += card.amount;
        else if (card.kind === 'rate') t.rate[c] += card.amount;
        else if (card.kind === 'crit') t.crit[c] = Math.min(MAX_CRIT, t.crit[c] + card.amount);
        else t[card.kind as 'range' | 'pierce' | 'splash' | 'multishot'][c] += card.amount;
      }
      continue;
    }
    if (card.kind === 'regen') t.regen += card.amount;
    else if (card.kind === 'armour') t.armour *= 1 - card.amount;
    else if (card.kind === 'fertility') t.fertility *= 1 + card.amount;
    else if (card.kind === 'bounty') t.bounty *= 1 + card.amount;
  }
  return t;
}
