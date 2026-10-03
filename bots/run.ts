/**
 * Test bots for Warren Defense. Each bot plays rounds in a play style, decided by plain rules
 * (heuristic) or by TypeSafe, headless or in a browser you can watch, and writes a replay and a
 * report per run. See bots/README.md.
 *
 *   npm run bots -- --style balanced --seed 42
 *   npm run bots -- --style all --mode browser --speed 16
 *   npm run bots -- --style sharpshooter --brain typesafe --rounds 3 --profile mid
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { encodeProfileFile } from '../src/core/format/profile-file';
import { encodeReplay } from '../src/core/format/replay-file';
import { modifiersFor } from '../src/sim/defense/council';
import { DEFENSE_GROUND } from '../src/sim/defense/replay';
import { clock, type Brain, type Usage } from './brain';
import { HeuristicBrain } from './brains/heuristic';
import { MissingKeyError, TypeSafeBrain } from './brains/typesafe';
import { afterRound, loadProfile } from './campaign';
import { SimTable } from './drivers/sim';
import { isStyle, PERSONAS, STYLES, type Style } from './personas';
import { playRound, type DecisionLog, type Table } from './play';

const { values: a } = parseArgs({
  options: {
    style: { type: 'string', default: 'balanced' },
    seed: { type: 'string', default: '1' },
    profile: { type: 'string', default: 'fresh' },
    rounds: { type: 'string', default: '1' },
    brain: { type: 'string', default: 'heuristic' },
    model: { type: 'string' },
    mode: { type: 'string', default: 'sim' },
    headed: { type: 'boolean', default: false },
    speed: { type: 'string', default: '16' },
    url: { type: 'string' },
    every: { type: 'string', default: '10' },
    max: { type: 'string', default: '1800' },
    out: { type: 'string', default: 'bot-runs' },
    log: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (a.help) {
  console.log(`npm run bots -- [options]
  --style S      ${STYLES.join(' | ')} | all (default balanced; several with commas)
  --brain B      heuristic (offline, default) | typesafe (needs TYPESAFE_API_KEY)
  --mode M       sim (headless, fast, default) | browser (the real game, recorded to video)
  --headed       show the browser window (browser mode, needs a display)
  --speed N      game speed in browser mode: 1, 4 or 16 (default 16)
  --url U        play the game at this address instead of a local Vite server
  --seed N       first round's seed (each later round adds 1; default 1)
  --profile P    fresh | mid | max | path to a .profile.json (default fresh)
  --rounds N     rounds in a row, with Warren Council purchases between them (default 1)
  --every S      round seconds between decisions (default 10)
  --max S        stop a round still going at this many seconds (default 1800)
  --model M      TypeSafe model (default: the SDK's)
  --out DIR      where runs are written (default bot-runs)
  --log          print every decision`);
  process.exit(0);
}

const styles: Style[] = a.style === 'all' ? [...STYLES] : a.style!.split(',').map((s) => {
  if (!isStyle(s)) fail(`Unknown style "${s}"; try ${STYLES.join(', ')} or all.`);
  return s as Style;
});
const brainKind = a.brain!;
if (brainKind !== 'heuristic' && brainKind !== 'typesafe') fail(`Unknown brain "${brainKind}"; try heuristic or typesafe.`);
const mode = a.mode!;
if (mode !== 'sim' && mode !== 'browser') fail(`Unknown mode "${mode}"; try sim or browser.`);
const speed = Number(a.speed);
if (![1, 4, 16].includes(speed)) fail('--speed must be 1, 4 or 16.');
const seed = Number(a.seed);
const rounds = Math.max(1, Number(a.rounds));
const every = Number(a.every);
const maxSeconds = Number(a.max);

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function makeBrain(style: Style): Brain {
  const persona = PERSONAS[style];
  if (brainKind === 'heuristic') return new HeuristicBrain(persona);
  try {
    return new TypeSafeBrain(persona, { ...(a.model ? { model: a.model } : {}) });
  } catch (e) {
    if (e instanceof MissingKeyError) fail(e.message);
    throw e;
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

for (const style of styles) {
  const brain = makeBrain(style);
  const id = `${stamp}-${style}-${brainKind}-${mode}-s${seed}`;
  const dir = join(a.out!, id);
  mkdirSync(dir, { recursive: true });
  let profile = loadProfile(a.profile!);
  const startProfile = structuredClone(profile);
  const { BrowserSession } = mode === 'browser' ? await import('./drivers/browser') : { BrowserSession: null };
  const session = BrowserSession ? await BrowserSession.open({ headed: a.headed!, videoDir: dir, ...(a.url ? { url: a.url } : {}) }) : null;
  const report: Record<string, unknown>[] = [];
  const usage: Usage = { input: 0, output: 0 };
  let fallbacks = 0;
  console.log(`\n${PERSONAS[style].name} (${brainKind}, ${mode}${mode === 'browser' ? ` at ${speed}×` : ''}) → ${dir}`);
  try {
    for (let r = 0; r < rounds; r++) {
      const s = seed + r;
      const modifiers = modifiersFor(profile.upgrades);
      const table: Table = session ? await session.newRound(`Bot: ${PERSONAS[style].name} ${r + 1}`, s, profile, speed) : new SimTable(s, modifiers);
      const run = await playRound(table, brain, {
        seed: s,
        size: DEFENSE_GROUND,
        modifiers,
        every,
        maxSeconds,
        onDecision: (d: DecisionLog) => {
          if (d.usage) {
            usage.input += d.usage.input;
            usage.output += d.usage.output;
          }
          if (d.fallback) fallbacks++;
          if (a.log) console.log(`  ${clock(d.clock).padStart(6)} w${String(d.wave).padStart(2)}  ${d.why}${d.fallback ? `  [fallback: ${d.fallback}]` : ''}${d.rejected.length ? `  [refused: ${d.rejected.map((x) => x.reason).join('; ')}]` : ''}`);
        },
      });
      const file = join(dir, `round-${r + 1}.replay.json`);
      writeFileSync(file, JSON.stringify(encodeReplay(run.replay), null, 1));
      const step = await afterRound(brain, profile, run.final);
      profile = step.profile;
      const res = run.replay.result;
      console.log(
        `  round ${r + 1} (seed ${s}): ${res.outcome === 'lost' ? 'fell' : 'stopped'} at ${clock(res.clock)}, wave ${res.wave}, score ${res.score}, ${res.kills} kills, ${res.rabbitsLost} rabbit${res.rabbitsLost === 1 ? '' : 's'} and ${res.blocksBroken} block${res.blocksBroken === 1 ? '' : 's'} lost; ` +
          `+${step.reward.total} Clover${step.earned.length ? ` (${step.earned.join(', ')})` : ''}${step.bought.length ? `; bought ${step.bought.map((b) => b.buy).join(', ')}` : ''} [${run.seconds.toFixed(0)} s]`,
      );
      report.push({ round: r + 1, seed: s, modifiers, replay: file, result: res, final: run.final, clover: step.reward, achievements: step.earned, council: step.bought, decisions: run.decisions, seconds: run.seconds });
      if (session) await session.page.evaluate(() => window.__game!.botOverlay(null));
    }
  } finally {
    const video = session ? await session.close() : null;
    writeFileSync(join(dir, 'profile.json'), JSON.stringify(encodeProfileFile(profile), null, 1));
    writeFileSync(
      join(dir, 'report.json'),
      JSON.stringify({ id, style, persona: PERSONAS[style].brief, brain: brainKind, mode, seed, every, maxSeconds, startProfile, endProfile: profile, usage, fallbacks, video, rounds: report }, null, 1),
    );
    if (video) console.log(`  video: ${video}`);
  }
  if (brainKind === 'typesafe') console.log(`  TypeSafe: ${usage.input} input and ${usage.output} output tokens; ${fallbacks} decision(s) fell back to rules.`);
}
