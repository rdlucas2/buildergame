/**
 * Balance runner: plays Warren Defense rounds headless with scripted policies over many seeds and
 * reports how long the warren survives. Run with `npm run balance -- --seeds 12 --policy all`.
 */
import { DefenseSession, type DefenseObservation } from '../src/sim/defense/session';
import type { DefenseAction } from '../src/sim/defense/defense';

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
  steady: (o) => steady(o),
  /** Steady, plus iron over the gaps at the start and more budget for it whenever points allow. */
  fortify: (o, s) => {
    const actions = steady(o);
    if (o.clock === 0) {
      for (const p of lintels(s)) actions.push({ type: 'remove', ...p }, { type: 'place', ...p, material: 'iron' });
      for (const p of lookoutSpots(s)) actions.push({ type: 'place', ...p, material: 'lookout' });
    }
    if (o.points >= o.budgetPrice && o.budget - o.cost < 60) actions.push({ type: 'buyBudget' });
    for (const p of lintels(s)) if (s.defense.base.materialAt(p.x, p.y, p.z) !== 'iron') actions.push({ type: 'place', ...p, material: 'iron' });
    return actions;
  },
};

function steady(o: DefenseObservation): DefenseAction[] {
  const actions: DefenseAction[] = [];
  const want = Math.max(4, Math.round((o.rabbits - o.young) * 0.4));
  if (want !== o.allocation) actions.push({ type: 'allocate', defenders: want });
  return actions;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const seeds = Number(arg('seeds', '8'));
const maxSeconds = Number(arg('max', '1800'));
const which = arg('policy', 'all');
const names = which === 'all' ? Object.keys(POLICIES) : which.split(',');

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

for (const name of names) {
  const policy = POLICIES[name];
  if (!policy) throw new Error(`Unknown policy ${name}; try ${Object.keys(POLICIES).join(', ')}`);
  const times: number[] = [];
  const rows: string[] = [];
  const started = Date.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const s = DefenseSession.create({ seed });
    while (!s.over && s.clock < maxSeconds) {
      for (const a of policy(s.observe(), s)) s.apply(a);
      s.advance(10);
    }
    const o = s.observe();
    times.push(o.clock);
    rows.push(`  seed ${String(seed).padStart(3)}  ${fmt(o.clock).padStart(6)}  wave ${String(o.wave).padStart(2)}  kills ${String(o.stats.kills).padStart(4)}  lost ${String(o.stats.rabbitsLost).padStart(3)}  blocks broken ${String(o.stats.blocksBroken).padStart(3)}  score ${o.score}`);
  }
  console.log(`\n${name}: median ${fmt(median(times))}, range ${fmt(Math.min(...times))}–${fmt(Math.max(...times))} over ${seeds} seeds (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  for (const r of rows) console.log(r);
}
