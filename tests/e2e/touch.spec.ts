import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

test.use({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  expect(errors).toEqual([]);
}

type Pt = [number, number];

/** Real multi-finger touch input through the DevTools protocol: press, slide, hold, lift. */
async function touchGesture(page: Page, fingers: Array<{ id: number; from: Pt; to: Pt }>, holdMs = 0, steps = 8): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (t: number) => fingers.map((f) => ({ id: f.id, x: f.from[0] + (f.to[0] - f.from[0]) * t, y: f.from[1] + (f.to[1] - f.from[1]) * t }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i / steps) });
    await page.waitForTimeout(16);
  }
  if (holdMs) await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function center(page: Page, selector: string): Promise<Pt> {
  const b = (await page.locator(selector).boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2];
}

/** Fails when any two of the given elements' boxes intersect. */
async function expectNoOverlaps(page: Page, selectors: string[]): Promise<void> {
  const boxes = await Promise.all(selectors.map(async (sel) => ({ sel, b: (await page.locator(sel).first().boundingBox())! })));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b;
      const c = boxes[j].b;
      const overlap = a.x < c.x + c.width - 1 && c.x < a.x + a.width - 1 && a.y < c.y + c.height - 1 && c.y < a.y + a.height - 1;
      expect(overlap, `${boxes[i].sel} overlaps ${boxes[j].sel}`).toBe(false);
    }
}

const actions = (page: Page) => page.evaluate(() => window.__game!.touch().actions.filter((a) => !a.disabled).map((a) => a.id));

test('phones get touch controls automatically, without the pointer-lock prompt', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => window.__game!.touch())).toMatchObject({ mode: true, visible: true });
  await expect(page.locator('#touch-stick')).toBeVisible();
  await expect(page.locator('#start-overlay')).toBeHidden();
  await expect(page.locator('#btn-library')).toHaveText('Library', { useInnerText: true }); // keyboard hint hidden
  expect(await page.locator('.toast', { hasText: 'Pointer lock' }).count()).toBe(0);
  await page.screenshot({ path: `${SHOTS}/touch-world.png` });
});

test('thumbstick moves, dragging the view looks, and both work at once', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game!.setPose({ position: [0, 10, 0], yaw: 0, pitch: 0 }));
  const stick = await center(page, '#touch-stick');

  // Push the stick up (forward) and hold: yaw 0 flies towards -z.
  await touchGesture(page, [{ id: 1, from: stick, to: [stick[0], stick[1] - 70] }], 500);
  const moved = await page.evaluate(() => window.__game!.getPose());
  expect(moved.position[2]).toBeLessThan(-3);
  expect(Math.abs(moved.position[0])).toBeLessThan(0.5);
  expect(moved.yaw).toBeCloseTo(0, 5);

  // Stick released: no drift.
  const rest = moved.position[2];
  await page.waitForTimeout(200);
  expect((await page.evaluate(() => window.__game!.getPose())).position[2]).toBeCloseTo(rest, 3);

  // One finger dragging right on the view turns left-to-right (yaw decreases).
  await touchGesture(page, [{ id: 2, from: [600, 200], to: [700, 200] }]);
  const turned = await page.evaluate(() => window.__game!.getPose());
  expect(turned.yaw).toBeLessThan(-0.2);

  // Two fingers at once: stick forward and a vertical look drag.
  await touchGesture(page, [
    { id: 3, from: stick, to: [stick[0], stick[1] - 70] },
    { id: 4, from: [650, 150], to: [650, 250] },
  ], 300);
  const both = await page.evaluate(() => window.__game!.getPose());
  expect(both.pitch).toBeLessThan(-0.2);
  const travelled = Math.hypot(both.position[0] - turned.position[0], both.position[2] - turned.position[2]);
  expect(travelled).toBeGreaterThan(2);

  // Fly up with the up button.
  const y0 = both.position[1];
  const up = await center(page, '[data-action="fly-up"]');
  await touchGesture(page, [{ id: 5, from: up, to: up }], 400, 1);
  expect((await page.evaluate(() => window.__game!.getPose())).position[1]).toBeGreaterThan(y0 + 2);
});

