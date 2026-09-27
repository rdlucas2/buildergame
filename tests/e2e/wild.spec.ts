import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });
const DAY = 480;

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  await page.evaluate(() => window.__game!.setStartVisible(false));
  expect(errors).toEqual([]);
}

const eco = (page: Page) => page.evaluate(() => window.__game!.eco());

test('the new-world dialog offers a Wild world toggle that is off by default', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('KeyM');
  await page.locator('#world-new').click();
  await expect(page.locator('#new-world-dialog')).toBeVisible();
  await expect(page.locator('#new-world-wild')).not.toBeChecked();
  await page.locator('#new-world-name').fill('Plain Land');
  await page.locator('#new-world-create').click();
  await expect(page.locator('#hud-mode')).toHaveText('World: Plain Land');
  expect(await eco(page)).toBeNull();
  await expect(page.locator('#eco-strip')).toBeHidden();
  await expect(page.locator('#hud-mode')).toHaveText('World: Plain Land');

  await page.keyboard.press('KeyM');
  await page.locator('#world-new').click();
  await page.locator('#new-world-name').fill('Wild Land');
  await page.locator('#new-world-wild').check();
  await page.screenshot({ path: `${SHOTS}/wild-new-world-dialog.png` });
  await page.locator('#new-world-create').click();
  await expect(page.locator('#hud-mode')).toHaveText('Wild world: Wild Land');
  const info = await eco(page);
  expect(info).not.toBeNull();
  expect(info!.clock).toBe('Day 1 · 07:00');
  expect(info!.waterCells).toBeGreaterThan(1000);
  await expect(page.locator('#eco-strip')).toBeVisible();
  await expect(page.locator('#hud-mode')).toHaveText('Wild world: Wild Land');

  // The world list marks it; switching back to the plain world turns everything off again.
  await page.keyboard.press('KeyM');
  await expect(page.locator('#world-list .list-row', { hasText: 'Wild Land' }).locator('.tag.wild')).toBeVisible();
  await expect(page.locator('#world-list .list-row', { hasText: 'Plain Land' }).locator('.tag.wild')).toHaveCount(0);
  await page.locator('#world-list .list-row', { hasText: 'Plain Land' }).locator('[data-action="open"]').click();
  await expect(page.locator('#hud-mode')).toHaveText('World: Plain Land');
  expect(await eco(page)).toBeNull();
  await expect(page.locator('#eco-strip')).toBeHidden();
});

test('wild worlds have water, grass, speed controls and a day/night cycle', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game!.createWorld('Seeded', true, 12345));
  const water = await page.evaluate(() => window.__game!.ecoNearestWater(0, 0));
  expect(water).not.toBeNull();
  const w = await page.evaluate((p) => window.__game!.ecoCell(p.x, p.z), water!);
  expect(w).toMatchObject({ water: true, biomass: 0 });
  expect(w!.color![2]).toBeGreaterThan(w!.color![1]); // drawn blue
  const land = await page.evaluate(() => window.__game!.ecoCell(0, 0));
  expect(land).toMatchObject({ water: false, skylit: true });
  expect(land!.biomass).toBeGreaterThan(0);
  expect(land!.color![1]).toBeGreaterThan(land!.color![0]); // drawn green
  await page.evaluate(async () => {
    await window.__game!.nextFrame();
    await window.__game!.nextFrame();
  });
  await page.screenshot({ path: `${SHOTS}/wild-morning.png` });

  // Speed buttons: 16x makes time fly; pause stops it.
  await page.locator('.eco-speed[data-speed="16"]').click();
  const t0 = (await eco(page))!.time;
  await page.waitForTimeout(1000);
  const t1 = (await eco(page))!.time;
  expect(t1 - t0).toBeGreaterThan(3); // 1x would give at most about 1 second; slow renderers drop some frames
  await page.locator('.eco-speed[data-speed="0"]').click();
  const t2 = (await eco(page))!.time;
  await page.waitForTimeout(400);
  expect((await eco(page))!.time).toBe(t2);

  // Night falls: no daylight, the moon icon shows.
  await page.evaluate((s) => window.__game!.ecoAdvance(s), DAY * 0.6);
  const night = (await eco(page))!;
  expect(night.daylight).toBe(0);
  await expect(page.locator('#eco-strip .eco-icon')).toHaveText('☾');
  await page.screenshot({ path: `${SHOTS}/wild-night.png` });
});

