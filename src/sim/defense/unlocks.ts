import { all, any, killsOf, killsWith, points, time, type Criterion } from './criteria';

/**
 * When each weapon unlocks during a round. Every one comes with time survived, so a round that
 * holds out keeps getting stronger, and most can come sooner by using the weapon before it or by
 * fighting a particular predator.
 */
export const WEAPON_UNLOCKS: Readonly<Record<string, Criterion | null>> = {
  slingshot: null,
  bow: any(time(150), killsWith('slingshot', 20)),
  crossbow: any(time(270), killsWith('bow', 25)),
  musket: all(time(360), points(1500)),
  rifle: any(time(510), killsWith('musket', 30)),
  shotgun: any(time(540), killsOf('fox', 60)),
  cannon: any(time(660), killsOf('badger', 12), killsOf('bear', 3)),
  laser: any(time(840), all(points(9000), killsWith('rifle', 60))),
  plasma: any(time(1020), killsWith('laser', 60)),
};

/** When each material tier can be built with (soft, wood and stone from the start). */
export const TIER_UNLOCKS: ReadonlyArray<Criterion | null> = [null, null, null, any(time(180), points(600)), any(time(480), points(3000))];

/** Strength levels a tier can be upgraded to. */
export const MAX_STRENGTH = 8;
const STRENGTH_PRICE = [40, 60, 90, 140, 220];
const STRENGTH_GROWTH = 1.5;

/** Points to raise a tier from `level` to `level + 1`. */
export function strengthPrice(tier: number, level: number): number {
  return Math.round(STRENGTH_PRICE[tier] * STRENGTH_GROWTH ** level);
}

/** Hit points a point of repair buys. */
export const REPAIR_HP_PER_POINT = 4;
