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

export function blockCost(material: string): number {
  return TIERS[tierOf(material)].cost;
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