test('structure mode: place, break, undo and choose materials with taps', async ({ page }) => {
  await boot(page);
  await page.locator('#btn-structure').tap();
  expect(await page.evaluate(() => window.__game!.mode())).toBe('structure');
  expect(await page.evaluate(() => window.__game!.touch().actions.map((a) => a.id))).toEqual(['place', 'break', 'pick', 'materials', 'undo', 'redo', 'save', 'exit']);
  await page.evaluate(async () => {
    const g = window.__game!;
    g.setPose({ position: [32.5, 4, 36.5], yaw: 0, pitch: -Math.PI / 2 + 0.05 });
    await g.nextFrame();
  });

  await page.locator('[data-action="place"]').tap();
  expect((await page.evaluate(() => window.__game!.dimensions()))!.blocks).toBe(1);
  await page.evaluate(() => window.__game!.nextFrame());
  await page.locator('[data-action="break"]').tap();
  expect((await page.evaluate(() => window.__game!.dimensions()))!.blocks).toBe(0);
  await expect.poll(() => actions(page)).toContain('undo');
  await page.locator('[data-action="undo"]').tap();
  expect((await page.evaluate(() => window.__game!.dimensions()))!.blocks).toBe(1);

  // Hotbar: tap a slot to select it, tap it again to open every material.
  await page.locator('#hotbar .slot[data-slot="2"]').tap();
  await expect(page.locator('#hotbar .slot.selected')).toHaveAttribute('data-slot', '2');
  await page.locator('#hotbar .slot[data-slot="2"]').tap();
  await expect(page.locator('#material-picker')).toBeVisible();
  expect(await page.evaluate(() => window.__game!.touch().visible)).toBe(false); // hidden behind panels
  await page.locator('#material-picker [data-material="gold"]').tap();
  await expect(page.locator('#material-picker')).toHaveCount(0);
  expect(await page.evaluate(() => window.__game!.touch().visible)).toBe(true);
  await expect(page.locator('#hotbar .slot.selected')).toHaveAttribute('title', 'Gold');
  await expectNoOverlaps(page, ['#touch-stick', '#touch-actions', '.touch-fly', '#hotbar', '#touch-secondary', '.hud-topright']);
  await page.screenshot({ path: `${SHOTS}/touch-structure.png` });
});

test('world mode: place an example, rotate it, then remove it with taps', async ({ page }) => {
  await boot(page);
  await page.locator('#btn-library').tap();
  await page.locator('.tab[data-tab="examples"]').tap();
  await page.locator('#examples-grid .card[data-structure-id="example-cottage"] [data-action="place"]').tap();
  await page.evaluate(async () => {
    const g = window.__game!;
    g.setPose({ position: [0, 10, 25], yaw: 0, pitch: -0.45 });
    await g.nextFrame();
  });
  await expect.poll(() => actions(page)).toEqual(['drop', 'rotate', 'raise', 'lower', 'cancel']);
  await page.locator('[data-action="rotate"]').tap();
  expect(await page.evaluate(() => window.__game!.placing()?.rotation)).toBe(1);
  await page.screenshot({ path: `${SHOTS}/touch-placing.png` });
  await page.locator('[data-action="drop"]').tap();
  const world = await page.evaluate(() => window.__game!.world());
  expect(world.placements).toHaveLength(1);
  expect(world.placements[0]).toMatchObject({ structureId: 'example-cottage', rotation: 1 });

  // Stop placing, then look at the cottage: Remove becomes available.
  await page.locator('[data-action="cancel"]').tap();
  const p = world.placements[0].position;
  await page.evaluate(async (p) => {
    const g = window.__game!;
    g.setPose({ position: [p.x + 5.5, 30, p.z + 6.5], yaw: 0, pitch: -Math.PI / 2 + 0.01 });
    await g.nextFrame();
  }, p);
  await expect.poll(() => actions(page)).toContain('remove');
  await page.locator('[data-action="remove"]').tap();
  expect((await page.evaluate(() => window.__game!.world())).placements).toHaveLength(0);
});

test('portrait layout keeps every control on screen', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await boot(page);
  await page.locator('#btn-structure').tap();
  const vp = page.viewportSize()!;
  for (const sel of ['#touch-stick', '[data-action="fly-up"]', '[data-action="fly-down"]', '[data-action="place"]', '[data-action="exit"]', '#hotbar', '#btn-help']) {
    const b = (await page.locator(sel).boundingBox())!;
    expect(b, sel).not.toBeNull();
    expect(b.x, sel).toBeGreaterThanOrEqual(0);
    expect(b.y, sel).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, sel).toBeLessThanOrEqual(vp.width);
    expect(b.y + b.height, sel).toBeLessThanOrEqual(vp.height);
  }
  await expectNoOverlaps(page, ['#touch-stick', '#touch-actions', '.touch-fly', '#hotbar', '#touch-secondary', '.hud-topright']);
  await page.screenshot({ path: `${SHOTS}/touch-portrait.png` });
});

test('desktop keeps mouse and keyboard controls with no touch overlay', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false });
  const page = await ctx.newPage();
  await boot(page);
  expect(await page.evaluate(() => window.__game!.touch().mode)).toBe(false);
  await expect(page.locator('#touch-ui')).toBeHidden();
  await expect(page.locator('#btn-library')).toHaveText('Library (Tab)', { useInnerText: true });
  await ctx.close();
});
