import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

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

/** A seeded Warren Defense world that starts paused (speed carries over to new worlds). */
async function defenseWorld(page: Page, name: string, seed = 12345): Promise<void> {
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  await page.evaluate(({ name, seed }) => window.__game!.createWorld(name, 'defense', seed), { name, seed });
}

const info = (page: Page) => page.evaluate(() => window.__game!.defense()!);

async function frames(page: Page, n = 3): Promise<void> {
  await page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await window.__game!.nextFrame();
  }, n);
}

/** Advances the paused round in steps (one long jump would block the page for too long). */
async function advance(page: Page, seconds: number, step = 30): Promise<void> {
  for (let t = 0; t < seconds; t += step) await page.evaluate((s) => window.__game!.ecoAdvance(s), Math.min(step, seconds - t));
}

test('the new-world dialog makes a Warren Defense world with a walled warren', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  await page.keyboard.press('KeyM');
  await page.locator('#world-new').click();
  await expect(page.locator('#new-world-plain')).toBeChecked();
  await page.locator('#new-world-name').fill('Holdout');
  await page.locator('#new-world-defense').check();
  await page.screenshot({ path: `${SHOTS}/defense-new-world-dialog.png` });
  await page.locator('#new-world-create').click();
  await expect(page.locator('#hud-mode')).toHaveText('Warren Defense: Holdout');
  await expect(page.locator('#def-strip')).toBeVisible();
  await expect(page.locator('#def-wave')).toHaveText('First wave in 0:30');
  const d = await info(page);
  expect(d.clock).toBe(0);
  expect(d.cost).toBeLessThanOrEqual(d.budget);
  expect(d.posts).toHaveLength(4);
  await page.keyboard.press('KeyM');
  await expect(page.locator('#world-list .list-row', { hasText: 'Holdout' }).locator('.tag.defense')).toBeVisible();
  await page.keyboard.press('Escape');
  await frames(page);
  await page.screenshot({ path: `${SHOTS}/defense-warren.png` });
  expect(errors).toEqual([]);
});

test('defenders take their posts and drive off the first wave', async ({ page }) => {
  await boot(page);
  await defenseWorld(page, 'First blood');
  await advance(page, 20);
  expect((await info(page)).defenders).toBe(4);
  await advance(page, 40);
  const d = await info(page);
  expect(d.wave).toBe(1);
  expect(d.stats.shots).toBeGreaterThan(0);
  expect(d.stats.kills).toBeGreaterThan(0);
  expect(d.points).toBeGreaterThan(0);
  await expect(page.locator('#def-points')).toHaveText(`★ ${d.points}`);
  await frames(page);
  await page.screenshot({ path: `${SHOTS}/defense-wave-1.png` });

  // More defenders with the + button, fewer with −.
  await page.locator('#def-more').click();
  await page.locator('#def-more').click();
  expect((await info(page)).allocation).toBe(6);
  await page.locator('#def-fewer').click();
  expect((await info(page)).allocation).toBe(5);
});

