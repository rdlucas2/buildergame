import type { DefenseModifiers } from '../../src/core/defense-state';
import { buildOptions, expand } from '../../src/sim/defense/advisor';
import type { DefenseAction } from '../../src/sim/defense/defense';
import { DEFENSE_GROUND, stateHash } from '../../src/sim/defense/replay';
import { DefenseSession } from '../../src/sim/defense/session';
import type { BotAction, OptionSummary } from '../brain';
import type { ActOutcome, Table } from '../play';

/** A bot's table in the headless simulation: no browser, as fast as the CPU allows. */
export class SimTable implements Table {
  readonly mode = 'sim' as const;
  readonly session: DefenseSession;
  readonly size = DEFENSE_GROUND;

  /** `onTick` sees the round after every tick (scenario checks watch for things happening). */
  constructor(
    seed: number,
    modifiers: DefenseModifiers,
    private readonly onTick?: (s: DefenseSession) => void,
  ) {
    this.session = DefenseSession.create({ seed, modifiers, size: this.size });
  }

  async observe() {
    return this.session.observe();
  }

  async options(): Promise<OptionSummary[]> {
    return buildOptions(this.session.defense).map(({ actions: _a, ...o }) => o);
  }

  async act(input: BotAction): Promise<ActOutcome> {
    const d = this.session.defense;
    const tick = d.tickIndex;
    const list = expand(d, input);
    if (!list) return { ok: false, reason: `No option "${(input as { option: string }).option}" right now.`, tick, applied: [] };
    const applied: DefenseAction[] = [];
    for (const a of list) {
      const r = d.apply(a);
      if (!r.ok) return { ok: false, reason: r.reason, tick, applied };
      applied.push(structuredClone(a));
    }
    return { ok: true, tick, applied };
  }

  async runTo(tick: number): Promise<void> {
    const d = this.session.defense;
    while (!d.over && d.tickIndex < tick) {
      this.session.eco.tick();
      this.onTick?.(this.session);
    }
  }

  async pause(): Promise<void> {}
  async resume(): Promise<void> {}

  async hash(): Promise<string> {
    return stateHash(this.session.eco);
  }

  async show(): Promise<void> {}
}
