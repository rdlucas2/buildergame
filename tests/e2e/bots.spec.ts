import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { NO_MODIFIERS } from '../../src/core/defense-state';
import { encodeReplay } from '../../src/core/format/replay-file';
import { newProfile } from '../../src/core/profile';
import { DEFENSE_GROUND, runReplay, stateHash } from '../../src/sim/defense/replay';
import { HeuristicBrain } from '../../bots/brains/heuristic';
import { BrowserTable } from '../../bots/drivers/browser';
import { SimTable } from '../../bots/drivers/sim';
import { PERSONAS } from '../../bots/personas';
import { playRound } from '../../bots/play';

const SHOTS = 'tests/e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  await page.evaluate(() => window.__game!.setStartVisible(false));
  return errors;
}

async function frames(page: Page, n = 3): Promise<void> {
  await page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await window.__game!.nextFrame();
  }, n);
}

test('a bot round recorded headless plays back identically in the game', async ({ page }) => {
  const modifiers = { ...NO_MODIFIERS };
  const run = await playRound(new SimTable(21, modifiers), new HeuristicBrain(PERSONAS.sharpshooter), { seed: 21, size: DEFENSE_GROUND, modifiers, every: 10, maxSeconds: 150 });
  expect(run.replay.actions.length).toBeGreaterThan(3);

  const errors = await boot(page);
  const clover = await page.evaluate(() => window.__game!.profile().clover);
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  await page.keyboard.press('KeyM');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#world-replay').click();
  await (await chooser).setFiles({ name: 'sharpshooter.replay.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(encodeReplay(run.replay))) });
  await expect(page.locator('#bot-overlay')).toHaveText(/Replay: sharpshooter \(heuristic\)/);
  await expect(page.locator('#world-panel')).toBeHidden();
  await page.evaluate(() => window.__game!.ecoSpeed(0));

  // It is the bot's round: the viewer can watch, not play.
  const r = await page.evaluate(() => window.__game!.defenseApply({ type: 'callWave' }));
  expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/replay/) });

  // Run to the end of the recording (the clock stops there by itself).
  for (let i = 0; i < 20 && !(await page.evaluate(() => window.__game!.replayState()!.done)); i++) await page.evaluate(() => window.__game!.ecoAdvance(30));
  expect(await page.evaluate(() => window.__game!.replayState())).toEqual({ ticks: run.replay.ticks, tick: run.replay.ticks, done: true });
  await page.evaluate(() => window.__game!.ecoAdvance(30));
  expect(await page.evaluate(() => window.__game!.replayState()!.tick)).toBe(run.replay.ticks);

  // The same round, to the last creature: the simulation in the browser matches Node's.
  expect(await page.evaluate(() => window.__game!.defenseHash())).toBe(run.replay.result.hash);
  const d = await page.evaluate(() => window.__game!.defense()!);
  expect({ score: d.score, wave: d.wave, kills: d.stats.kills }).toEqual({ score: run.replay.result.score, wave: run.replay.result.wave, kills: run.replay.result.kills });
  await page.evaluate(() => window.__game!.setStartVisible(false));
  await frames(page);
  await expect(page.locator('#bot-overlay')).toHaveText(/Replay finished/);
  await page.screenshot({ path: `${SHOTS}/40-replay-finished.png` });
  // Watching pays nothing.
  expect(await page.evaluate(() => window.__game!.profile().clover)).toBe(clover);
  expect(errors).toEqual([]);
});

test('a bot plays the game in the browser, with its overlay, and its replay checks out headless', async ({ page }) => {
  const errors = await boot(page);
  expect(await page.evaluate((p) => window.__game!.importProfile(p), { ...newProfile(), clover: 77 } as unknown as Record<string, unknown>)).toBeNull();
  expect(await page.evaluate(() => window.__game!.profile().clover)).toBe(77);
  expect(await page.evaluate(() => window.__game!.importProfile({ clover: 'lots' }))).toMatch(/Invalid player profile/);
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  await page.evaluate(() => window.__game!.createWorld('Bot: Balanced', 'defense', 33));
  const options = await page.evaluate(() => window.__game!.defenseOptions());
  expect(options.map((o) => o.id)).toContain('wait');
  expect(await page.evaluate(() => window.__game!.defenseAct({ option: 'no-such-move' }))).toMatchObject({ ok: false, applied: [] });

  const modifiers = (await page.evaluate(() => window.__game!.defense()!.modifiers));
  const run = await playRound(new BrowserTable(page, 16), new HeuristicBrain(PERSONAS.balanced), { seed: 33, size: DEFENSE_GROUND, modifiers, every: 10, maxSeconds: 45 });
  expect(run.decisions.length).toBeGreaterThan(3);
  expect(run.decisions.flatMap((x) => x.rejected)).toEqual([]);
  await expect(page.locator('#bot-overlay')).toContainText('Balanced bot · heuristic');
  await frames(page);
  await page.screenshot({ path: `${SHOTS}/41-bot-overlay.png` });
  // Played in Chromium, replayed in Node: the same state at the end.
  expect(stateHash(runReplay(run.replay))).toBe(run.replay.result.hash);
  await page.evaluate(() => window.__game!.botOverlay(null));
  await expect(page.locator('#bot-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});
