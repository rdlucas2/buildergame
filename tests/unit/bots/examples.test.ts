import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeReplay } from '../../../src/core/format/replay-file';
import { runReplay, stateHash } from '../../../src/sim/defense/replay';
import { STYLES } from '../../../bots/personas';
import { ReplayIndexSchema } from '../../../src/storage/replay-examples';

const DIR = join('public', 'replays');
const index = ReplayIndexSchema.parse(JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')));

describe('example replays shipped with the game', () => {
  it('has one for every play style', () => {
    expect(index.examples.map((e) => e.style).sort()).toEqual([...STYLES].sort());
  });

  // A rule change that alters how rounds play makes these stale: run `npm run bots:examples`.
  it.each(index.examples.map((e) => [e.style, e] as const))('%s still plays out exactly as recorded', (_style, example) => {
    const replay = decodeReplay(readFileSync(join(DIR, example.file), 'utf8'));
    expect(replay.player.style).toBe(example.style);
    expect(Math.round(replay.result.clock)).toBe(example.seconds);
    const eco = runReplay(replay);
    expect(stateHash(eco)).toBe(replay.result.hash);
  }, 60_000);
});
