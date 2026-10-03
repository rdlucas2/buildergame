import type { PlayerProfile } from '../src/core/profile';
import type { DefenseAction } from '../src/sim/defense/defense';
import type { DefenseObservation } from '../src/sim/defense/session';
import type { Persona } from './personas';

/** A build move the advisor offers, as a brain sees it (its blocks stay with the driver). */
export interface OptionSummary {
  id: string;
  label: string;
  description: string;
  budget: number;
  points: number;
}

/** What a brain sees at a decision point. */
export interface View {
  obs: DefenseObservation;
  options: OptionSummary[];
}

/** An action, or a build option to apply by id. */
export type BotAction = DefenseAction | { option: string };

/** The top answers to one question, most likely first. */
export type Probs = Array<{ label: string; p: number }>;

export interface Usage {
  input: number;
  output: number;
}

export interface Decision {
  actions: BotAction[];
  /** One line on what the bot chose and why, for the overlay and the report. */
  why: string;
  /** Per question: the model's top answers (TypeSafe brain only). */
  probs?: Record<string, Probs>;
  usage?: Usage;
  /** Why the TypeSafe brain fell back to the heuristic one (for all or part of the decision). */
  fallback?: string;
}

/** An upgrade the Warren Council can sell now. */
export interface CouncilOffer {
  id: string;
  name: string;
  level: number;
  maxLevel: number;
  price: number;
  effect: string;
  next: string;
}

export interface CouncilDecision {
  /** The upgrade to buy next, or null to save the Clover. */
  buy: string | null;
  why: string;
  probs?: Record<string, Probs>;
  usage?: Usage;
  fallback?: string;
}

/** Makes a bot's decisions. Brains never touch the game; drivers apply what they decide. */
export interface Brain {
  /** What decides: plain rules, TypeSafe, or TypeSafe's pipeline against the offline mock. */
  readonly kind: 'heuristic' | 'typesafe' | 'mock';
  readonly persona: Persona;
  decide(view: View): Promise<Decision>;
  /** Between rounds: one Warren Council purchase at a time (asked again until it says null). */
  council(profile: PlayerProfile, offers: CouncilOffer[]): Promise<CouncilDecision>;
}

export const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 } as const;

/** Round time as m:ss. */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
