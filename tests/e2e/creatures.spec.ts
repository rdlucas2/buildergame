import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });
const DAY = 480;

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  await page.evaluate(() => window.__game!.setStartVisible(false));
  return errors;
}

const creatures = (page: Page) => page.evaluate(() => window.__game!.ecoCreatures());
const eco = (page: Page) => page.evaluate(() => window.__game!.eco());

async function frames(page: Page, n = 2): Promise<void> {
  await page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await window.__game!.nextFrame();
  }, n);
}

test('a new wild world has a herd of rabbits that finds food and water', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__game!.createWorld('Warren', true, 12345));
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  const herd = await creatures(page);
  expect(herd).toHaveLength(14);
  await expect(page.locator('#eco-prey')).toHaveText('🐇 14');
  for (const c of herd) expect(c.species).toBe('prey');

  // Look at the herd from close by.
  const cx = herd.reduce((s, c) => s + c.x, 0) / herd.length;
  const cz = herd.reduce((s, c) => s + c.z, 0) / herd.length;
  await page.evaluate(({ cx, cz }) => window.__game!.setPose({ position: [cx, 4, cz + 9], yaw: 0, pitch: -0.38 }), { cx, cz });
  await frames(page);
  await page.screenshot({ path: `${SHOTS}/creatures-herd.png` });

  // A whole day later everyone has eaten and drunk: nobody died of hunger or thirst.
  await page.evaluate((s) => window.__game!.ecoAdvance(s), DAY);
  const info = (await eco(page))!;
  expect(info.tally.hunger + info.tally.thirst).toBe(0);
  expect(info.prey).toBeGreaterThanOrEqual(14);
  const later = await creatures(page);
  for (const c of later) {
    expect(c.hydration).toBeGreaterThan(0.2);
    expect(c.satiety).toBeGreaterThan(0.2);
  }
  await expect(page.locator('#eco-prey')).toHaveText(`🐇 ${info.prey}`);
  expect(errors).toEqual([]);
});

test('the crosshair shows what a rabbit is doing and how it is', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game!.createWorld('Close up', true, 12345));
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  const [c] = await creatures(page);
  // Stand 3 cells south of the rabbit and look down at its middle.
  await page.evaluate((c) => window.__game!.setPose({ position: [c.x, 1.6, c.z + 3], yaw: 0, pitch: -Math.atan2(1.6 - 0.4, 3) }), c);
  await frames(page, 3);
  expect(await page.evaluate(() => window.__game!.ecoHovered())).toBe(c.id);
  const status = page.locator('#hud-status');
  await expect(status).toContainText('Rabbit');
  await expect(status).toContainText(/food \d+% · water \d+% · energy \d+% · health \d+%/);
  await page.screenshot({ path: `${SHOTS}/creatures-hover.png` });

  // Looking away clears it.
  await page.evaluate((c) => window.__game!.setPose({ position: [c.x, 1.6, c.z + 3], yaw: Math.PI, pitch: 0 }), c);
  await frames(page, 3);
  expect(await page.evaluate(() => window.__game!.ecoHovered())).toBeNull();
  await expect(status).not.toContainText('Rabbit');
});

test('the Nature panel counts rabbits and releases more at the crosshair', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game!.createWorld('Release', true, 12345));
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  await page.evaluate((s) => window.__game!.ecoAdvance(s), DAY * 1.5);
  const before = (await eco(page))!;
  // Aim at open ground a little way north of the spawn point.
  await page.evaluate(() => window.__game!.setPose({ position: [0, 6, 20], yaw: 0, pitch: -0.5 }));
  await frames(page);
  await page.keyboard.press('KeyN');
  const panel = page.locator('#nature-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Rabbits');
  await expect(panel.locator('.stat', { hasText: 'Alive' })).toContainText(String(before.prey));
  await expect(panel.locator('#prey-sparkline svg polyline')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/creatures-nature-panel.png` });
  await panel.locator('#release-rabbits').click();
  await expect(panel).toBeHidden();
  const after = (await eco(page))!;
  expect(after.prey).toBe(before.prey + 5);
  const fresh = (await creatures(page)).filter((c) => Math.hypot(c.x - 0, c.z - 9) < 8);
  expect(fresh.length).toBeGreaterThanOrEqual(5);
});

test('rabbits survive a reload and an export/import with their needs intact', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game!.createWorld('Burrow', true, 31337));
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  await page.evaluate((s) => window.__game!.ecoAdvance(s), 200);
  const before = await creatures(page);
  await page.evaluate(() => window.__game!.flushSave());
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  const after = await creatures(page);
  expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
  // The reload runs a moment of 1x time before the pause lands, so allow a little drift.
  for (let i = 0; i < before.length; i++) {
    expect(Math.hypot(after[i].x - before[i].x, after[i].z - before[i].z)).toBeLessThan(8);
    expect(Math.abs(after[i].hydration - before[i].hydration)).toBeLessThan(0.05);
  }

  const b64 = await page.evaluate(() => window.__game!.exportWorldBundleBase64());
  await page.evaluate((b) => window.__game!.importWorldBundleBase64(b), b64);
  const imported = await creatures(page);
  expect(imported.map((c) => c.id)).toEqual(after.map((c) => c.id));
});

test('plain worlds have no creatures', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game!.createWorld('Plain', false));
  expect(await creatures(page)).toEqual([]);
  await expect(page.locator('#eco-strip')).toBeHidden();
});
