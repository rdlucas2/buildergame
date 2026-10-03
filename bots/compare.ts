/**
 * Compares the bots' play styles over several seeds, headless: how long each survives, and how.
 *
 *   npm run bots:compare -- --seeds 5 --profile fresh
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { modifiersFor } from '../src/sim/defense/council';
import { DEFENSE_GROUND } from '../src/sim/defense/replay';
import { clock, type Brain } from './brain';
import { HeuristicBrain } from './brains/heuristic';
import { MockBrain } from './brains/mock';
import { MissingKeyError, TypeSafeBrain } from './brains/typesafe';
import { loadProfile } from './campaign';
import { SimTable } from './drivers/sim';
import { isStyle, PERSONAS, STYLES, type Style } from './personas';
import { playRound } from './play';

const { values: a } = parseArgs({
  options: {
    styles: { type: 'string', default: 'all' },
    seeds: { type: 'string', default: '5' },
    seed: { type: 'string', default: '1' },
    profile: { type: 'string', default: 'fresh' },
    brain: { type: 'string', default: 'heuristic' },
    max: { type: 'string', default: '1800' },
    every: { type: 'string', default: '10' },
    out: { type: 'string', default: 'bot-runs' },
  },
});

const styles = (a.styles === 'all' ? [...STYLES] : a.styles!.split(',')).filter((s): s is Style => {
  if (!isStyle(s)) throw new Error(`Unknown style "${s}"; try ${STYLES.join(', ')}`);
  return true;
});
const seeds = Number(a.seeds);
const first = Number(a.seed);
const modifiers = modifiersFor(loadProfile(a.profile!).upgrades);

function brainFor(style: Style): Brain {
  if (a.brain === 'mock') return new MockBrain(PERSONAS[style]);
  if (a.brain === 'typesafe') {
    try {
      return new TypeSafeBrain(PERSONAS[style]);
    } catch (e) {
      if (e instanceof MissingKeyError) {
        console.error(e.message);
        process.exit(2);
      }
      throw e;
    }
  }
  return new HeuristicBrain(PERSONAS[style]);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

interface Row {
  style: Style;
  times: number[];
  scores: number[];
  kills: number[];
  lost: number[];
  broken: number[];
  waves: number[];
}

const rows: Row[] = [];
const started = Date.now();
for (const style of styles) {
  const row: Row = { style, times: [], scores: [], kills: [], lost: [], broken: [], waves: [] };
  for (let s = first; s < first + seeds; s++) {
    const run = await playRound(new SimTable(s, modifiers), brainFor(style), { seed: s, size: DEFENSE_GROUND, modifiers, every: Number(a.every), maxSeconds: Number(a.max) });
    const r = run.replay.result;
    row.times.push(r.clock);
    row.scores.push(r.score);
    row.kills.push(r.kills);
    row.lost.push(r.rabbitsLost);
    row.broken.push(r.blocksBroken);
    row.waves.push(r.wave);
    process.stdout.write('.');
  }
  rows.push(row);
}
console.log(`\n\n${a.brain} bots, profile ${a.profile}, seeds ${first}–${first + seeds - 1} (${((Date.now() - started) / 1000).toFixed(0)} s)\n`);
const head = ['style', 'median', 'range', 'waves', 'score', 'kills', 'rabbits lost', 'blocks broken'];
const table = rows
  .sort((x, y) => median(y.times) - median(x.times))
  .map((r) => [PERSONAS[r.style].name, clock(median(r.times)), `${clock(Math.min(...r.times))}–${clock(Math.max(...r.times))}`, String(median(r.waves)), String(Math.round(median(r.scores))), String(Math.round(median(r.kills))), String(Math.round(median(r.lost))), String(Math.round(median(r.broken)))]);
const widths = head.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
console.log(line(head));
for (const r of table) console.log(line(r));
console.log('\n(medians over the seeds)');
mkdirSync(a.out!, { recursive: true });
const file = join(a.out!, `compare-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
writeFileSync(file, JSON.stringify({ brain: a.brain, profile: a.profile, seeds: { first, count: seeds }, modifiers, rows }, null, 1));
console.log(`Saved ${file}`);
