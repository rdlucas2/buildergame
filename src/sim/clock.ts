/** Simulation time: fixed ticks, a day/night cycle and playback speed. */

/** Seconds of simulation time per tick (10 Hz). */
export const TICK_SECONDS = 0.1;
/** Length of one full day in simulation seconds (8 minutes at 1x). */
export const DAY_SECONDS = 480;
/** New wild worlds start at 7:00 in the morning. */
export const START_TIME = DAY_SECONDS * (7 / 24);
export const SPEEDS = [0, 1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];

/** Fraction of the day in [0, 1): 0 is midnight, 0.5 is noon. */
export function timeOfDay(time: number): number {
  const t = (time % DAY_SECONDS) / DAY_SECONDS;
  return t < 0 ? t + 1 : t;
}

/** 1-based day number. */
export function dayNumber(time: number): number {
  return Math.floor(time / DAY_SECONDS) + 1;
}

/** Sun height: 1 at noon, 0 at 6:00 and 18:00, -1 at midnight. */
export function sunElevation(time: number): number {
  return Math.sin(2 * Math.PI * (timeOfDay(time) - 0.25));
}

/** How much light plants get: 0 at night, ramping to 1 by mid-morning. */
export function daylight(time: number): number {
  return Math.max(0, Math.min(1, sunElevation(time) * 3));
}

export function isNight(time: number): boolean {
  return sunElevation(time) < -0.05;
}

/** "Day 3 · 14:05" */
export function formatClock(time: number): string {
  const minutes = Math.floor(timeOfDay(time) * 24 * 60 + 1e-6) % (24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `Day ${dayNumber(time)} · ${hh}:${mm}`;
}

/**
 * Turns real elapsed time into a whole number of fixed ticks at the current speed, carrying the
 * remainder, and capping the backlog so a long pause (tab in background) doesn't cause a burst.
 */
export class TickAccumulator {
  private carry = 0;

  constructor(readonly maxTicksPerFrame = 200) {}

  consume(realSeconds: number, speed: number): number {
    if (speed <= 0) return 0;
    this.carry += Math.min(realSeconds, 0.25) * speed;
    const ticks = Math.min(this.maxTicksPerFrame, Math.floor(this.carry / TICK_SECONDS + 1e-9));
    this.carry -= ticks * TICK_SECONDS;
    if (this.carry > TICK_SECONDS * this.maxTicksPerFrame) this.carry = 0;
    return ticks;
  }

  /** How far (0–1) real time has moved past the last whole tick, for smooth rendering between ticks. */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.carry / TICK_SECONDS));
  }

  reset(): void {
    this.carry = 0;
  }
}