test('grass dies under a roof, regrows under open sky, and overlays explain why', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game!.createWorld('Roofs', true, 777));
  const r = await page.evaluate(() => window.__game!.placeAt('example-cottage', { x: 10, y: 0, z: 0 }, 0));
  expect(r?.ok).toBe(true);
  // Inside the cottage footprint (under the roof) and in the open nearby.
  expect(await page.evaluate(() => window.__game!.ecoCell(16, 5)!.skylit)).toBe(false);
  expect(await page.evaluate(() => window.__game!.ecoCell(0, 5)!.skylit)).toBe(true);
  await page.evaluate((s) => window.__game!.ecoAdvance(s), DAY);
  expect(await page.evaluate(() => window.__game!.ecoCell(16, 5)!.biomass)).toBe(0);
  expect(await page.evaluate(() => window.__game!.ecoCell(0, 5)!.biomass)).toBeGreaterThan(200);

  // Overlays: O cycles; the Nature panel sets one directly.
  await page.keyboard.press('KeyO');
  expect((await eco(page))!.overlay).toBe('food');
  await page.keyboard.press('KeyN');
  await expect(page.locator('#nature-panel')).toBeVisible();
  await expect(page.locator('#nature-panel')).toContainText('Grass grows only where sunlight reaches the ground');
  await page.locator('#nature-panel [data-overlay="sky"]').click();
  expect((await eco(page))!.overlay).toBe('sky');
  const covered = await page.evaluate(() => window.__game!.ecoCell(16, 5)!.color!);
  expect(covered[2]).toBeGreaterThan(covered[1]); // purple under the roof
  await page.evaluate(async () => {
    const g = window.__game!;
    g.setPose({ position: [16, 30, 40], yaw: 0, pitch: -0.7 });
    await g.nextFrame();
    await g.nextFrame();
  });
  await page.screenshot({ path: `${SHOTS}/wild-sky-overlay.png` });

  // Remove the cottage: the sky opens and grass grows back.
  await page.evaluate((id) => window.__game!.removePlacement(id!), r!.placementId);
  expect(await page.evaluate(() => window.__game!.ecoCell(16, 5)!.skylit)).toBe(true);
  await page.evaluate((s) => window.__game!.ecoAdvance(s), DAY);
  expect(await page.evaluate(() => window.__game!.ecoCell(16, 5)!.biomass)).toBeGreaterThan(200);
});

test('a wild world keeps its time, terrain and grass across reloads and export/import', async ({ page }) => {
  await boot(page);
  const id = await page.evaluate(() => window.__game!.createWorld('Keeper', true, 4242));
  await page.evaluate(() => window.__game!.placeAt('example-cottage', { x: 10, y: 0, z: 0 }, 0));
  await page.evaluate((s) => window.__game!.ecoAdvance(s), DAY);
  // Time keeps running in real time, so pause it before taking the reference reading.
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  const before = (await eco(page))!;
  const water = (await page.evaluate(() => window.__game!.ecoNearestWater(0, 0)))!;
  await page.evaluate(() => window.__game!.flushSave());
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(() => window.__game!.ecoSpeed(0)); // speed is not saved; stop the clock again
  const after = (await eco(page))!;
  expect(after.seed).toBe(4242);
  // The reload itself takes a moment of 1x time before the pause lands.
  expect(Math.abs(after.time - before.time)).toBeLessThan(3);
  expect(await page.evaluate(() => window.__game!.world().id)).toBe(id);
  expect(await page.evaluate(() => window.__game!.ecoNearestWater(0, 0))).toEqual(water);
  expect(await page.evaluate(() => window.__game!.ecoCell(16, 5)!.biomass)).toBe(0);
  expect(await page.evaluate(() => window.__game!.ecoCell(16, 5)!.skylit)).toBe(false);

  const b64 = await page.evaluate(() => window.__game!.exportWorldBundleBase64());
  const importedId = await page.evaluate((b) => window.__game!.importWorldBundleBase64(b), b64);
  expect(importedId).not.toBe(id);
  const imported = (await eco(page))!;
  expect(imported.seed).toBe(4242);
  expect(Math.abs(imported.time - after.time)).toBeLessThan(0.5); // paused: the bundle carries the exact time
  expect(await page.evaluate(() => window.__game!.ecoCell(16, 5)!.biomass)).toBe(0);
});

test.describe('touch', () => {
  test.use({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true });

  for (const [label, vp] of [
    ['landscape', { width: 915, height: 412 }],
    ['portrait', { width: 412, height: 915 }],
  ] as const) {
    test(`the time strip fits the ${label} touch layout`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/');
      await page.waitForSelector('body[data-ready="true"]');
      await page.evaluate(() => window.__game!.createWorld('Pocket', true, 9));
      await expect(page.locator('#eco-strip')).toBeVisible();
      // The widest the strip gets: three-digit rabbit counts and wolves too.
      await page.evaluate(() => {
        const g = window.__game!;
        g.ecoSpeed(0);
        g.ecoRelease('prey', 0, 0, 100);
        g.ecoRelease('predator', 0, 0, 3);
      });
      await expect(page.locator('#eco-wolves')).toBeVisible();
      const strip = (await page.locator('#eco-strip').boundingBox())!;
      expect(strip.x + strip.width).toBeLessThanOrEqual(vp.width);
      const sels = ['#eco-strip', '#touch-stick', '#touch-actions', '.touch-fly', '.hud-topright', '#touch-secondary', '#hud-mode'];
      const boxes = await Promise.all(sels.map(async (sel) => ({ sel, b: await page.locator(sel).first().boundingBox() })));
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].b, c = boxes[j].b;
          if (!a || !c || !a.width || !c.width) continue;
          const overlap = a.x < c.x + c.width - 1 && c.x < a.x + a.width - 1 && a.y < c.y + c.height - 1 && c.y < a.y + a.height - 1;
          expect(overlap, `${boxes[i].sel} overlaps ${boxes[j].sel}`).toBe(false);
        }
      await page.locator('#eco-nature').tap();
      await expect(page.locator('#nature-panel')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/wild-touch-${label}.png` });
    });
  }
});
