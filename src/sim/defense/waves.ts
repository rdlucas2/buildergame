import type { SpawnOrder } from '../../core/defense-state';
import type { CreatureKind } from '../../core/world';
import { KINDS } from '../creatures/species';
import type { Rng } from '../rng';

/** Seconds of quiet before the first wave: time to look around and fortify. */
export const OPENING_SECONDS = 30;
/** Seconds between scheduled waves. */
export const WAVE_INTERVAL = 55;
/** From here on every wave is much tougher than the last. */
export const OVERTIME_START = 20 * 60;
/**
 * Each overtime wave multiplies enemy hit points and wave size by these. Hit points matter most:
 * splash and piercing weapons do better against bigger crowds, but not against tougher predators.
 */
export const OVERTIME_GROWTH = { hp: 1.35, size: 1.1 };
/** How far from the warren predators appear. */
export const SPAWN_DISTANCE = 70;
/** Seconds over which a wave's groups arrive. */
const SPREAD_SECONDS = 12;

/** When a kind starts to appear, how long it takes to reach full weight, and how it fades later. */
interface Schedule {
  from: number;
  ramp: number;
  /** After this time the kind becomes rarer, down to `floor` of its weight. */
  fadeFrom?: number;
  floor?: number;
}

/**
 * Which predators come when: foxes from the start, then wolves, badgers, tigers, bears and hawks.
 * Easy kinds fade as harder ones arrive, so early waves are mostly foxes and late waves are not.
 */
export const SCHEDULE: Partial<Record<CreatureKind, Schedule>> = {
  fox: { from: 0, ramp: 1, fadeFrom: 360, floor: 0.25 },
  wolf: { from: 120, ramp: 120, fadeFrom: 900, floor: 0.5 },
  badger: { from: 240, ramp: 150 },
};

/** Weight of each kind at round time `t` (seconds). */
export function kindWeights(t: number, schedule = SCHEDULE): Partial<Record<CreatureKind, number>> {
  const out: Partial<Record<CreatureKind, number>> = {};
  for (const [kind, s] of Object.entries(schedule) as Array<[CreatureKind, Schedule]>) {
    if (t < s.from) continue;
    let w = Math.min(1, (t - s.from + 1) / Math.max(1, s.ramp));
    if (s.fadeFrom !== undefined && t > s.fadeFrom) w *= Math.max(s.floor ?? 0, 1 - (t - s.fadeFrom) / 600);
    if (w > 0) out[kind] = w;
  }
  return out;
}

/** Overtime waves so far at round time `t`: 0 until 20:00, then one more every wave interval. */
export function overtimeWaves(t: number): number {
  return t < OVERTIME_START ? 0 : Math.floor((t - OVERTIME_START) / WAVE_INTERVAL) + 1;
}

/** Overtime factor for wave size or hit points: 1 until 20:00, then compounding per wave. */
export function overtime(t: number, what: 'hp' | 'size' = 'hp'): number {
  return OVERTIME_GROWTH[what] ** overtimeWaves(t);
}

/**
 * How waves grow. Their size grows gently (more predators would mostly cost speed), while each
 * predator's hit points compound every minute: the defenders' weapons and perks grow about as
 * fast for the first ten minutes or so, then fall behind, and only an upgraded warren lasts to 20.
 */
export const WAVE_SIZE = { base: 4, perMinute: 2.5, power: 1.25 };
export const HP_GROWTH = 1.31;

/** Threat points a wave at round time `t` may spend on predators (a fox costs 1). */
export function threatBudget(t: number): number {
  const m = t / 60;
  return (WAVE_SIZE.base + WAVE_SIZE.perMinute * m ** WAVE_SIZE.power) * overtime(t, 'size');
}

/** Hit-point multiplier for predators arriving at round time `t`. */
export function hpScale(t: number): number {
  return HP_GROWTH ** (t / 60) * overtime(t, 'hp');
}

/** Round time at which wave `n` (from 1) is due. */
export function waveTime(n: number): number {
  return OPENING_SECONDS + (n - 1) * WAVE_INTERVAL;
}


export interface WavePlan {
  n: number;
  at: number;
  orders: SpawnOrder[];
  /** Total threat points in the wave. */
  threat: number;
}

/**
 * Plans wave `n`, starting at round time `at`: spends the threat budget for that time on predators
 * picked by weight, then splits them into groups that arrive from one to three directions over a
 * few seconds. Difficulty follows the time, so calling a wave early brings it before it is at its
 * strongest.
 */
export function planWave(n: number, at: number, rng: Rng, schedule = SCHEDULE): WavePlan {
  const weights = kindWeights(at, schedule);
  const kinds = Object.keys(weights) as CreatureKind[];
  let budget = threatBudget(at);
  const counts = new Map<CreatureKind, number>();
  let threat = 0;
  for (let guard = 0; guard < 500 && kinds.length > 0; guard++) {
    const affordable = kinds.filter((k) => KINDS[k].threat <= budget);
    if (affordable.length === 0) break;
    const total = affordable.reduce((s, k) => s + weights[k]!, 0);
    let pick = rng.next() * total;
    let kind = affordable[affordable.length - 1];
    for (const k of affordable) {
      pick -= weights[k]!;
      if (pick <= 0) {
        kind = k;
        break;
      }
    }
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    budget -= KINDS[kind].threat;
    threat += KINDS[kind].threat;
  }
  const directions = Math.min(3, 1 + Math.floor(n / 6));
  const angles = Array.from({ length: directions }, () => rng.range(0, Math.PI * 2));
  const scale = hpScale(at);
  const orders: SpawnOrder[] = [];
  let g = 0;
  for (const [kind, count] of [...counts.entries()].sort((a, b) => KINDS[a[0]].threat - KINDS[b[0]].threat)) {
    // Big groups split across directions; each part arrives a little after the last.
    const parts = Math.min(directions, Math.max(1, Math.ceil(count / 4)));
    for (let p = 0; p < parts; p++) {
      const share = Math.floor(count / parts) + (p < count % parts ? 1 : 0);
      if (share === 0) continue;
      orders.push({ at: at + rng.range(0, SPREAD_SECONDS), kind, count: share, angle: angles[(g + p) % directions] + rng.range(-0.3, 0.3), hpScale: scale });
    }
    g++;
  }
  orders.sort((a, b) => a.at - b.at);
  return { n, at, orders, threat };
}
