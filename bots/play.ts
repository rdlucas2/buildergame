import type { DefenseModifiers } from '../src/core/defense-state';
import type { Replay } from '../src/core/format/replay-file';
import type { DefenseAction } from '../src/sim/defense/defense';
import type { ReplayEntry } from '../src/sim/defense/replay';
import type { DefenseObservation } from '../src/sim/defense/session';
import type { BotAction, Brain, Decision, OptionSummary } from './brain';

/** What `act` reports: whether it worked, at which round tick, and the actions that went through. */
export interface ActOutcome {
  ok: boolean;
  reason?: string;
  tick: number;
  applied: DefenseAction[];
}

/**
 * Where a bot plays: the headless simulation, or the game in a browser. The round loop is the same
 * for both; only how time passes and how actions get in differ.
 */
export interface Table {
  readonly mode: 'sim' | 'browser';
  observe(): Promise<DefenseObservation>;
  options(): Promise<OptionSummary[]>;
  act(action: BotAction): Promise<ActOutcome>;
  /** Lets the round run on to round tick `tick` (or until it is lost). */
  runTo(tick: number): Promise<void>;
  /** Holds the round still while the brain thinks, and lets it go again. */
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** `stateHash` of the simulation now. */
  hash(): Promise<string>;
  /** Shows what the bot just did (the browser's overlay; nothing headless). */
  show(text: string): Promise<void>;
}

export interface RoundOptions {
  seed: number;
  size: number;
  modifiers: DefenseModifiers;
  /** Round seconds between decisions; a perk offer waiting is decided on within a second. */
  every: number;
  /** A round still going at this many seconds is stopped. */
  maxSeconds: number;
  /** Stop once this many waves have come (smoke tests). */
  maxWaves?: number;
  onDecision?: (d: DecisionLog) => void;
}

/** One decision point, for the report. */
export interface DecisionLog extends Decision {
  tick: number;
  clock: number;
  wave: number;
  /** Actions that were refused, and why (an option gone stale, a perk already taken...). */
  rejected: Array<{ action: BotAction; reason: string }>;
}

export interface RoundRun {
  replay: Replay;
  decisions: DecisionLog[];
  final: DefenseObservation;
  /** Real seconds the round took to play. */
  seconds: number;
}

/** Plays one round: decides every `every` seconds of round time, acts, and lets the round run on. */
export async function playRound(table: Table, brain: Brain, opts: RoundOptions): Promise<RoundRun> {
  const started = Date.now();
  const decisions: DecisionLog[] = [];
  const actions: ReplayEntry[] = [];
  const step = Math.round(opts.every * 10);
  let next = 0;
  let last = -Infinity;
  for (;;) {
    let o = await table.observe();
    if (o.outcome !== 'playing' || o.clock >= opts.maxSeconds || (opts.maxWaves !== undefined && o.wave >= opts.maxWaves && o.incoming === 0)) break;
    if (o.tick >= next || (o.pendingOffers > 0 && o.tick >= last + 10)) {
      await table.pause();
      o = await table.observe();
      const d = await brain.decide({ obs: o, options: await table.options() });
      const rejected: DecisionLog['rejected'] = [];
      for (const a of d.actions) {
        const r = await table.act(a);
        for (const action of r.applied) actions.push({ tick: r.tick, action });
        if (!r.ok) rejected.push({ action: a, reason: r.reason ?? 'refused' });
      }
      const entry: DecisionLog = { ...d, tick: o.tick, clock: o.clock, wave: o.wave, rejected };
      decisions.push(entry);
      opts.onDecision?.(entry);
      await table.show(overlayText(brain, o, entry));
      last = o.tick;
      next = o.tick + step;
      await table.resume();
    }
    await table.runTo(Math.min(next, o.tick + 10));
  }
  await table.pause();
  const final = await table.observe();
  const replay: Replay = {
    seed: opts.seed,
    size: opts.size,
    modifiers: { ...opts.modifiers },
    player: { style: brain.persona.style, brain: brain.kind },
    actions,
    ticks: final.tick,
    result: {
      clock: final.clock,
      wave: final.wave,
      score: final.score,
      kills: final.stats.kills,
      rabbitsLost: final.stats.rabbitsLost,
      blocksBroken: final.stats.blocksBroken,
      outcome: final.outcome === 'lost' ? 'lost' : 'playing',
      hash: await table.hash(),
    },
  };
  return { replay, decisions, final, seconds: (Date.now() - started) / 1000 };
}

/** The overlay: who is playing, how the round stands, and the last decision with its odds. */
export function overlayText(brain: Brain, o: DefenseObservation, d: DecisionLog): string {
  const t = `${Math.floor(o.clock / 60)}:${String(Math.floor(o.clock % 60)).padStart(2, '0')}`;
  const lines = [
    `🐰 ${brain.persona.name} bot · ${brain.kind === 'typesafe' ? 'TypeSafe' : 'heuristic'}`,
    `${t} · wave ${o.wave} · ${o.rabbits} rabbits (${o.defenders} defending) · ${o.points} pts`,
    `→ ${d.why}`,
  ];
  for (const [q, ps] of Object.entries(d.probs ?? {})) lines.push(`  ${q}: ${ps.map((p) => `${p.label} ${p.p.toFixed(2)}`).join(' · ')}`);
  if (d.usage) lines.push(`  tokens: ${d.usage.input} in / ${d.usage.output} out`);
  if (d.fallback) lines.push(`  ⚠ fell back to rules: ${d.fallback}`);
  return lines.join('\n');
}
