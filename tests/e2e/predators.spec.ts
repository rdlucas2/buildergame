import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });
const DAY = 480;
/** The first wolf pack arrives this many seconds into a new world (about 17:30 on day 1). */
const FIRST_PACK = DAY * 0.44;

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  await page.evaluate(() => window.__game!.setStartVisible(false));
  return errors;
}

/**
 * Creates a seeded wild world that starts paused. Speed carries over to a new world, so pausing
 * first means the simulation doesn't move in real time before the test looks at it.
 */
async function wildWorld(page: Page, name: string, seed: number): Promise<void> {
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  await page.evaluate(({ name, seed }) => window.__game!.createWorld(name, true, seed), { name, seed });
  // Not a single tick has run: the world is exactly as created (07:00 on day 1).
  expect(await page.evaluate(() => window.__game!.eco()!.time)).toBe((480 * 7) / 24);
}

const creatures = (page: Page) => page.evaluate(() => window.__game!.ecoCreatures());
const eco = (page: Page) => page.evaluate(() => window.__game!.eco());

async function frames(page: Page, n = 3): Promise<void> {
  await page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await window.__game!.nextFrame();
  }, n);
}

/** Creates a seeded wild world, pauses it, and places a Rabbit Warren beside the herd. */
async function warrenWorld(page: Page, name: string): Promise<{ x: number; z: number }> {
  await wildWorld(page, name, 12345);
  const herd = await creatures(page);
  const cx = Math.round(herd.reduce((s, c) => s + c.x, 0) / herd.length);
  const cz = Math.round(herd.reduce((s, c) => s + c.z, 0) / herd.length);
  const at = { x: cx + 4, y: 0, z: cz - 6 };
  const r = await page.evaluate((at) => window.__game!.placeAt('example-rabbit-warren', at, 0), at);
  expect(r?.ok).toBe(true);
  return { x: at.x + 6, z: at.z + 6 }; // the warren's centre
}

test('a wolf pack arrives late on day 1 and the strip counts it', async ({ page }) => {
  const errors = await boot(page);
  await wildWorld(page, 'Pack', 12345);
  expect((await eco(page))!.predators).toBe(0);
  await expect(page.locator('#eco-wolves')).toBeHidden();
  await page.evaluate((s) => window.__game!.ecoAdvance(s), FIRST_PACK + 1);
  await frames(page);
  expect((await eco(page))!.predators).toBe(3);
  await expect(page.locator('#eco-wolves')).toHaveText('🐺 3');
  await expect(page.locator('.toast', { hasText: 'A pack of 3 wolves has arrived' })).toBeVisible();

  // Aim at a wolf: the HUD says what it is up to.
  const wolf = (await creatures(page)).find((c) => c.species === 'predator')!;
  await page.evaluate((w) => window.__game!.setPose({ position: [w.x, 1.6, w.z + 3], yaw: 0, pitch: -Math.atan2(1.6 - 0.7, 3) }), wolf);
  await frames(page);
  expect(await page.evaluate(() => window.__game!.ecoHovered())).toBe(wolf.id);
  await expect(page.locator('#hud-status')).toContainText('Wolf');
  await page.screenshot({ path: `${SHOTS}/predators-wolf.png` });
  expect(errors).toEqual([]);
});

test('the Safety overlay shows the inside of a Rabbit Warren as safe', async ({ page }) => {
  await boot(page);
  const centre = await warrenWorld(page, 'Safe Haven');
  const inside = await page.evaluate((c) => window.__game!.ecoCell(c.x, c.z), centre);
  expect(inside!.safe).toBe(true);
  const outside = await page.evaluate((c) => window.__game!.ecoCell(c.x, c.z - 12), centre);
  expect(outside!.safe).toBe(false);

  await page.keyboard.press('KeyN');
  await page.locator('#nature-panel [data-overlay="safety"]').click();
  expect((await eco(page))!.overlay).toBe('safety');
  await frames(page);
  const teal = await page.evaluate((c) => window.__game!.ecoCell(c.x, c.z)!.color!, centre);
  expect(teal[1]).toBeGreaterThan(teal[0] + 80); // teal: far more green than red
  expect(teal[2]).toBeGreaterThan(teal[0] + 80); // and blue
  const dim = await page.evaluate((c) => window.__game!.ecoCell(c.x, c.z - 12)!.color!, centre);
  expect(dim[1]).toBeLessThan(teal[1] / 2);
  await page.evaluate((c) => window.__game!.setPose({ position: [c.x, 22, c.z + 16], yaw: 0, pitch: -0.95 }), centre);
  await frames(page);
  await page.screenshot({ path: `${SHOTS}/predators-safety-overlay.png` });

  // Removing the warren takes the safety away.
  const placement = await page.evaluate(() => window.__game!.world().placements[0].id);
  await page.evaluate((id) => window.__game!.removePlacement(id), placement);
  expect((await page.evaluate((c) => window.__game!.ecoCell(c.x, c.z), centre))!.safe).toBe(false);
});

test('rabbits in a warren make it through a night with wolves about', async ({ page }) => {
  await boot(page);
  const centre = await warrenWorld(page, 'Long Night');
  // Evening: release rabbits inside the warren and a hungry pack nearby.
  await page.evaluate((s) => window.__game!.ecoAdvance(s), DAY * 0.5);
  const before = new Set((await creatures(page)).map((c) => c.id));
  expect(await page.evaluate((c) => window.__game!.ecoRelease('prey', c.x, c.z, 4), centre)).toBe(4);
  const sheltered = (await creatures(page)).filter((c) => !before.has(c.id)).map((c) => c.id);
  expect(sheltered).toHaveLength(4);
  await page.evaluate((c) => window.__game!.ecoRelease('predator', c.x - 20, c.z + 20, 3), centre);
  await page.evaluate((s) => window.__game!.ecoAdvance(s), DAY * 0.35);
  const info = (await eco(page))!;
  expect(info.clock).toMatch(/Day 2 · 0[0-4]:/);
  const alive = new Set((await creatures(page)).map((c) => c.id));
  expect(sheltered.filter((id) => alive.has(id)).length).toBeGreaterThanOrEqual(3);
  expect(info.tally.eaten).toBeGreaterThan(0); // the wolves did hunt
  await page.evaluate((c) => window.__game!.setPose({ position: [c.x, 18, c.z + 14], yaw: 0, pitch: -0.9 }), centre);
  await frames(page);
  await page.screenshot({ path: `${SHOTS}/predators-night-warren.png` });
});

test('the Nature panel releases a wolf pack and graphs both species', async ({ page }) => {
  await boot(page);
  await wildWorld(page, 'Release pack', 12345);
  await page.evaluate((s) => window.__game!.ecoAdvance(s), 60);
  await page.evaluate(() => window.__game!.setPose({ position: [0, 6, 20], yaw: 0, pitch: -0.5 }));
  await frames(page);
  await page.keyboard.press('KeyN');
  const panel = page.locator('#nature-panel');
  await expect(panel.locator('#prey-sparkline polyline')).toHaveCount(2);
  await panel.locator('#release-wolves').click();
  await expect(panel).toBeHidden();
  expect((await eco(page))!.predators).toBe(3);
  await page.keyboard.press('KeyN');
  await expect(panel.locator('.stat', { hasText: 'Wolves' })).toContainText('3');
  await page.screenshot({ path: `${SHOTS}/predators-nature-panel.png` });
});
