import { KINDS } from '../creatures';
import { WEAPONS } from './weapons';

/**
 * Conditions for unlocking weapons and materials (and, later, achievements). They are data, so the
 * game can show progress towards them as well as check them.
 */
export type Criterion =
  | { type: 'time'; seconds: number }
  | { type: 'points'; points: number }
  | { type: 'kills'; kills: number }
  | { type: 'killsWith'; weapon: string; kills: number }
  | { type: 'killsOf'; kind: string; kills: number }
  | { type: 'waves'; waves: number }
  /** Survive `seconds` without losing a rabbit (in a round). */
  | { type: 'flawless'; seconds: number }
  /** Unlock this many weapons (in a round). */
  | { type: 'unlocks'; count: number }
  /** Play this many rounds (over a lifetime). */
  | { type: 'rounds'; count: number }
  | { type: 'all'; of: Criterion[] }
  | { type: 'any'; of: Criterion[] };

/** What criteria are measured against: one round so far (or, for achievements, a lifetime). */
export interface Progress {
  /** Seconds survived. */
  clock: number;
  /** Points earned (the score, not what is left to spend). */
  score: number;
  waves: number;
  kills: number;
  killsWith: Readonly<Record<string, number>>;
  killsOf: Readonly<Record<string, number>>;
  /** Round time of the first rabbit lost (-1 for none); weapons unlocked; rounds played. */
  firstLoss?: number;
  unlocks?: number;
  rounds?: number;
}

export const time = (seconds: number): Criterion => ({ type: 'time', seconds });
export const points = (n: number): Criterion => ({ type: 'points', points: n });
export const kills = (n: number): Criterion => ({ type: 'kills', kills: n });
export const killsWith = (weapon: string, n: number): Criterion => ({ type: 'killsWith', weapon, kills: n });
export const killsOf = (kind: string, n: number): Criterion => ({ type: 'killsOf', kind, kills: n });
export const waves = (n: number): Criterion => ({ type: 'waves', waves: n });
export const flawless = (seconds: number): Criterion => ({ type: 'flawless', seconds });
export const unlocks = (count: number): Criterion => ({ type: 'unlocks', count });
export const rounds = (count: number): Criterion => ({ type: 'rounds', count });
export const all = (...of: Criterion[]): Criterion => ({ type: 'all', of });
export const any = (...of: Criterion[]): Criterion => ({ type: 'any', of });

/** How far along a criterion is, from 0 to 1 (1 when met). */
export function progressOf(c: Criterion, p: Progress): number {
  const frac = (have: number, need: number) => (need <= 0 ? 1 : Math.max(0, Math.min(1, have / need)));
  switch (c.type) {
    case 'time':
      return frac(p.clock, c.seconds);
    case 'points':
      return frac(p.score, c.points);
    case 'kills':
      return frac(p.kills, c.kills);
    case 'killsWith':
      return frac(p.killsWith[c.weapon] ?? 0, c.kills);
    case 'killsOf':
      return frac(p.killsOf[c.kind] ?? 0, c.kills);
    case 'waves':
      return frac(p.waves, c.waves);
    case 'flawless': {
      // Time without a loss so far: up to the first loss, if there was one.
      const loss = p.firstLoss ?? -1;
      return frac(loss < 0 ? p.clock : Math.min(p.clock, loss), c.seconds);
    }
    case 'unlocks':
      return frac(p.unlocks ?? 0, c.count);
    case 'rounds':
      return frac(p.rounds ?? 0, c.count);
    case 'all':
      return c.of.length === 0 ? 1 : c.of.reduce((s, x) => s + progressOf(x, p), 0) / c.of.length;
    case 'any':
      return c.of.reduce((m, x) => Math.max(m, progressOf(x, p)), 0);
  }
}

export function met(c: Criterion, p: Progress): boolean {
  switch (c.type) {
    case 'all':
      return c.of.every((x) => met(x, p));
    case 'any':
      return c.of.some((x) => met(x, p));
    default:
      return progressOf(c, p) >= 1;
  }
}

const clockText = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const plural = (n: number, word: string, words = `${word}s`) => `${n} ${n === 1 ? word : words}`;
const KIND_PLURALS: Readonly<Record<string, string>> = { fox: 'foxes', wolf: 'wolves' };

/** "Survive 3:00", "20 kills with the Slingshot", "Survive 6:00 and earn 1500 points". */
export function describe(c: Criterion): string {
  switch (c.type) {
    case 'time':
      return `Survive ${clockText(c.seconds)}`;
    case 'points':
      return `Earn ${c.points} points`;
    case 'kills':
      return `Drive off ${plural(c.kills, 'predator')}`;
    case 'killsWith':
      return `${plural(c.kills, 'kill')} with the ${WEAPONS[c.weapon]?.name ?? c.weapon}`;
    case 'killsOf': {
      const name = KINDS[c.kind as keyof typeof KINDS]?.name.toLowerCase() ?? c.kind;
      return `Drive off ${plural(c.kills, name, KIND_PLURALS[c.kind] ?? `${name}s`)}`;
    }
    case 'waves':
      return `Hold out ${plural(c.waves, 'wave')}`;
    case 'flawless':
      return `Lose no rabbit in the first ${clockText(c.seconds)}`;
    case 'unlocks':
      return `Unlock ${plural(c.count, 'weapon')} in one round`;
    case 'rounds':
      return `Play ${plural(c.count, 'round')}`;
    case 'all':
      return joined(c.of, ' and ');
    case 'any':
      return joined(c.of, ', or ');
  }
}

/** Joins descriptions into one sentence: "Survive 6:00 and earn 1500 points". */
function joined(parts: readonly Criterion[], sep: string): string {
  return parts.map((p, i) => (i === 0 ? describe(p) : lowerFirst(describe(p)))).join(sep);
}

/** Lower-cases a leading verb ("Survive", "Earn", "Drive", "Hold"), leaving counts and names alone. */
function lowerFirst(s: string): string {
  return /^(Survive|Earn|Drive|Hold) /.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}
