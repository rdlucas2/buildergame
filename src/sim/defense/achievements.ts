import { flawless, killsOf, killsWith, kills, points, rounds, time, unlocks, type Criterion } from './criteria';

/**
 * Achievements: goals measured over one round or over every round played, each worth Clover.
 * Time survived drives the biggest ones.
 */
export interface AchievementDef {
  id: string;
  name: string;
  /** Measured within one round, or over the player's lifetime. */
  scope: 'round' | 'lifetime';
  criterion: Criterion;
  clover: number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'survive-5', name: 'Holding On', scope: 'round', criterion: time(300), clover: 15 },
  { id: 'survive-10', name: 'Ten-Minute Warren', scope: 'round', criterion: time(600), clover: 30 },
  { id: 'survive-15', name: 'Quarter Hour', scope: 'round', criterion: time(900), clover: 60 },
  { id: 'survive-20', name: 'The Long Night', scope: 'round', criterion: time(1200), clover: 120 },
  { id: 'survive-25', name: 'Legend of the Warren', scope: 'round', criterion: time(1500), clover: 250 },
  { id: 'flawless-5', name: 'Untouched', scope: 'round', criterion: flawless(300), clover: 25 },
  { id: 'kills-round-200', name: 'Thinning the Pack', scope: 'round', criterion: kills(200), clover: 30 },
  { id: 'arsenal', name: 'Well Armed', scope: 'round', criterion: unlocks(5), clover: 30 },
  { id: 'plasma', name: 'From Slingshot to Plasma', scope: 'round', criterion: killsWith('plasma', 1), clover: 80 },
  { id: 'score-10k', name: 'High Score', scope: 'round', criterion: points(10_000), clover: 40 },
  { id: 'giant-slayer', name: 'Giant Slayer', scope: 'round', criterion: killsOf('boss', 1), clover: 100 },
  { id: 'first-round', name: 'Founding', scope: 'lifetime', criterion: rounds(1), clover: 10 },
  { id: 'rounds-10', name: 'Veteran', scope: 'lifetime', criterion: rounds(10), clover: 40 },
  { id: 'hour', name: 'Stalwart', scope: 'lifetime', criterion: time(3600), clover: 60 },
  { id: 'kills-1000', name: 'Warden', scope: 'lifetime', criterion: kills(1000), clover: 50 },
  { id: 'foxes-500', name: 'Fox Hunter', scope: 'lifetime', criterion: killsOf('fox', 500), clover: 40 },
  { id: 'wolves-300', name: 'Wolf Bane', scope: 'lifetime', criterion: killsOf('wolf', 300), clover: 40 },
  { id: 'badgers-100', name: 'Badger Buster', scope: 'lifetime', criterion: killsOf('badger', 100), clover: 40 },
  { id: 'bears-50', name: 'Bear Hunter', scope: 'lifetime', criterion: killsOf('bear', 50), clover: 60 },
  { id: 'tigers-50', name: 'Tiger Tamer', scope: 'lifetime', criterion: killsOf('tiger', 50), clover: 60 },
  { id: 'hawks-50', name: 'Clear Skies', scope: 'lifetime', criterion: killsOf('hawk', 50), clover: 60 },
  { id: 'elites-25', name: 'Elite Hunter', scope: 'lifetime', criterion: killsOf('elite', 25), clover: 80 },
  { id: 'bow-100', name: 'Archer', scope: 'lifetime', criterion: killsWith('bow', 100), clover: 30 },
  { id: 'cannon-200', name: 'Big Guns', scope: 'lifetime', criterion: killsWith('cannon', 200), clover: 50 },
  { id: 'laser-200', name: 'Futurist', scope: 'lifetime', criterion: killsWith('laser', 200), clover: 60 },
];

export const ACHIEVEMENT: Readonly<Record<string, AchievementDef>> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
