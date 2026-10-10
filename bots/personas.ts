import type { PerkKind } from '../src/core/defense-state';

/**
 * Play styles for the test bots. Each is a short brief (what the TypeSafe brain is told about how
 * to play) plus the weights the heuristic brain plays the same style with.
 */
export const STYLES = ['turtle', 'sharpshooter', 'breeder', 'balanced', 'gambler', 'expander', 'fortifier'] as const;
export type Style = (typeof STYLES)[number];

/** Build moves the advisor offers (`buildOptions`), without the tier suffix of `strengthen-<tier>`. */
export type BuildKind = 'rebuild-breaches' | 'raise-walls' | 'roof-nursery' | 'more-lookouts' | 'expand-warren' | 'reinforce-doorways' | 'thicken-walls' | 'dismantle-inner' | 'repair' | 'buy-budget' | 'reinforce' | 'call-wave';

export interface Persona {
  style: Style;
  name: string;
  /** How this bot plays, in a sentence or two, for the model. */
  brief: string;
  /** Share of grown rabbits to make defenders, and the fewest defenders to keep. */
  defenders: number;
  minDefenders: number;
  /** From this many seconds into a round, the share of grown rabbits to defend rises to this (a colony built first, then drafted). */
  draft?: { from: number; share: number };
  /** How much the bot wants each build move when it is on offer (0 never). */
  build: Partial<Record<BuildKind, number>>;
  /** How much the bot likes each kind of perk (1 when not listed). */
  perks: Partial<Record<PerkKind, number>>;
  /** Weight of a card's rarity against its kind. */
  rarity: number;
  /** Redeals an offer with nothing rarer than this (rarity rank 0–4), while it has rerolls. */
  rerollBelow: number;
  /** Warren Council upgrades, most wanted first. */
  council: string[];
  /** Holds block budget back for expanding the warren (only the most urgent building goes ahead). */
  saves?: boolean;
}

