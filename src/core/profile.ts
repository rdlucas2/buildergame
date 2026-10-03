/**
 * A player's progress across Warren Defense rounds: Clover to spend at the Warren Council, the
 * permanent upgrades bought there, achievements earned and lifetime totals. Saved in the browser
 * and exportable as a file (see docs/FILE_FORMATS.md).
 */
export interface LifetimeStats {
  rounds: number;
  /** Seconds survived across every round. */
  time: number;
  bestTime: number;
  bestScore: number;
  bestWave: number;
  score: number;
  waves: number;
  kills: number;
  killsWith: Record<string, number>;
  killsOf: Record<string, number>;
}

export interface PlayerProfile {
  /** Clover to spend, and every bit ever earned. */
  clover: number;
  cloverEarned: number;
  /** Level of each Warren Council upgrade bought, by id. */
  upgrades: Record<string, number>;
  /** Achievements earned: id → when (ISO date). */
  achievements: Record<string, string>;
  stats: LifetimeStats;
}

export function emptyLifetime(): LifetimeStats {
  return { rounds: 0, time: 0, bestTime: 0, bestScore: 0, bestWave: 0, score: 0, waves: 0, kills: 0, killsWith: {}, killsOf: {} };
}

export function newProfile(): PlayerProfile {
  return { clover: 0, cloverEarned: 0, upgrades: {}, achievements: {}, stats: emptyLifetime() };
}
