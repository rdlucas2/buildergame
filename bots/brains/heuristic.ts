import type { PerkCard } from '../../src/core/defense-state';
import type { PlayerProfile } from '../../src/core/profile';
import type { DefenseAction } from '../../src/sim/defense/defense';
import type { DefenseObservation } from '../../src/sim/defense/session';
import { WEAPONS } from '../../src/sim/defense/weapons';
import { RARITY_RANK, type BotAction, type Brain, type CouncilDecision, type CouncilOffer, type Decision, type OptionSummary, type View } from '../brain';
import type { BuildKind, Persona } from '../personas';

/** Seconds into a round when walls should go up a course (tigers leap 3 from 8:00). */
const RAISE_FROM = 300;
/** ...and when a roofed nursery is worth it (hawks from 12:00). */
const ROOF_FROM = 540;
/** Build moves taken at one decision point, besides ones that only spend points. */
const BUILDS_PER_DECISION = 1;
/** Options that change the warren's blocks: at most one a decision, as each changes what the others would build. */
const BUILDS = new Set(['rebuild-breaches', 'raise-walls', 'roof-nursery', 'more-lookouts', 'expand-warren', 'reinforce-doorways']);

/**
 * A persona played by plain rules: deterministic, free and offline. The CI smoke tests and the
 * bot comparison use it, and the TypeSafe brain falls back to it when the API can't answer.
 */
export class HeuristicBrain implements Brain {
  readonly kind = 'heuristic' as const;

  constructor(readonly persona: Persona) {}

  async decide(view: View): Promise<Decision> {
    return this.decideNow(view);
  }

  /** The same decision, without the promise (for the TypeSafe brain's fallbacks). */
  decideNow(view: View): Decision {
    const { obs } = view;
    const actions: BotAction[] = [];
    const why: string[] = [];
    const alloc = this.allocation(obs);
    if (alloc) {
      actions.push(alloc);
      why.push(`${alloc.defenders} defenders`);
    }
    const perk = this.perk(obs);
    if (perk) {
      actions.push(perk.action);
      why.push(perk.why);
    }
    for (const o of this.builds(view)) {
      actions.push({ option: o.id });
      why.push(o.label.toLowerCase());
    }
    return { actions, why: why.length ? why.join(', ') : 'wait' };
  }

  /** Defenders for the colony's size: the persona's share of grown rabbits, at least its minimum. */
  allocation(obs: DefenseObservation): Extract<DefenseAction, { type: 'allocate' }> | null {
    const want = this.defendersFor(obs, this.persona.defenders);
    return want !== obs.allocation ? { type: 'allocate', defenders: want } : null;
  }

  defendersFor(obs: DefenseObservation, share: number): number {
    const grown = Math.max(0, obs.rabbits - obs.young);
    return Math.min(obs.rabbits, Math.max(this.persona.minDefenders, Math.round(grown * share)));
  }

  /** The best card on offer for this persona, or a redeal when it is all plain and one is left. */
  perk(obs: DefenseObservation): { action: DefenseAction; why: string } | null {
    if (obs.offer.length === 0) return null;
    const best = Math.max(...obs.offer.map((c) => RARITY_RANK[c.rarity]));
    if (obs.rerolls > 0 && best < this.persona.rerollBelow) return { action: { type: 'reroll' }, why: 'redealt the perks' };
    const index = this.bestCard(obs);
    const c = obs.offer[index];
    return { action: { type: 'pickPerk', index }, why: `${c.rarity} ${c.kind} perk` };
  }

