import { NO_MODIFIERS, type DefenseModifiers } from '../../core/defense-state';
import { Ecosystem } from '../ecosystem';
import type { DefenseAction } from './defense';

/** Ground size (cells across) of a Warren Defense world. */
export const DEFENSE_GROUND = 512;

/** An action and the round tick (tenths of a second survived) it was taken at. */
export interface ReplayEntry {
  tick: number;
  action: DefenseAction;
}

/** What it takes to play a round again: its seed, its upgrades and every action taken in it. */
export interface ReplayScript {
  seed: number;
  size: number;
  modifiers: Partial<DefenseModifiers>;
  actions: readonly ReplayEntry[];
  /** The tick the recording ended at (a round can be stopped before it is lost). */
  ticks: number;
}

/**
 * A new Warren Defense round, set up exactly as the game sets one up: created from the seed, saved,
 * then restored and attached with no placements. Headless runs (bots, the balance runner, replays)
 * start here so that a seed and a list of actions play out the same in the browser.
 */
export function startRound(seed: number, modifiers: Partial<DefenseModifiers> = {}, size = DEFENSE_GROUND): Ecosystem {
  const fresh = Ecosystem.create(size, seed, { defense: { ...NO_MODIFIERS, ...modifiers } });
  const eco = Ecosystem.restore(size, fresh.snapshot());
  eco.setPlacements([], () => undefined);
  return eco;
}

/** Records every action that succeeds in a round, with the tick it was taken at. */
export function record(eco: Ecosystem): ReplayEntry[] {
  const d = eco.defense;
  if (!d) throw new Error('Not a Warren Defense ecosystem');
  const out: ReplayEntry[] = [];
  d.recorder = (tick, action) => out.push({ tick, action });
  return out;
}

/** Plays a recorded round again, headless, to where its recording ended (or until it is lost). */
export function runReplay(script: ReplayScript): Ecosystem {
  const eco = startRound(script.seed, script.modifiers, script.size);
  const d = eco.defense!;
  d.schedule(script.actions);
  while (!d.over && d.tickIndex < script.ticks) eco.tick();
  return eco;
}

/**
 * A fingerprint of the whole simulation state (terrain growth, every creature, the warren and the
 * round), to check that two runs of the same replay came out the same. Whether the round has been
 * paid out is the game's bookkeeping, not the simulation's, and is left out (a watched replay is
 * marked paid so it earns nothing).
 */
export function stateHash(eco: Ecosystem): string {
  const state = eco.snapshot();
  if (state.defense) state.defense = { ...state.defense, rewarded: false };
  const json = JSON.stringify(state, (_k, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as Uint8Array) : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
