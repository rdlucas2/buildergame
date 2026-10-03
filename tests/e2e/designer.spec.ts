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

const info = (page: Page) => page.evaluate(() => window.__game!.defense()!);
const status = (page: Page) => page.evaluate(() => window.__game!.designStatus());

async function frames(page: Page, n = 3): Promise<void> {
  await page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await window.__game!.nextFrame();
  }, n);
}

/**
 * A warren of its own: one ring of stone walls 19 wide and 3 high (every other top block a lookout
 * post), steps up inside a corner, and the core in the middle. Built in the designer's 48×48 area.
 */
async function buildBigWarren(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__game!;
    g.fillBox({ x: 0, y: 0, z: 0 }, { x: 48, y: 16, z: 48 }, null);
    const lo = 14;
    const hi = 32;
    for (const [x0, z0, x1, z1] of [
      [lo, lo, hi + 1, lo + 1],
      [lo, hi, hi + 1, hi + 1],
      [lo, lo, lo + 1, hi + 1],
      [hi, lo, hi + 1, hi + 1],
    ])
      g.fillBox({ x: x0, y: 0, z: z0 }, { x: x1, y: 3, z: z1 }, 'cobblestone');
    for (let i = lo; i <= hi; i += 2) for (const [x, z] of [[i, lo], [i, hi], [lo, i], [hi, i]]) g.setVoxel(x, 2, z, 'lookout');
    g.setVoxel(lo + 2, 0, lo + 1, 'planks');
    g.setVoxel(lo + 1, 0, lo + 1, 'planks');
    g.setVoxel(lo + 1, 1, lo + 1, 'planks');
    g.designCore(23, 0, 23);
  });
}

test('players design their own warren in the builder, with exactly one core, and play it', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  await page.evaluate(() => window.__game!.createWorld('Home', 'defense', 8));
  // B in a Warren Defense world opens the warren designer, starting from the starter warren.
  await page.keyboard.press('KeyB');
  await expect(page.locator('#hud-mode')).toHaveText('Warren designer');
  await expect(page.locator('#hotbar .block-slot .slot-name')).toHaveText(['Wood wall', 'Stone wall', 'Brick wall', 'Iron wall', 'Lookout post', 'Core']);
  expect(await status(page)).toEqual(['Warren design · ▣ 512 of 700 budget · 4 lookout posts · room for 41 rabbits', 'Ready to play: save it (Enter), then start a round with it']);

  // There is only ever one core: placing it again moves it.
  const before = await page.evaluate(() => window.__game!.dimensions()!.blocks);
  expect(await page.evaluate(() => window.__game!.designCore(6, 0, 6))).toBe(true);
  expect(await page.evaluate(() => window.__game!.dimensions()!.blocks)).toBe(before);
  expect((await status(page))![1]).toMatch(/^Ready to play/);
  // Taking a core block away by hand breaks it: the design can't be played until it's whole.
  await page.evaluate(() => window.__game!.setVoxel(6, 0, 6, null));
  expect((await status(page))![1]).toMatch(/exactly one core/);

  // A bigger, sparser warren: more ground inside, so room for more rabbits, within the budget.
  await buildBigWarren(page);
  const [summary, ready] = (await status(page))!;
  expect(ready).toMatch(/^Ready to play/);
  const room = Number(/room for (\d+)/.exec(summary)![1]);
  expect(room).toBeGreaterThan(60);
  const posts = Number(/(\d+) lookout posts/.exec(summary)![1]);
  expect(posts).toBeGreaterThan(30);
  await page.evaluate(() => window.__game!.setPose({ position: [23, 22, 50], yaw: 0, pitch: -0.7 }));
  await frames(page);
  await page.screenshot({ path: `${SHOTS}/60-warren-designer.png` });

  // Save it, and start a round with it.
  void page.evaluate(() => window.__game!.saveStructure('Big Ring'));
  await expect(page.locator('#confirm-dialog')).toContainText('Start a new round with "Big Ring"?');
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#hud-mode')).toHaveText('Warren Defense: Home');
  const d = await info(page);
  expect(d.design?.name).toBe('Big Ring');
  expect(d.room).toBe(room);
  expect(d.core).toBe(8);
  expect(d.posts).toHaveLength(posts);
  expect(d.clock).toBe(0);
  await page.evaluate((s) => window.__game!.setPose({ position: [s.x + 16, 16, s.z + 18], yaw: 0.7, pitch: -0.55 }), d.site);
  await page.evaluate(() => window.__game!.defenseApply({ type: 'allocate', defenders: 12 }));
  await page.evaluate(() => window.__game!.ecoAdvance(15));
  await page.evaluate(() => window.__game!.setStartVisible(false));
  await frames(page, 4);
  await page.screenshot({ path: `${SHOTS}/61-warren-played.png` });

  // A new round keeps the same warren; the starter warren can be chosen again.
  await page.evaluate(() => window.__game!.restartRound(9));
  expect((await info(page)).design?.name).toBe('Big Ring');
  await page.evaluate(() => window.__game!.restartRound(10, null));
  expect((await info(page)).design).toBeNull();
  expect((await info(page)).room).toBe(41);

  // The new-world dialog offers it for Warren Defense worlds.
  await page.keyboard.press('KeyM');
  await page.locator('#world-new').click();
  await expect(page.locator('#new-world-warren-field')).toBeHidden();
  await page.locator('#new-world-defense').check();
  await expect(page.locator('#new-world-warren-field')).toBeVisible();
  await expect(page.locator('#new-world-warren option')).toHaveText(['Starter warren', /^Big Ring: ▣ \d+, \d+ posts, room for \d+$/]);
  await page.locator('#new-world-warren').selectOption({ label: (await page.locator('#new-world-warren option').nth(1).textContent())! });
  await page.locator('#new-world-name').fill('Ring world');
  await page.locator('#new-world-create').click();
  await expect(page.locator('#hud-mode')).toHaveText('Warren Defense: Ring world');
  expect((await info(page)).design?.name).toBe('Big Ring');
  expect(errors).toEqual([]);
});

test('a design over the starting budget is saved but not played', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  await page.evaluate(() => window.__game!.createWorld('Pricey', 'defense', 8));
  await page.evaluate(() => window.__game!.designWarren());
  // Iron walls all round: far more than a round's 700 budget.
  await page.evaluate(() => window.__game!.fillBox({ x: 4, y: 0, z: 4 }, { x: 44, y: 3, z: 5 }, 'iron'));
  expect((await page.evaluate(() => window.__game!.designStatus()))![1]).toMatch(/costs \d+ budget; a round starts with 700/);
  await page.evaluate(() => window.__game!.saveStructure('Iron Wall'));
  await expect(page.locator('.toast', { hasText: `can't be played yet` })).toBeVisible();
  await expect(page.locator('#confirm-dialog')).toHaveCount(0);
  expect((await info(page)).design).toBeNull();
});
