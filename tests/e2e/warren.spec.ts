import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newProfile } from '../../src/core/profile';
import { levelsAt } from '../../src/sim/defense/council';

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

async function defenseWorld(page: Page, name: string, seed = 12345): Promise<void> {
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  await page.evaluate(({ name, seed }) => window.__game!.createWorld(name, 'defense', seed), { name, seed });
  await page.evaluate(() => window.__game!.ecoSpeed(0));
}

const info = (page: Page) => page.evaluate(() => window.__game!.defense()!);

async function frames(page: Page, n = 3): Promise<void> {
  await page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await window.__game!.nextFrame();
  }, n);
}

async function advance(page: Page, seconds: number, step = 10): Promise<void> {
  for (let t = 0; t < seconds; t += step) await page.evaluate((s) => window.__game!.ecoAdvance(s), Math.min(step, seconds - t));
}

test('the core sits in the middle of the warren, its health shows in the strip, and speeds suit building', async ({ page }) => {
  const errors = await boot(page);
  await defenseWorld(page, 'Core');
  const d = await info(page);
  // The core: 2×2, 2 high, in the middle; the strip shows its health.
  await expect(page.locator('#def-core')).toHaveText('❤ 1500');
  await expect(page.locator('#def-core')).toHaveAttribute('title', /once no breeders are left/);
  const removed = await page.evaluate((s) => window.__game!.defenseApply({ type: 'remove', x: s.x, y: 0, z: s.z }), d.site);
  expect(removed).toMatchObject({ ok: false, reason: expect.stringMatching(/core can't be removed/) });
  // Warren Defense has its own speeds: pause, 1×, 1.5×, 2×, 3×.
  await expect(page.locator('#eco-strip .eco-speed')).toHaveText(['❚❚', '1×', '1.5×', '2×', '3×']);
  await page.locator('#eco-strip .eco-speed[data-speed="1.5"]').click();
  expect((await page.evaluate(() => window.__game!.eco()!)).speed).toBe(1.5);
  // P pauses, and carries on at the same speed.
  await page.keyboard.press('KeyP');
  expect((await page.evaluate(() => window.__game!.eco()!)).speed).toBe(0);
  await expect(page.locator('.toast', { hasText: 'Paused' })).toBeVisible();
  await page.keyboard.press('KeyP');
  expect((await page.evaluate(() => window.__game!.eco()!)).speed).toBe(1.5);
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  // Every wave brings more budget.
  await advance(page, 35);
  const after = await info(page);
  expect(after.wave).toBe(1);
  expect(after.budget).toBe(d.budget + 30);
  await expect(page.locator('.toast', { hasText: '+30 block budget' })).toBeVisible();
  // No water needed: nobody goes to drink.
  const creatures = await page.evaluate(() => window.__game!.ecoCreatures());
  expect(creatures.filter((c) => c.species === 'prey').every((c) => c.hydration === 1)).toBe(true);
  await page.evaluate((s) => window.__game!.setPose({ position: [s.x + 0.5, 9, s.z + 7], yaw: 0, pitch: -0.75 }), d.site);
  await frames(page);
  await page.screenshot({ path: `${SHOTS}/50-warren-core.png` });
  expect(errors).toEqual([]);
});

test('a warren full of lookout posts: every post flies a flag and defenders man them', async ({ page }) => {
  const errors = await boot(page);
  // Every Warren Council upgrade: a big starting budget and more rabbits.
  expect(await page.evaluate((p) => window.__game!.importProfile(p), { ...newProfile(), upgrades: levelsAt(1) } as unknown as Record<string, unknown>)).toBeNull();
  await defenseWorld(page, 'Lookouts');
  const d = await info(page);
  // Every block of the walls' top course becomes a lookout post (15×15, walls 3 high): the posts
  // stay level with the walkway, so defenders can walk from one to the next.
  const placed = await page.evaluate((s) => {
    const cells: Array<{ x: number; z: number }> = [];
    for (let i = -7; i <= 7; i++)
      for (const [x, z] of [
        [s.x + i, s.z - 7],
        [s.x + i, s.z + 7],
        [s.x - 7, s.z + i],
        [s.x + 7, s.z + i],
      ])
        if (!cells.some((c) => c.x === x && c.z === z)) cells.push({ x, z });
    let n = 0;
    for (const c of cells) {
      window.__game!.defenseApply({ type: 'remove', x: c.x, y: 2, z: c.z });
      if (window.__game!.defenseApply({ type: 'place', x: c.x, y: 2, z: c.z, material: 'lookout' }).ok) n++;
    }
    return n;
  }, d.site);
  expect(placed).toBe(56);
  const full = await info(page);
  // The corners keep their raised posts on top.
  expect(full.posts).toHaveLength(56);
  // As many rabbits as the warren holds, as many defending as can.
  await page.evaluate((s) => window.__game!.ecoRelease('prey', s.x, s.z, 40), d.site);
  await page.evaluate(() => window.__game!.defenseApply({ type: 'allocate', defenders: 60 }));
  await advance(page, 25, 5);
  const manned = await info(page);
  expect(manned.defenders).toBeGreaterThan(30);
  expect(manned.manned).toBeGreaterThan(25);

  // From above, a corner of the sky; then along the south wall.
  await page.evaluate((s) => window.__game!.setPose({ position: [s.x + 19, 17, s.z + 19], yaw: Math.PI / 4, pitch: -0.62 }), d.site);
  await frames(page, 4);
  await page.screenshot({ path: `${SHOTS}/51-lookouts-overview.png` });
  await page.evaluate((s) => window.__game!.setPose({ position: [s.x + 11, 6.5, s.z + 13], yaw: 0.55, pitch: -0.22 }), d.site);
  await frames(page, 4);
  await page.screenshot({ path: `${SHOTS}/52-lookouts-wall.png` });

  // Fortify: the lookout post is the flagged block on the bar.
  await page.keyboard.press('KeyF');
  await page.keyboard.press('Digit5');
  await expect(page.locator('#hotbar .block-slot.selected .slot-name')).toHaveText('Lookout post');
  await expect(page.locator('.toast', { hasText: 'Lookout post: A defender stands on top and shoots from it, and every defender needs one.' })).toBeVisible();
  await expect(page.locator('#hud-status')).toContainText(/56 posts, \d+ manned/);
  await frames(page, 2);
  await page.screenshot({ path: `${SHOTS}/53-lookouts-fortify.png` });
  expect(errors).toEqual([]);
});
