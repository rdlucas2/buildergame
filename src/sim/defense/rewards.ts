import type { DefenseStats } from '../../core/defense-state';
import type { LifetimeStats, PlayerProfile } from '../../core/profile';
import { ACHIEVEMENTS, type AchievementDef } from './achievements';
import { met, type Progress } from './criteria';

/** What a round adds up to, for rewards and achievements. */
export interface RoundResult {
  clock: number;
  score: number;
  wave: number;
  stats: DefenseStats;
  /** Weapons unlocked by the end. */
  unlocked: number;
  milestones: number;
}

/** Clover earned by a round, by where it came from. */
export interface RoundReward {
  time: number;
  milestones: number;
  kills: number;
  achievements: number;
  total: number;
}

/** Clover per minute survived. */
const CLOVER_PER_MINUTE = 4;
/** Clover for reaching each 5-minute milestone: 5:00, 10:00, 15:00, 20:00, and every one after. */
const MILESTONE_CLOVER = [10, 20, 30, 50];
const LATE_MILESTONE_CLOVER = 50;
/** Kills per Clover. */
const KILLS_PER_CLOVER = 15;

/** Clover for time survived, milestones and kills (achievements come on top). */
export function roundClover(r: RoundResult): Omit<RoundReward, 'achievements' | 'total'> {
  let milestones = 0;
  for (let i = 0; i < r.milestones; i++) milestones += MILESTONE_CLOVER[i] ?? LATE_MILESTONE_CLOVER;
  return { time: Math.floor((r.clock / 60) * CLOVER_PER_MINUTE), milestones, kills: Math.floor(r.stats.kills / KILLS_PER_CLOVER) };
}

/** A round as achievement criteria see it. */
export function roundProgress(r: RoundResult): Progress {
  const s = r.stats;
  return { clock: r.clock, score: r.score, waves: r.wave, kills: s.kills, killsWith: s.killsWith, killsOf: s.killsOf, firstLoss: s.firstLoss, unlocks: r.unlocked };
}

/** A lifetime as achievement criteria see it. */
export function lifetimeProgress(l: LifetimeStats): Progress {
  return { clock: l.time, score: l.score, waves: l.waves, kills: l.kills, killsWith: l.killsWith, killsOf: l.killsOf, rounds: l.rounds };
}

/** Round achievements met so far that the profile hasn't earned yet. */
export function newRoundAchievements(profile: PlayerProfile, r: RoundResult): AchievementDef[] {
  const p = roundProgress(r);
  return ACHIEVEMENTS.filter((a) => a.scope === 'round' && !profile.achievements[a.id] && met(a.criterion, p));
}

/** Records achievements as earned now and pays their Clover. */
export function awardAchievements(profile: PlayerProfile, list: readonly AchievementDef[], when: string): PlayerProfile {
  if (list.length === 0) return profile;
  const clover = list.reduce((s, a) => s + a.clover, 0);
  const achievements = { ...profile.achievements };
  for (const a of list) achievements[a.id] = when;
  return { ...profile, achievements, clover: profile.clover + clover, cloverEarned: profile.cloverEarned + clover };
}

function addCounts(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): Record<string, number> {
  const out = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
}

/**
 * Ends a round for the player's profile: adds it to the lifetime totals, pays Clover for time,
 * milestones and kills, and awards every achievement it (or the new lifetime totals) earned.
 */
export function finishRound(profile: PlayerProfile, r: RoundResult, when: string): { profile: PlayerProfile; reward: RoundReward; earned: AchievementDef[] } {
  const l = profile.stats;
  const stats: LifetimeStats = {
    rounds: l.rounds + 1,
    time: l.time + r.clock,
    bestTime: Math.max(l.bestTime, r.clock),
    bestScore: Math.max(l.bestScore, r.score),
    bestWave: Math.max(l.bestWave, r.wave),
    score: l.score + r.score,
    waves: l.waves + r.wave,
    kills: l.kills + r.stats.kills,
    killsWith: addCounts(l.killsWith, r.stats.killsWith),
    killsOf: addCounts(l.killsOf, r.stats.killsOf),
  };
  const base = roundClover(r);
  let next: PlayerProfile = { ...profile, stats, clover: profile.clover + base.time + base.milestones + base.kills, cloverEarned: profile.cloverEarned + base.time + base.milestones + base.kills };
  const life = lifetimeProgress(stats);
  const earned = [...newRoundAchievements(next, r), ...ACHIEVEMENTS.filter((a) => a.scope === 'lifetime' && !next.achievements[a.id] && met(a.criterion, life))];
  next = awardAchievements(next, earned, when);
  const achievements = earned.reduce((s, a) => s + a.clover, 0);
  return { profile: next, reward: { ...base, achievements, total: base.time + base.milestones + base.kills + achievements }, earned };
}