export const PERSONAS: Readonly<Record<Style, Persona>> = {
  turtle: {
    style: 'turtle',
    name: 'Turtle',
    brief: 'Walls first. Keeps the warren sealed and mended, builds high and strong, and keeps only a small guard of defenders. Spends points on repairs and stronger blocks before anything else.',
    defenders: 0.3,
    minDefenders: 3,
    draft: { from: 300, share: 0.4 },
    build: { 'rebuild-breaches': 10, 'thicken-walls': 7, 'reinforce-doorways': 8, repair: 9, 'raise-walls': 8, 'roof-nursery': 7, reinforce: 6, 'buy-budget': 5, 'more-lookouts': 2 },
    perks: { regen: 4, armour: 3, budget: 3, damage: 1.5 },
    rarity: 1.5,
    rerollBelow: -1,
    council: ['walls', 'budget', 'armour', 'rabbits', 'damage', 'fertility', 'startWeapon', 'rerolls', 'cards'],
  },
  sharpshooter: {
    style: 'sharpshooter',
    name: 'Sharpshooter',
    brief: 'Firepower first. Puts many rabbits on lookouts, builds more lookout posts, and takes every perk that makes the main weapon hit harder, faster or further. Walls only need to hold long enough for the shooting.',
    defenders: 0.6,
    minDefenders: 6,
    build: { 'more-lookouts': 10, 'rebuild-breaches': 7, 'raise-walls': 5, repair: 5, 'roof-nursery': 4, 'reinforce-doorways': 4, 'buy-budget': 3, reinforce: 2 },
    perks: { damage: 4, rate: 4, multishot: 5, pierce: 3, splash: 3, crit: 3, range: 2, armour: 0.5, fertility: 0.3, regen: 0.5 },
    rarity: 1.5,
    rerollBelow: -1,
    council: ['damage', 'startWeapon', 'cards', 'rerolls', 'rabbits', 'walls', 'armour', 'budget', 'fertility'],
  },
  breeder: {
    style: 'breeder',
    name: 'Breeder',
    brief: 'Economy first. The early waves are easy, so it keeps almost every rabbit breeding (3 defenders), takes the fertility and bounty perks first, and puts the surplus into layers of wall, a second wall inside the first, one side at a time. From 2:30 it drafts half the colony as defenders.',
    defenders: 0.15,
    minDefenders: 3,
    draft: { from: 150, share: 0.5 },
    build: { 'rebuild-breaches': 9, 'thicken-walls': 8, 'roof-nursery': 7, repair: 6, 'raise-walls': 6, 'reinforce-doorways': 5, 'more-lookouts': 4, reinforce: 3, 'buy-budget': 3 },
    perks: { fertility: 6, bounty: 3, budget: 3, armour: 3, regen: 2 },
    rarity: 1.5,
    rerollBelow: -1,
    council: ['rabbits', 'fertility', 'armour', 'walls', 'damage', 'budget', 'startWeapon', 'cards', 'rerolls'],
  },
  balanced: {
    style: 'balanced',
    name: 'Balanced',
    brief: 'A bit of everything. About 40% defenders, walls kept mended and raised before tigers and hawks arrive, and perks for the main weapon or toughness, rarest first.',
    defenders: 0.4,
    minDefenders: 4,
    build: { 'rebuild-breaches': 9, 'more-lookouts': 6, repair: 7, 'raise-walls': 7, 'roof-nursery': 6, 'reinforce-doorways': 6, reinforce: 4, 'buy-budget': 4 },
    perks: { damage: 2.5, rate: 2.5, multishot: 3, armour: 2, regen: 1.5 },
    rarity: 2,
    rerollBelow: -1,
    council: ['damage', 'walls', 'rabbits', 'budget', 'armour', 'startWeapon', 'cards', 'fertility', 'rerolls'],
  },
  gambler: {
    style: 'gambler',
    name: 'Gambler',
    brief: 'Takes risks for rewards. Calls waves early for bonus points whenever the field is clear, redeals plain perk offers hoping for rare ones, and favours rare, high-risk cards like bounty and multishot.',
    defenders: 0.5,
    minDefenders: 4,
    build: { 'call-wave': 6, 'rebuild-breaches': 8, 'more-lookouts': 5, repair: 5, 'raise-walls': 5, 'roof-nursery': 4, 'reinforce-doorways': 3, reinforce: 3, 'buy-budget': 3 },
    perks: { bounty: 4, multishot: 4, crit: 3, damage: 2, splash: 2 },
    rarity: 4,
    rerollBelow: 2,
    council: ['rerolls', 'cards', 'damage', 'startWeapon', 'rabbits', 'walls', 'budget', 'armour', 'fertility'],
  },
  expander: {
    style: 'expander',
    name: 'Expander',
    brief: 'Grows the warren. Saves block budget to build new rings of walls further out, lined with lookout posts, so there is room for more rabbits and posts for more defenders; buys budget with points. Plays for the long game past 20:00.',
    defenders: 0.5,
    minDefenders: 5,
    build: { 'expand-warren': 12, 'rebuild-breaches': 10, repair: 9, 'more-lookouts': 9, 'buy-budget': 8, reinforce: 7, 'raise-walls': 6, 'roof-nursery': 4, 'reinforce-doorways': 3 },
    perks: { damage: 3, rate: 3, multishot: 3, fertility: 2, budget: 2, armour: 2 },
    rarity: 2,
    rerollBelow: -1,
    council: ['damage', 'budget', 'rabbits', 'walls', 'startWeapon', 'armour', 'fertility', 'cards', 'rerolls'],
    saves: true,
  },
  fortifier: {
    style: 'fortifier',
    name: 'Fortifier',
    brief: 'Breeds first, then grows outward. Keeps almost every rabbit breeding early (3 defenders) on fertility and bounty perks, saves block budget for new rings of walls, and tears the old inner wall down once a newer ring surrounds it: the ground becomes room for more rabbits and the freed blocks pay for the next ring. Drafts half the colony as defenders from 4:00.',
    defenders: 0.15,
    minDefenders: 3,
    draft: { from: 240, share: 0.5 },
    build: { 'expand-warren': 12, 'dismantle-inner': 12, 'rebuild-breaches': 10, repair: 8, 'buy-budget': 8, 'more-lookouts': 6, 'raise-walls': 6, reinforce: 5, 'roof-nursery': 4 },
    perks: { fertility: 6, bounty: 3, budget: 4, armour: 2, damage: 2, regen: 1.5 },
    rarity: 1.5,
    rerollBelow: -1,
    council: ['rabbits', 'fertility', 'budget', 'walls', 'armour', 'damage', 'startWeapon', 'cards', 'rerolls'],
    saves: true,
  },
};

export function isStyle(s: string): s is Style {
  return (STYLES as readonly string[]).includes(s);
}