test('Fortify builds and breaks warren blocks within the budget', async ({ page }) => {
  await boot(page);
  await defenseWorld(page, 'Masonry');
  const start = await info(page);
  // Look straight down at the ground just north of the warren's west wall.
  const spot = { x: start.site.x - 10, z: start.site.z };
  await page.evaluate((p) => window.__game!.setPose({ position: [p.x + 0.5, 8, p.z + 0.5], yaw: 0, pitch: -1.56 }), spot);
  await page.keyboard.press('KeyF');
  await frames(page);
  await expect(page.locator('#hud-mode')).toHaveText('Warren Defense: Masonry — Fortify');
  await expect(page.locator('#hotbar')).toBeVisible();
  expect(await page.evaluate(() => window.__game!.fortifyAim())).toEqual({ voxel: null, place: { x: spot.x, y: 0, z: spot.z } });
  expect(await page.evaluate(() => window.__game!.act(2))).toBe(true); // cobblestone, cost 3
  expect((await info(page)).cost).toBe(start.cost + 3);
  await frames(page);
  expect(await page.evaluate(() => window.__game!.fortifyAim())).toMatchObject({ voxel: { x: spot.x, y: 0, z: spot.z } });
  await page.screenshot({ path: `${SHOTS}/defense-fortify.png` });
  expect(await page.evaluate(() => window.__game!.act(0))).toBe(true);
  expect((await info(page)).cost).toBe(start.cost);

  // Over the budget nothing is built.
  await page.keyboard.press('Digit4'); // iron, cost 8
  const free = start.budget - start.cost;
  // Fill a row along the edge of the buildable area with iron until the budget is nearly spent.
  for (let i = 0; i < Math.floor(free / 8); i++) await page.evaluate((r) => window.__game!.defenseApply({ type: 'place', x: r.x + r.i, y: 0, z: r.z, material: 'iron' }), { ...start.origin, i });
  const full = await info(page);
  expect(full.cost).toBeGreaterThan(full.budget - 8);
  await frames(page);
  expect(await page.evaluate(() => window.__game!.fortifyAim())).toEqual({ voxel: null, place: { x: spot.x, y: 0, z: spot.z } });
  expect(await page.evaluate(() => window.__game!.act(2))).toBe(false);
  await expect(page.locator('.toast', { hasText: 'Over the block budget.' })).toBeVisible();
  await page.keyboard.press('KeyF');
  await expect(page.locator('#hud-mode')).toHaveText('Warren Defense: Masonry');
});

test('the round summary shows when the warren falls, and a new round starts fresh', async ({ page }) => {
  await boot(page);
  await defenseWorld(page, 'Last stand');
  // Nobody defends: the warren falls quickly.
  await page.evaluate(() => window.__game!.defenseApply({ type: 'allocate', defenders: 0 }));
  for (let i = 0; i < 40 && (await info(page)).outcome === 'playing'; i++) await advance(page, 30);
  await frames(page, 4);
  const summary = page.locator('#round-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('Your rabbits held out for');
  await page.screenshot({ path: `${SHOTS}/defense-round-summary.png` });
  await summary.locator('#round-restart').click();
  await expect(summary).toBeHidden();
  const fresh = await info(page);
  expect(fresh.outcome).toBe('playing');
  expect(fresh.clock).toBe(0);
  expect(fresh.wave).toBe(0);
});

test('a defense world keeps its warren and round across a reload', async ({ page }) => {
  await boot(page);
  await defenseWorld(page, 'Keep');
  await advance(page, 45);
  const d = await info(page);
  await page.evaluate((p) => window.__game!.defenseApply({ type: 'place', x: p.x - 10, y: 0, z: p.z, material: 'stone_bricks' }), d.site);
  await page.evaluate(() => window.__game!.flushSave());
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  const back = await info(page);
  expect(back.wave).toBe(d.wave);
  expect(Math.abs(back.clock - d.clock)).toBeLessThan(5);
  expect(back.blocks).toBe(d.blocks + 1);
  await expect(page.locator('#def-strip')).toBeVisible();
});

test.describe('touch', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test('the defense strip fits the portrait touch layout', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('body[data-ready="true"]');
    await defenseWorld(page, 'Pocket fort');
    await advance(page, 40);
    await frames(page);
    const sels = ['#def-strip', '#eco-strip', '#touch-stick', '#touch-actions', '.touch-fly', '.hud-topright', '#hud-mode'];
    const boxes = await Promise.all(sels.map(async (sel) => ({ sel, b: await page.locator(sel).first().boundingBox() })));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].b, c = boxes[j].b;
        if (!a || !c || !a.width || !c.width) continue;
        const overlap = a.x < c.x + c.width - 1 && c.x < a.x + a.width - 1 && a.y < c.y + c.height - 1 && c.y < a.y + a.height - 1;
        expect(overlap, `${boxes[i].sel} overlaps ${boxes[j].sel}`).toBe(false);
      }
    const strip = (await page.locator('#def-strip').boundingBox())!;
    expect(strip.x + strip.width).toBeLessThanOrEqual(412);
    await page.screenshot({ path: `${SHOTS}/defense-touch-portrait.png` });
  });
});
