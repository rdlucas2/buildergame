import { APIConnectionError, APIError, TypeSafeClient, TypeSafeError, choice, type ChoiceQuestion, type ChoiceResponse, type Fetch, type JsonValue, type Questions, type RetryPolicy } from '@typesafe-ai/sdk';
import type { PlayerProfile } from '../../src/core/profile';
import { describePerk } from '../../src/sim/defense/perks';
import { SCHEDULE } from '../../src/sim/defense/waves';
import { WEAPONS } from '../../src/sim/defense/weapons';
import { clock, type BotAction, type Brain, type CouncilDecision, type CouncilOffer, type Decision, type Probs, type Usage, type View } from '../brain';
import type { Persona } from '../personas';
import { HeuristicBrain } from './heuristic';

/** Shares of grown rabbits the model can choose to make defenders. */
const SHARES = {
  few: { share: 0.2, text: 'About 20% of grown rabbits defend: most breed, so the colony grows fastest and there are many breeders between the predators and the core, but few shoot.' },
  some: { share: 0.35, text: 'About 35% defend: a light guard, most rabbits still breeding.' },
  half: { share: 0.5, text: 'About half defend: as many shooting as breeding.' },
  most: { share: 0.7, text: 'About 70% defend: heavy firepower now, but few breeders: losses are hard to replace, and once the breeders are gone predators go straight for the core.' },
} as const;

/** What each predator does and when it starts coming, for the model's picture of what is ahead. */
const THREATS: Record<string, string> = {
  fox: 'Foxes: fast and weak, and the only predator small enough to slip through the 1-high doorways rabbits use.',
  wolf: 'Wolves: hunt in packs and break through walls, most often the blocks over doorways.',
  badger: 'Badgers: slow diggers that break blocks quickly.',
  tiger: 'Tigers: leap walls up to 3 blocks high (a 4th course stops them), hard to spot, pounce on rabbits.',
  bear: 'Bears: slow, huge tanks that smash walls, cracking the blocks around the one they hit.',
  hawk: 'Hawks: fly over every wall and dive at rabbits that are not under a roof.',
};

export class MissingKeyError extends Error {
  constructor() {
    super(
      'TYPESAFE_API_KEY is not set. The TypeSafe brain needs an API key (from console.typesafe.ai) in the ' +
        'TYPESAFE_API_KEY environment variable, and network access to api.typesafe.ai. In a Claude Code cloud ' +
        'session, add both in the environment settings. To play without it, use --brain heuristic.',
    );
    this.name = 'MissingKeyError';
  }
}

export interface TypeSafeBrainOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** For tests: a stand-in for the HTTP fetch. */
  fetch?: Fetch;
  /** Per-request timeout in milliseconds. */
  timeout?: number;
  /** Retry overrides (tests turn retries off). */
  retry?: Partial<RetryPolicy>;
  /** Told of every request and its answers (or error), to log or print them. */
  onExchange?: (e: Exchange) => void;
  /** 'mock' when the API is the offline stand-in (see `mock.ts`). */
  kind?: 'typesafe' | 'mock';
}

/** One request to the API: what was asked, and what came back. */
export interface Exchange {
  what: 'decision' | 'council';
  state: { [key: string]: JsonValue };
  questions: Questions;
  answers?: Record<string, ChoiceResponse>;
  usage?: Usage;
  error?: string;
}

/** Labels the model chose from, mapped back to what the bot will do. */
type Answers = Record<string, ChoiceResponse>;

/**
 * A persona played by TypeSafe: at each decision point the code lists what is possible, and one
 * `systemOne` request asks the model to choose, with independent `choice` questions (defenders,
 * build move, perk, weapon) answered together over the same state. Every answer is checked against
 * the options offered; anything else, and any API error, falls back to the heuristic brain (and is
 * logged in the decision). Runs only in Node: the key never reaches the game.
 */
export class TypeSafeBrain implements Brain {
  readonly kind: 'typesafe' | 'mock';
  private readonly client: TypeSafeClient;
  private readonly onExchange?: (e: Exchange) => void;
  private readonly fallback: HeuristicBrain;
  /** The last few decisions, so the model sees what it has been doing. */
  private readonly history: string[] = [];