  bestCard(obs: DefenseObservation): number {
    let best = 0;
    let bestScore = -Infinity;
    obs.offer.forEach((c, i) => {
      const s = this.cardScore(obs, c);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    return best;
  }

  cardScore(obs: DefenseObservation, c: PerkCard): number {
    const main = WEAPONS[obs.mainWeapon]?.class;
    // A weapon perk for a class nobody carries is worth little.
    const fits = !c.target || c.target === 'all' || c.target === main || (obs.loadout && Object.keys(obs.loadout).some((w) => obs.loadout[w] > 0 && WEAPONS[w]?.class === c.target));
    return RARITY_RANK[c.rarity] * this.persona.rarity + (this.persona.perks[c.kind] ?? 1) * (fits ? 2 : 0.4);
  }

  /** How much the persona wants a build option now (0 when not now). */
  wantOf(view: View, o: OptionSummary): number {
    const obs = view.obs;
    const kind = o.id as BuildKind;
    const w = this.persona.build[kind] ?? 0;
    if (w <= 0) return 0;
    const free = obs.budget - obs.cost;
    switch (kind) {
      case 'raise-walls':
        return obs.clock >= RAISE_FROM ? w : 0;
      case 'roof-nursery':
        return obs.clock >= ROOF_FROM ? w : 0;
      case 'more-lookouts':
        // Lookout lovers build them at the start; others once defenders outnumber the posts.
        return obs.defenders > obs.posts || (obs.clock < 60 && w >= 5) ? w : 0;
      case 'repair':
        return obs.damaged > 0 && obs.points >= Math.min(obs.repairPrice, 40) ? w : 0;
      case 'buy-budget':
        // Savers buy budget whenever they can, towards the next expansion.
        return free < 60 || this.saving(view) ? w : 0;
      case 'reinforce':
        // Keep a reserve for repairs.
        return obs.points >= o.points * 2 ? w : 0;
      case 'call-wave': {
        const field = Object.values(obs.predators).reduce((s, n) => s + (n ?? 0), 0);
        return obs.clock >= 30 && field === 0 && obs.incoming === 0 ? w : 0;
      }
      default:
        return w;
    }
  }

  /** The most wanted build move, plus any wanted moves that only spend points. */
  builds(view: View): OptionSummary[] {
    const { obs } = view;
    const ranked = view.options
      .filter((o) => o.id !== 'wait')
      .map((o) => ({ o, w: this.wantOf(view, o) }))
      // Saving up for an expansion: only urgent building goes ahead.
      .filter((x) => !this.saving(view) || x.o.budget === 0 || x.o.id === 'expand-warren' || x.w >= 10)
      .filter((x) => x.w > 0)
      .sort((a, b) => b.w - a.w || a.o.id.localeCompare(b.o.id));
    const out: OptionSummary[] = [];
    let builds = 0;
    let points = obs.points;
    let budget = obs.budget - obs.cost;
    for (const { o } of ranked) {
      if (o.points > points || o.budget > budget) continue;
      if (BUILDS.has(o.id) || o.id === 'call-wave') {
        if (builds >= BUILDS_PER_DECISION) continue;
        builds++;
      }
      out.push(o);
      points -= o.points;
      budget -= o.budget;
    }
    return out;
  }

  /** Holding block budget for the next expansion: the persona saves, and there is room to expand. */
  saving(view: View): boolean {
    const cost = view.obs.expansionCost;
    return !!this.persona.saves && cost !== null && cost > view.obs.budget - view.obs.cost;
  }

  async council(_profile: PlayerProfile, offers: CouncilOffer[]): Promise<CouncilDecision> {
    return this.councilNow(offers);
  }

  /** The cheapest of the persona's three most wanted upgrades it can afford, or failing that any. */
  councilNow(offers: CouncilOffer[]): CouncilDecision {
    const rank = (id: string) => {
      const i = this.persona.council.indexOf(id);
      return i < 0 ? 99 : i;
    };
    const wanted = offers.filter((o) => rank(o.id) < 3).sort((a, b) => a.price - b.price || rank(a.id) - rank(b.id));
    const pick = wanted[0] ?? [...offers].sort((a, b) => rank(a.id) - rank(b.id) || a.price - b.price)[0];
    return pick ? { buy: pick.id, why: `${pick.name} → ${pick.next}` } : { buy: null, why: 'nothing affordable' };
  }
}
