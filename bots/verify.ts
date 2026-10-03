/**
 * Plays saved replays again headless and checks each ends in exactly the recorded state (the same
 * `stateHash`), whether the bot played it headless or in the browser.
 *
 *   npm run bots:verify -- bot-runs/<run>/round-1.replay.json [more files...]
 */
import { readFileSync } from 'node:fs';
import { decodeReplay } from '../src/core/format/replay-file';
import { runReplay, stateHash } from '../src/sim/defense/replay';
import { clock } from './brain';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: npm run bots:verify -- <file.replay.json> [more files...]');
  process.exit(2);
}
let bad = 0;
for (const f of files) {
  const r = decodeReplay(readFileSync(f, 'utf8'));
  const eco = runReplay(r);
  const hash = stateHash(eco);
  const same = hash === r.result.hash;
  if (!same) bad++;
  console.log(`${same ? '✓' : '✗'} ${f}: ${r.player.style} (${r.player.brain}), ${r.actions.length} actions to ${clock(eco.defense!.clock)} → ${hash}${same ? '' : ` (recorded ${r.result.hash})`}`);
}
process.exit(bad ? 1 : 0);
