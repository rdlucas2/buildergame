import type { Questions } from '@typesafe-ai/sdk';
import { Rng } from '../../src/sim/rng';
import type { PlayerProfile } from '../../src/core/profile';
import type { Brain, CouncilDecision, CouncilOffer, Decision, View } from '../brain';
import type { Persona } from '../personas';
import { HeuristicBrain } from './heuristic';
import { TypeSafeBrain, type Exchange } from './typesafe';

export interface MockOptions {
  /** Share of requests (0–1) answered badly: half with a label that wasn't offered, half with a 500. */
  chaos?: number;
  seed?: number;
  onExchange?: (e: Exchange) => void;
}

/**
 * A stand-in for the TypeSafe API that runs offline and costs nothing: it answers each `choice`
 * question the way the persona's heuristic brain would, with made-up probabilities and a token
 * count estimated from the request's size. The whole TypeSafe pipeline runs against it (the state
 * and questions sent, checking and mapping the answers, falling back) so it can be tested and
 * iterated on without an API key. `chaos` makes some answers wrong, to exercise the fallbacks.
 */
export class MockApi {
  view: View | null = null;
  offers: CouncilOffer[] = [];
  requests = 0;
  private readonly rules: HeuristicBrain;
  private readonly rng: Rng;

  constructor(
    persona: Persona,
    private readonly opts: MockOptions = {},
  ) {
    this.rules = new HeuristicBrain(persona);
    this.rng = new Rng(opts.seed ?? 1);
  }

  readonly fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
    this.requests++;
    const body = JSON.parse(String(init?.body)) as { state: unknown; questions: Questions };
    const chaos = this.opts.chaos ?? 0;
    const roll = chaos > 0 ? this.rng.next() : 1;
    if (roll < chaos / 2) return json(500, { error: { message: 'mock: a server error, on purpose' } });
    const answers: Record<string, unknown> = {};
    for (const [name, q] of Object.entries(body.questions)) {
      if (q.type !== 'choice') continue;
      const labels = Object.keys(q.criteria);
      let pick = this.answer(name, labels);
      if (roll < chaos) pick = 'something-not-offered';
      const rest = labels.length > 1 ? 0.3 / (labels.length - 1) : 0;
      const probabilities = Object.fromEntries(labels.map((l) => [l, l === pick ? 0.7 : rest]));
      answers[name] = { type: 'choice', choice: pick, confidence: 0.7, probabilities };
    }
    const size = JSON.stringify(body).length;
    return json(200, { model: 'mock', answers, usage: { input_tokens: Math.ceil(size / 4), output_tokens: 3 * Object.keys(answers).length } });
  };

  /** What the persona's rules would answer, as one of the labels offered. */
  private answer(name: string, labels: string[]): string {
    const first = labels[0];
    const view = this.view;
    if (name === 'upgrade') return this.rules.councilNow(this.offers).buy ?? 'save';
    if (!view) return first;
    const o = view.obs;
    switch (name) {
      case 'defenders': {
        const shares: Record<string, number> = { few: 0.2, some: 0.35, half: 0.5, most: 0.7 };
        return labels.reduce((best, l) => (Math.abs((shares[l] ?? 9) - this.rules.persona.defenders) < Math.abs((shares[best] ?? 9) - this.rules.persona.defenders) ? l : best), first);
      }
      case 'build': {
        const move = this.rules.builds(view).find((b) => b.budget > 0 || b.id === 'call-wave') ?? this.rules.builds(view)[0];
        return move && labels.includes(move.id) ? move.id : 'wait';
      }
      case 'perk': {
        const p = this.rules.perk(o);
        return p?.action.type === 'reroll' ? 'redeal' : `card_${this.rules.bestCard(o) + 1}`;
      }
      default:
        return first;
    }
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The TypeSafe brain, talking to the offline mock instead of the API. */
export class MockBrain implements Brain {
  readonly kind = 'mock' as const;
  readonly api: MockApi;
  private readonly brain: TypeSafeBrain;

  constructor(
    readonly persona: Persona,
    opts: MockOptions = {},
  ) {
    this.api = new MockApi(persona, opts);
    this.brain = new TypeSafeBrain(persona, { apiKey: 'mock', fetch: this.api.fetch, retry: { maxRetries: 0 }, kind: 'mock', ...(opts.onExchange ? { onExchange: opts.onExchange } : {}) });
  }

  decide(view: View): Promise<Decision> {
    this.api.view = view;
    return this.brain.decide(view);
  }

  council(profile: PlayerProfile, offers: CouncilOffer[]): Promise<CouncilDecision> {
    this.api.offers = offers;
    return this.brain.council(profile, offers);
  }
}
