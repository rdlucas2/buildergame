import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|js|tsx)$/.test(f) ? [p] : [];
  });
}

describe('the game never touches TypeSafe', () => {
  it('nothing under src/ imports the TypeSafe SDK or reads its API key', () => {
    // The game ships as static files: a key in the bundle would be public. Bots run in Node only.
    const offenders = files('src').filter((f) => /@typesafe-ai|TYPESAFE_API_KEY/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('only the TypeSafe brain and its offline mock use the SDK', () => {
    const users = files('bots').filter((f) => readFileSync(f, 'utf8').includes("from '@typesafe-ai/sdk'"));
    expect(users.sort()).toEqual([join('bots', 'brains', 'mock.ts'), join('bots', 'brains', 'typesafe.ts')]);
  });
});
