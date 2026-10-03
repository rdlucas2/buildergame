/**
 * The bots' scenario suite: headless, offline, no browser and no tokens. Plays rounds with the
 * heuristic brains (and the TypeSafe brain against its offline mock) and checks the game's rules
 * and balance. Use it to iterate on the game, then confirm with the browser and live TypeSafe.
 *
 *   npm run bots:test              # three seeds, full rounds (a few minutes)
 *   npm run bots:test -- --quick   # one seed, rounds cut at 15:00 (under a minute)
 *   npm run bots:test -- --only core-after-breeders,no-water
 */
import { parseArgs } from 'node:util';
import { Fixtures, SCENARIOS } from './scenarios';

const { values: a } = parseArgs({ options: { quick: { type: 'boolean', default: false }, only: { type: 'string' } } });
const only = a.only ? new Set(a.only.split(',')) : null;
const list = SCENARIOS.filter((s) => !only || only.has(s.name));
if (list.length === 0) {
  console.error(`No such scenario; try ${SCENARIOS.map((s) => s.name).join(', ')}`);
  process.exit(2);
}
const fixtures = new Fixtures({ quick: a.quick });
const started = Date.now();
let failed = 0;
for (const s of list) {
  const t = Date.now();
  let r;
  try {
    r = await s.check(fixtures);
  } catch (e) {
    r = { pass: false, detail: `crashed: ${(e as Error).stack ?? e}` };
  }
  if (!r.pass) failed++;
  console.log(`${r.pass ? '✓' : '✗'} ${s.name.padEnd(24)} ${r.detail}  [${((Date.now() - t) / 1000).toFixed(0)} s]`);
  if (!r.pass) console.log(`    expected: ${s.about}`);
}
console.log(`\n${list.length - failed}/${list.length} scenarios passed${a.quick ? ' (quick)' : ''} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
process.exit(failed ? 1 : 0);