  constructor(
    readonly persona: Persona,
    opts: TypeSafeBrainOptions = {},
  ) {
    const apiKey = opts.apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!apiKey?.trim()) throw new MissingKeyError();
    this.client = new TypeSafeClient({ apiKey, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}), ...(opts.model ? { defaultModel: opts.model } : {}), ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.retry ? { retry: opts.retry } : {}), timeout: opts.timeout ?? 20_000, logLevel: 'off' });
    this.fallback = new HeuristicBrain(persona);
    this.kind = opts.kind ?? 'typesafe';
    this.onExchange = opts.onExchange;
  }

  /** One `systemOne` request, logged either way. */
  private async ask(what: Exchange['what'], state: { [key: string]: JsonValue }, questions: Questions): Promise<{ answers: Record<string, ChoiceResponse>; usage: Usage }> {
    try {
      const res = await this.client.systemOne({ state, questions });
      const answers = res.answers as Record<string, ChoiceResponse>;
      const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens };
      this.onExchange?.({ what, state, questions, answers, usage });
      return { answers, usage };
    } catch (e) {
      this.onExchange?.({ what, state, questions, error: describeError(e) });
      throw e;
    }
  }

  /** The state the model judges: the round, the warren, the rabbits and weapons, as named JSON. */
  state(view: View): { [key: string]: JsonValue } {
    const o = view.obs;
    const ahead = Object.entries(SCHEDULE)
      .filter(([, s]) => s && s.from <= o.clock + 240)
      .map(([kind, s]) => `${s!.from <= o.clock ? 'Now' : `From ${clock(s!.from)}`}: ${THREATS[kind] ?? kind}`);
    return {
      persona: { style: this.persona.name, plays: this.persona.brief },
      round: {
        time_survived: clock(o.clock),
        wave: o.wave,
        next_wave_in_seconds: Math.round(o.nextWaveIn),
        predators_on_the_field: o.predators,
        predators_still_coming_this_wave: o.incoming,
        threats: ahead,
        rules: 'Predators go for breeders first. Once no breeders are left they attack the core, and the round is lost when the core falls. Waves get bigger and tougher every minute; past 20:00 they grow very fast. Every wave adds block budget.',
      },
      warren: {
        core_hit_points: `${o.coreHp} of ${o.coreMax}`,
        free_block_budget: o.budget - o.cost,
        block_budget_next_wave_adds: o.waveBudget,
        points: o.points,
        blocks: o.blocks,
        damaged_blocks: o.damaged,
        points_to_repair_everything: o.repairPrice,
        lookout_posts: o.posts,
        blocks_broken_so_far: o.stats.blocksBroken,
      },
      rabbits: { total: o.rabbits, defenders: o.defenders, breeders: o.breeders, too_young_to_defend: o.young, lost_so_far: o.stats.rabbitsLost },
      weapons: {
        main: o.mainWeapon,
        unlocked: o.unlocked,
        next_unlocks: o.locked.slice(0, 3).map((l) => ({ weapon: l.weapon, progress: `${Math.round(l.progress * 100)}%` })),
      },
      recent_decisions: this.history.slice(-5),
    };
  }

  /** Independent choices over the same state, asked together; perk and weapon only when they apply. */
  questions(view: View): Questions {
    const o = view.obs;
    const q: Record<string, ChoiceQuestion> = {};
    q.defenders = choice(
      'How many grown rabbits should defend the warren (the rest breed, eat and drink), given the threats in `round`, the size of the colony in `rabbits`, and how `persona` likes to play?',
      Object.fromEntries(Object.entries(SHARES).map(([k, v]) => [k, v.text])),
    );
    q.build = choice(
      'Which one of these moves helps the warren survive best right now, given `round.threats`, the state of `warren`, and how `persona` likes to play? Waiting saves budget and points for later.',
      Object.fromEntries(view.options.map((op) => [op.id, `${op.label}: ${op.description}${op.budget ? ` Uses ${op.budget} block budget.` : ''}${op.points ? ` Costs ${op.points} points.` : ''}`])),
    );
    if (o.offer.length > 0) {
      const cards: Record<string, string> = {};
      o.offer.forEach((c, i) => (cards[`card_${i + 1}`] = `${c.rarity} perk: ${describePerk(c)}.`));
      if (o.rerolls > 0) cards.redeal = `Discard these cards and deal new ones (${o.rerolls} redeal${o.rerolls === 1 ? '' : 's'} left this round).`;
      q.perk = choice(`Which perk should the warren take for the rest of the round? Defenders carry the ${o.mainWeapon} (\`weapons.main\`); weapon perks only help the weapons they name. Consider how \`persona\` likes to play.`, cards);
    }
    if (o.unlocked.length > 1) {
      q.weapon = choice(
        'Which unlocked weapon should defenders carry, given the predators in `round` and the warren\'s lookout posts? Splash and piercing help against crowds; range helps from lookouts.',
        Object.fromEntries(o.unlocked.map((id) => {
          const w = WEAPONS[id];
          const extras = [w.pellets ? `${w.pellets} pellets` : '', w.splash ? `blast radius ${w.splash}` : '', w.pierce ? `pierces ${w.pierce}` : '', w.hitscan ? 'instant beam' : ''].filter(Boolean).join(', ');
          return [id, `${w.name}: ${w.damage} damage every ${w.cooldown}s, range ${w.range}${extras ? `, ${extras}` : ''}.`];
        })),
      );
    }
    return q;
  }

  async decide(view: View): Promise<Decision> {
    const questions = this.questions(view);
    let res;
    try {
      res = await this.ask('decision', this.state(view), questions);
    } catch (e) {
      const d = this.fallback.decideNow(view);
      this.remember(view, d.why);
      return { ...d, fallback: describeError(e) };
    }
    const d = this.toDecision(view, res.answers);
    d.usage = res.usage;
    this.remember(view, d.why);
    return d;
  }

  /** Maps the model's answers to actions, checking each against what was offered. */
  toDecision(view: View, answers: Answers): Decision {
    const o = view.obs;
    const actions: BotAction[] = [];
    const why: string[] = [];
    const probs: Record<string, Probs> = {};
    const bad: string[] = [];
    const legal = (name: string, labels: readonly string[]): string | null => {
      const a = answers[name];
      if (!a) return null;
      probs[name] = top(a);
      if (!labels.includes(a.choice)) {
        bad.push(`${name}: "${String(a.choice)}" was not offered`);
        return null;
      }
      return a.choice;
    };

    const share = legal('defenders', Object.keys(SHARES)) as keyof typeof SHARES | null;
    const want = share ? this.fallback.defendersFor(o, SHARES[share].share) : this.fallback.allocation(o)?.defenders ?? o.allocation;
    if (want !== o.allocation) actions.push({ type: 'allocate', defenders: want });
    why.push(`${want} defenders${share ? ` (${share})` : ''}`);

    if (o.offer.length > 0) {
      const labels = [...o.offer.map((_, i) => `card_${i + 1}`), ...(o.rerolls > 0 ? ['redeal'] : [])];
      const pick = legal('perk', labels);
      if (pick === 'redeal') {
        actions.push({ type: 'reroll' });
        why.push('redealt the perks');
      } else {
        const index = pick ? Number(pick.slice(5)) - 1 : this.fallback.bestCard(o);
        actions.push({ type: 'pickPerk', index });
        why.push(`${o.offer[index].rarity} ${o.offer[index].kind} perk`);
      }
    }

    if (o.unlocked.length > 1) {
      const w = legal('weapon', o.unlocked);
      if (w && w !== o.mainWeapon) {
        actions.push({ type: 'equip', weapon: w });
        why.push(`equip the ${w}`);
      }
    }

    const build = legal(
      'build',
      view.options.map((op) => op.id),
    );
    if (build && build !== 'wait') {
      actions.push({ option: build });
      why.push(view.options.find((op) => op.id === build)!.label.toLowerCase());
    } else if (!build) {
      // Not answered sensibly: the heuristic's build move instead.
      for (const op of this.fallback.builds(view)) actions.push({ option: op.id });
    }
    return { actions, why: why.join(', '), probs, ...(bad.length ? { fallback: bad.join('; ') } : {}) };
  }

  async council(profile: PlayerProfile, offers: CouncilOffer[]): Promise<CouncilDecision> {
    if (offers.length === 0) return { buy: null, why: 'nothing affordable' };
    const criteria: Record<string, string> = { save: 'Buy nothing now; keep the Clover for a dearer upgrade later.' };
    for (const u of offers) criteria[u.id] = `${u.name} (level ${u.level} of ${u.maxLevel}, ${u.price} Clover): now ${u.effect}; next level ${u.next}.`;
    const questions = {
      upgrade: choice('Which permanent Warren Council upgrade should be bought next, to survive longer in future rounds, given `profile` and how `persona` likes to play?', criteria),
    };
    const state = {
      persona: { style: this.persona.name, plays: this.persona.brief },
      profile: { clover: profile.clover, best_time_survived: clock(profile.stats.bestTime), rounds_played: profile.stats.rounds, upgrades: profile.upgrades },
    };
    try {
      const res = await this.ask('council', state, questions);
      const a = res.answers.upgrade;
      const usage = res.usage;
      const probs = { upgrade: top(a) };
      if (a.choice === 'save') return { buy: null, why: 'saving Clover', probs, usage };
      const offer = offers.find((u) => u.id === a.choice);
      if (!offer) return { ...this.fallback.councilNow(offers), probs, usage, fallback: `upgrade: "${String(a.choice)}" was not offered` };
      return { buy: offer.id, why: `${offer.name} → ${offer.next}`, probs, usage };
    } catch (e) {
      return { ...this.fallback.councilNow(offers), fallback: describeError(e) };
    }
  }

  private remember(view: View, why: string): void {
    this.history.push(`${clock(view.obs.clock)}: ${why}`);
    if (this.history.length > 20) this.history.shift();
  }
}

/** The three likeliest answers to a choice, most likely first. */
function top(a: ChoiceResponse): Probs {
  return Object.entries(a.probabilities)
    .map(([label, p]) => ({ label, p: Math.round(Number(p) * 1000) / 1000 }))
    .sort((x, y) => y.p - x.p)
    .slice(0, 3);
}

function describeError(e: unknown): string {
  if (e instanceof APIError) return `TypeSafe API error ${e.status ?? ''}: ${e.message}`.trim();
  if (e instanceof APIConnectionError) return `could not reach TypeSafe: ${e.message}`;
  if (e instanceof TypeSafeError) return `TypeSafe: ${e.message}`;
  return `unexpected error: ${(e as Error)?.message ?? String(e)}`;
}
