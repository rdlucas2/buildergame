/**
 * Records one example replay per play style, for the game to offer under World (M) → Example
 * replays, so anyone can watch what each strategy looks like without running the bots.
 *
 * For each style it plays a few seeds on a fresh profile with the heuristic brain and keeps the
 * round closest to the style's median, so the example is typical, not a lucky or unlucky one.
 * Files go to public/replays/ (served by the game as static files) with an index.json describing
 * them. A unit test replays them, so they fail CI when a rule change makes them stale: run this
 * again then.
 *
 *   npm run bots:examples
 *   npm run bots:examples -- --seeds 8
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { NO_MODIFIERS } from '../src/core/defense-state';
import { encodeReplay } from '../src/core/format/replay-file';
import { DEFENSE_GROUND } from '../src/sim/defense/replay';
import { clock } from './brain';
import { HeuristicBrain } from './brains/heuristic';
import { SimTable } from './drivers/sim';
import { PERSONAS, STYLES } from './personas';
import { playRound, type RoundRun } from './play';

const { values: a } = parseArgs({ options: { seeds: { type: 'string', default: '5' }, out: { type: 'string', default: 'public/replays' } } });
const seeds = Array.from({ length: Number(a.seeds) }, (_, i) => i + 1);
mkdirSync(a.out!, { recursive: true });

/** How a style's round went, for the Worlds panel. */
interface Example {
  style: string;
  name: string;
  brief: string;
  file: string;
  seed: number;
  /** Seconds the warren held out. */
  seconds: number;
  wave: number;
  score: number;
  kills: number;
  /** Notable decisions, in order: [round seconds, what the bot did]. */
  moments: Array<[number, string]>;
}

/** The few decisions that say what the style does, skipping waiting and routine perk picks. */
function moments(run: RoundRun): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  let last = '';
  for (const d of run.decisions) {
    const plain = d.why
      .split(', ')
      .filter((w) => w !== 'wait' && !/ perk$/.test(w))
      .join(', ');
    if (!plain || plain === last) continue;
    last = plain;
    out.push([Math.round(d.clock), plain]);
  }
  // Spread over the round, at most 8.
  if (out.length <= 8) return out;
  return Array.from({ length: 8 }, (_, i) => out[Math.round((i * (out.length - 1)) / 7)]);
}

const index: Example[] = [];
for (const style of STYLES) {
  const rounds: Array<{ seed: number; run: RoundRun }> = [];
  for (const seed of seeds) {
    const table = new SimTable(seed, { ...NO_MODIFIERS });
    rounds.push({ seed, run: await playRound(table, new HeuristicBrain(PERSONAS[style]), { seed, size: DEFENSE_GROUND, modifiers: { ...NO_MODIFIERS }, every: 10, maxSeconds: 1800 }) });
  }
  const times = rounds.map((r) => r.run.final.clock).sort((x, y) => x - y);
  const median = times[Math.floor(times.length / 2)];
  const pick = rounds.reduce((best, r) => (Math.abs(r.run.final.clock - median) < Math.abs(best.run.final.clock - median) ? r : best));
  const res = pick.run.replay.result;
  const file = `${style}.replay.json`;
  writeFileSync(join(a.out!, file), JSON.stringify(encodeReplay(pick.run.replay)));
  index.push({ style, name: PERSONAS[style].name, brief: PERSONAS[style].brief, file, seed: pick.seed, seconds: Math.round(res.clock), wave: res.wave, score: res.score, kills: res.kills, moments: moments(pick.run) });
  console.log(`${PERSONAS[style].name.padEnd(13)} seed ${pick.seed}: held ${clock(res.clock)}, wave ${res.wave}, score ${res.score}, ${res.kills} kills → ${file}`);
}
writeFileSync(join(a.out!, 'index.json'), JSON.stringify({ examples: index }, null, 1) + '\n');
console.log(`Wrote ${index.length} replays and index.json to ${a.out}`);
