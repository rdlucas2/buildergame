import { NO_MODIFIERS, type DefenseModifiers } from '../src/core/defense-state';
import { modifiersFor } from '../src/sim/defense/council';
import { DEFENSE_GROUND, runReplay, stateHash } from '../src/sim/defense/replay';
import type { DefenseSession } from '../src/sim/defense/session';
import { clock, type Brain } from './brain';
import { HeuristicBrain } from './brains/heuristic';
import { MockBrain } from './brains/mock';
import { loadProfile } from './campaign';
import { SimTable } from './drivers/sim';
import { PERSONAS, STYLES, type Style } from './personas';
import { playRound, type RoundRun } from './play';

/** What a scenario run learned beyond the replay: things the round's own record doesn't keep. */
export interface Watched {
  run: RoundRun;
  style: Style;
  seed: number;
  startBudget: number;
  /** When the core was first hurt, and whether any breeder was alive then. */
  coreHit: { clock: number; breeders: boolean } | null;
  thirst: number;
  drinkers: number;
}

export interface Settings {
  /** Fewer seeds and shorter rounds, for a quick check while iterating. */
  quick: boolean;
}

/** Plays one headless round, watching for what the scenarios check. */
export async function watchRound(style: Style, seed: number, modifiers: DefenseModifiers, brain: Brain, maxSeconds: number): Promise<Watched> {
  let coreHit: Watched['coreHit'] = null;
  let drinkers = 0;
  const onTick = (s: DefenseSession) => {
    const d = s.defense;
    if (!coreHit && d.base.coreDamage > 0) coreHit = { clock: d.clock, breeders: d.breedersLeft() };
    if (d.tickIndex % 50 === 0) for (const c of s.eco.population.creatures) if (c.deadFor < 0 && (c.activity === 'drink' || c.activity === 'seekWater')) drinkers++;
  };
  const table = new SimTable(seed, modifiers, onTick);
  const startBudget = table.session.defense.budget;
  const run = await playRound(table, brain, { seed, size: DEFENSE_GROUND, modifiers, every: 10, maxSeconds });
  return { run, style, seed, startBudget, coreHit, thirst: table.session.eco.population.tally.thirst, drinkers };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Rounds every scenario shares, played once: each style on a fresh profile, and balanced on a maxed one. */
export class Fixtures {
  private fresh: Promise<Watched[]> | null = null;
  private max: Promise<Watched[]> | null = null;

  constructor(readonly settings: Settings) {}

  get seeds(): number[] {
    return this.settings.quick ? [1] : [1, 2, 3];
  }

  get maxSeconds(): number {
    return this.settings.quick ? 900 : 1800;
  }

  freshRounds(): Promise<Watched[]> {
    this.fresh ??= (async () => {
      const out: Watched[] = [];
      for (const style of STYLES) for (const seed of this.seeds) out.push(await watchRound(style, seed, { ...NO_MODIFIERS }, new HeuristicBrain(PERSONAS[style]), this.maxSeconds));
      return out;
    })();
    return this.fresh;
  }

  maxRounds(): Promise<Watched[]> {
    this.max ??= (async () => {
      const modifiers = modifiersFor(loadProfile('max').upgrades);
      const out: Watched[] = [];
      for (const seed of this.seeds) out.push(await watchRound('balanced', seed, modifiers, new HeuristicBrain(PERSONAS.balanced), this.maxSeconds));
      return out;
    })();
    return this.max;
  }
}

export interface Outcome {
  pass: boolean;
  detail: string;
}

export interface Scenario {
  name: string;
  about: string;
  check(f: Fixtures): Promise<Outcome>;
}

/**
 * What the bots check, headless and offline: the rules hold (predators take breeders before the
 * core, nobody needs water, the budget grows, every move is legal, replays repeat exactly), the
 * balance is in range, and the TypeSafe brain's pipeline works end to end against the mock.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'fresh-balance',
    about: 'On a fresh profile every style lasts at least 5:00, and none lasts past 15:00 (median).',
    async check(f) {
      const runs = await f.freshRounds();
      const by = STYLES.map((s) => ({ s, t: median(runs.filter((r) => r.style === s).map((r) => r.run.final.clock)) }));
      const bad = by.filter((x) => x.t < 300 || x.t > 900);
      return { pass: bad.length === 0, detail: by.map((x) => `${x.s} ${clock(x.t)}`).join(', ') };
    },
  },
  {
    name: 'upgrades-help',
    about: 'Every Warren Council upgrade: balanced lasts longer than on a fresh profile, and at least 12:00.',
    async check(f) {
      const fresh = median((await f.freshRounds()).filter((r) => r.style === 'balanced').map((r) => r.run.final.clock));
      const max = median((await f.maxRounds()).map((r) => r.run.final.clock));
      return { pass: max > fresh && max >= 720, detail: `fresh ${clock(fresh)}, max ${clock(max)}` };
    },
  },
  {
    name: 'core-after-breeders',
    about: 'Predators only hurt the core once no breeders are left.',
    async check(f) {
      const runs = [...(await f.freshRounds()), ...(await f.maxRounds())];
      const early = runs.filter((r) => r.coreHit?.breeders);
      const hit = runs.filter((r) => r.coreHit);
      return { pass: early.length === 0, detail: `${hit.length}/${runs.length} rounds reached the core${early.length ? `; ${early.length} while breeders lived (${early.map((r) => `${r.style} seed ${r.seed} at ${clock(r.coreHit!.clock)}`).join(', ')})` : ''}` };
    },
  },
  {
    name: 'rounds-end-at-the-core',
    about: 'Every round that ends, ends because the core fell.',
    async check(f) {
      const runs = [...(await f.freshRounds()), ...(await f.maxRounds())];
      const lost = runs.filter((r) => r.run.final.outcome === 'lost');
      const odd = lost.filter((r) => r.run.final.coreHp > 0);
      return { pass: odd.length === 0, detail: `${lost.length}/${runs.length} rounds lost, all with the core down${odd.length ? `; ${odd.length} with it standing` : ''}` };
    },
  },
  {
    name: 'no-water',
    about: 'No rabbit dies of thirst or goes to drink.',
    async check(f) {
      const runs = await f.freshRounds();
      const thirst = runs.reduce((s, r) => s + r.thirst, 0);
      const drink = runs.reduce((s, r) => s + r.drinkers, 0);
      return { pass: thirst === 0 && drink === 0, detail: `${thirst} died of thirst, ${drink} seen drinking` };
    },
  },
  {
    name: 'budget-grows',
    about: 'Every wave adds block budget.',
    async check(f) {
      const runs = await f.freshRounds();
      const short = runs.filter((r) => r.run.final.budget < r.startBudget + 30 * r.run.final.wave);
      return { pass: short.length === 0, detail: `budget went from ${runs[0].startBudget} to ${median(runs.map((r) => r.run.final.budget))} (median at the end)` };
    },
  },
  {
    name: 'legal-moves',
    about: 'The bots never try a move the game refuses.',
    async check(f) {
      const runs = await f.freshRounds();
      const refused = runs.flatMap((r) => r.run.decisions.flatMap((d) => d.rejected.map((x) => `${r.style}: ${x.reason}`)));
      return { pass: refused.length === 0, detail: refused.length ? refused.slice(0, 3).join('; ') : `${runs.reduce((s, r) => s + r.run.replay.actions.length, 0)} actions, none refused` };
    },
  },
  {
    name: 'replays-repeat',
    about: 'Every round replays to exactly the same state.',
    async check(f) {
      const runs = await f.freshRounds();
      const bad = runs.filter((r) => stateHash(runReplay(r.run.replay)) !== r.run.replay.result.hash);
      return { pass: bad.length === 0, detail: `${runs.length - bad.length}/${runs.length} replays matched` };
    },
  },
  {
    name: 'typesafe-pipeline',
    about: "The TypeSafe brain plays a round against the offline mock with no fallbacks; with broken answers it falls back and plays on.",
    async check(f) {
      const max = f.settings.quick ? 180 : 420;
      const clean = new MockBrain(PERSONAS.balanced);
      const a = await watchRound('balanced', 4, { ...NO_MODIFIERS }, clean, max);
      const messy = new MockBrain(PERSONAS.balanced, { chaos: 0.4, seed: 2 });
      const b = await watchRound('balanced', 4, { ...NO_MODIFIERS }, messy, max);
      const fa = a.run.decisions.filter((d) => d.fallback).length;
      const fb = b.run.decisions.filter((d) => d.fallback).length;
      const pass = clean.api.requests > 5 && fa === 0 && fb > 0 && b.run.decisions.length > 5 && a.run.decisions.every((d) => d.usage);
      return { pass, detail: `${clean.api.requests} requests, ${fa} fallbacks; with chaos ${fb}/${b.run.decisions.length} decisions fell back` };
    },
  },
];
