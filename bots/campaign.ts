import { readFileSync } from 'node:fs';
import { decodeProfileFile, parseProfile } from '../src/core/format/profile-file';
import { newProfile, type PlayerProfile } from '../src/core/profile';
import { UPGRADES, buyUpgrade, levelsAt, upgradePrice } from '../src/sim/defense/council';
import { finishRound, type RoundResult, type RoundReward } from '../src/sim/defense/rewards';
import type { DefenseObservation } from '../src/sim/defense/session';
import type { Brain, CouncilDecision, CouncilOffer } from './brain';

/** A starting profile: `fresh`, `mid` (half of every upgrade), `max` (all of them), or a profile file. */
export function loadProfile(spec: string): PlayerProfile {
  if (spec === 'fresh') return newProfile();
  if (spec === 'mid' || spec === 'max') return { ...newProfile(), upgrades: levelsAt(spec === 'mid' ? 0.5 : 1) };
  const json: unknown = JSON.parse(readFileSync(spec, 'utf8'));
  return (json as { format?: unknown }).format !== undefined ? decodeProfileFile(json) : parseProfile(json);
}

/** Warren Council upgrades the profile can afford now. */
export function councilOffers(profile: PlayerProfile): CouncilOffer[] {
  return UPGRADES.flatMap((u) => {
    const level = profile.upgrades[u.id] ?? 0;
    const price = upgradePrice(u.id, level);
    return Number.isFinite(price) && price <= profile.clover ? [{ id: u.id, name: u.name, level, maxLevel: u.maxLevel, price, effect: u.effect(level), next: u.effect(level + 1) }] : [];
  });
}

export function roundResultOf(o: DefenseObservation): RoundResult {
  return { clock: o.clock, score: o.score, wave: o.wave, stats: o.stats, unlocked: o.unlocked.length, milestones: o.milestones };
}

export interface CampaignStep {
  profile: PlayerProfile;
  reward: RoundReward;
  earned: string[];
  bought: Array<CouncilDecision & { price: number }>;
}

/** After a round: pays its Clover and achievements, then lets the brain shop at the Warren Council. */
export async function afterRound(brain: Brain, profile: PlayerProfile, final: DefenseObservation): Promise<CampaignStep> {
  const paid = finishRound(profile, roundResultOf(final), new Date().toISOString());
  let p = paid.profile;
  const bought: CampaignStep['bought'] = [];
  for (let i = 0; i < 40; i++) {
    const offers = councilOffers(p);
    if (offers.length === 0) break;
    const d = await brain.council(p, offers);
    if (!d.buy) break;
    const price = offers.find((o) => o.id === d.buy)?.price ?? 0;
    const r = buyUpgrade(p, d.buy);
    if (!r.ok) break;
    p = r.profile;
    bought.push({ ...d, price });
  }
  return { profile: p, reward: paid.reward, earned: paid.earned.map((a) => a.name), bought };
}
