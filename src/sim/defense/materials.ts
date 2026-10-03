/**
 * How well each building material holds up when predators try to break it, and what it costs
 * against a warren's block budget. Materials fall into five tiers, from soft to metal.
 */
export interface Tier {
  name: string;
  /** Hit points of one block at strength level 0. */
  hp: number;
  /** Budget cost of one block. */
  cost: number;
}

export const TIERS: readonly Tier[] = [
  { name: 'Soft', hp: 10, cost: 1 },
  { name: 'Wood', hp: 25, cost: 2 },
  { name: 'Stone', hp: 60, cost: 3 },
  { name: 'Masonry', hp: 120, cost: 5 },
  { name: 'Metal', hp: 250, cost: 8 },
];

const TIER_OF: Readonly<Record<string, number>> = {
  planks: 1,
  log: 1,
  lookout: 1,
  stone: 2,
  cobblestone: 2,
  brick: 2,
  limestone: 2,
  stone_bricks: 3,
  slate: 3,
  marble: 3,
  iron: 4,
  bronze: 4,
  gold: 4,
};

/** Tier of a material (0, soft, for anything not listed: earth, glass, coloured blocks, lanterns). */
export function tierOf(material: string): number {
  return TIER_OF[material] ?? 0;
}

/** The warren's core: part of every warren, never built or removed by the player, and free. */
export const CORE = 'core';

export function blockCost(material: string): number {
  return material === CORE ? 0 : TIERS[tierOf(material)].cost;
}

/** Hit points that block upgrades add per strength level of a tier. */
export const STRENGTH_PER_LEVEL = 0.25;

/**
 * Hit points of one block, given strength levels bought per tier and an overall multiplier (from
 * permanent upgrades and perks).
 */
export function blockHp(material: string, strength: readonly number[] = [], multiplier = 1): number {
  const t = tierOf(material);
  return Math.round(TIERS[t].hp * (1 + STRENGTH_PER_LEVEL * (strength[t] ?? 0)) * multiplier);
}

/** A block Fortify builds with: what it is called, and what it is for. */
export interface WarrenBlock {
  material: string;
  name: string;
  role: string;
}

/**
 * The blocks a warren is built from: four walls from cheap to tough (one per tier: wood, stone,
 * masonry, metal) and the lookout post.
 */
export const WARREN_BLOCKS: readonly WarrenBlock[] = [
  { material: 'planks', name: 'Wood wall', role: 'Cheap and quick: steps, roofs and patching holes.' },
  { material: 'cobblestone', name: 'Stone wall', role: 'The everyday wall.' },
  { material: 'stone_bricks', name: 'Brick wall', role: 'Masonry: twice as tough as stone.' },
  { material: 'iron', name: 'Iron wall', role: 'Metal: the toughest wall.' },
  { material: 'lookout', name: 'Lookout post', role: 'A defender stands on top and shoots from it, and every defender needs one. Make the top block of a wall a post, so defenders can walk the wall from post to post.' },
];
