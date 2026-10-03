/**
 * Balance runner: plays Warren Defense rounds headless with scripted policies over many seeds and
 * reports how long the warren survives. Run with `npm run balance -- --seeds 12 --policy all`.
 */
import type { DefenseModifiers } from '../src/core/defense-state';
import { DefenseSession, type DefenseObservation } from '../src/sim/defense/session';
import type { DefenseAction } from '../src/sim/defense/defense';
import { WEAPONS } from '../src/sim/defense/weapons';
import { levelsAt, modifiersFor } from '../src/sim/defense/council';

type Policy = (o: DefenseObservation, s: DefenseSession) => DefenseAction[];

/** Blocks right above a 1-high gap in the warren's walls: where wolves break in. */
function lintels(s: DefenseSession): Array<{ x: number; y: number; z: number }> {
  const base = s.defense.base;
  const out: Array<{ x: number; y: number; z: number }> = [];
  const { origin, size } = base;
  for (let z = origin.z; z < origin.z + size.z; z++)
    for (let x = origin.x; x < origin.x + size.x; x++)
      if (!base.solidAt(x, 0, z) && base.solidAt(x, 1, z) && base.solidAt(x - 1, 0, z) !== base.solidAt(x, 0, z - 1)) out.push({ x, y: 1, z });
  return out;
}

/** Wall-top cells every few blocks along the warren's outer walls: room for more lookouts. */
function lookoutSpots(s: DefenseSession): Array<{ x: number; y: number; z: number }> {
  const base = s.defense.base;
  const f = base.footprint();
  if (!f) return [];
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let z = f.z0; z <= f.z1; z++)
    for (let x = f.x0; x <= f.x1; x++) {
      const edge = x === f.x0 || x === f.x1 || z === f.z0 || z === f.z1;
      if (!edge || (x - f.x0) % 4 !== 0 || (z - f.z0) % 4 !== 0) continue;
      for (let y = 1; y < base.size.y - 1; y++)
        if (base.solidAt(x, y - 1, z) && !base.solidAt(x, y, z) && !base.solidAt(x, y + 1, z)) {
          if (base.materialAt(x, y - 1, z) !== 'lookout') out.push({ x, y, z });
          break;
        }
    }
  return out;
}

/** Simple scripted players, from doing nothing to sensible housekeeping. */
const POLICIES: Record<string, Policy> = {
  /** A control: nobody defends, so this shows what the defenders are worth. */
  undefended: (o) => (o.allocation ? [{ type: 'allocate', defenders: 0 }] : []),
  passive: () => [],
  /** More defenders as the colony grows, and the first perk card offered. */
  steady: (o) => steady(o),
  /**
   * Steady, picking the best perk for the main weapon; more lookouts at the start; the lintels over
   * the gaps rebuilt in the strongest unlocked material; repairs, stone strength and budget as
   * points allow.
   */
  fortify: (o, s) => {
    const actions = steady(o, bestPerk(o));
    if (o.clock === 0) for (const p of lookoutSpots(s)) actions.push({ type: 'place', ...p, material: 'lookout' });
    const best = o.tiers >= 5 ? 'iron' : o.tiers >= 4 ? 'stone_bricks' : 'cobblestone';
    for (const p of lintels(s)) {
      const m = s.defense.base.materialAt(p.x, p.y, p.z);
      if (m === best) continue;
      if (m) actions.push({ type: 'remove', ...p });
      actions.push({ type: 'place', ...p, material: best });
    }
    let points = o.points;
    if (o.repairPrice > 0 && points >= Math.min(o.repairPrice, 40)) {
      actions.push({ type: 'repair' });
      points -= o.repairPrice;
    }
    if (points >= o.budgetPrice && o.budget - o.cost < 60) {
      actions.push({ type: 'buyBudget' });
      points -= o.budgetPrice;
    }
    if (points >= o.strengthPrices[2] * 2) actions.push({ type: 'strengthen', tier: 2 });
    return actions;
  },
};

function steady(o: DefenseObservation, perk = 0): DefenseAction[] {
  const actions: DefenseAction[] = [];
  const want = Math.max(4, Math.round((o.rabbits - o.young) * 0.4));
  if (want !== o.allocation) actions.push({ type: 'allocate', defenders: want });
  if (o.offer.length > 0) actions.push({ type: 'pickPerk', index: perk });
  return actions;
}

const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

/** The card that helps the main weapon most (or failing that, the rarest). */
function bestPerk(o: DefenseObservation): number {
  const main = WEAPONS[o.mainWeapon].class;
  let best = 0;
  let bestScore = -Infinity;
  o.offer.forEach((c, i) => {
    let score = RARITY_RANK[c.rarity] * 2;
    if (c.target === main || c.target === 'all') score += c.kind === 'damage' || c.kind === 'rate' || c.kind === 'multishot' ? 4 : 2;
    if (c.kind === 'armour' || c.kind === 'regen') score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Permanent upgrades to test with: none, half of every Warren Council upgrade, and all of them. */
const PROFILES: Record<string, Partial<DefenseModifiers>> = {
  fresh: {},
  mid: modifiersFor(levelsAt(0.5)),
  max: modifiersFor(levelsAt(1)),
};

const seeds = Number(arg('seeds', '8'));
const profiles = arg('profile', 'fresh').split(',');
const maxSeconds = Number(arg('max', '1800'));
const which = arg('policy', 'all');
const names = which === 'all' ? Object.keys(POLICIES) : which.split(',');

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

for (const profile of profiles) for (const name of names) {
  const modifiers = PROFILES[profile];
  if (!modifiers) throw new Error(`Unknown profile ${profile}; try ${Object.keys(PROFILES).join(', ')}`);
  const policy = POLICIES[name];
  if (!policy) throw new Error(`Unknown policy ${name}; try ${Object.keys(POLICIES).join(', ')}`);
  const times: number[] = [];
  const rows: string[] = [];
  const started = Date.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const s = DefenseSession.create({ seed, modifiers });
    while (!s.over && s.clock < maxSeconds) {
      for (const a of policy(s.observe(), s)) s.apply(a);
      s.advance(10);
    }
    const o = s.observe();
    times.push(o.clock);
    rows.push(`  seed ${String(seed).padStart(3)}  ${fmt(o.clock).padStart(6)}  wave ${String(o.wave).padStart(2)}  kills ${String(o.stats.kills).padStart(4)}  lost ${String(o.stats.rabbitsLost).padStart(3)}  blocks broken ${String(o.stats.blocksBroken).padStart(3)}  score ${String(o.score).padStart(6)}  ${o.mainWeapon}, ${o.perks} perks`);
  }
  console.log(`\n${profile} ${name}: median ${fmt(median(times))}, range ${fmt(Math.min(...times))}–${fmt(Math.max(...times))} over ${seeds} seeds (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  for (const r of rows) console.log(r);
}
