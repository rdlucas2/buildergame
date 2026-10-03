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
  // Five warren blocks, named, with cost and hit points; the stone wall to start with.
  const slots = page.locator('#hotbar .block-slot');
  await expect(slots).toHaveCount(5);
  await expect(slots.locator('.slot-name')).toHaveText(['Wood wall', 'Stone wall', 'Brick wall', 'Iron wall', 'Lookout post']);
  await expect(page.locator('#hotbar .block-slot.selected .slot-name')).toHaveText('Stone wall');
  await expect(slots.nth(1).locator('.slot-cost')).toHaveText('▣3 · 60hp');
  await expect(page.locator('#hotbar .block-slot.locked .slot-name')).toHaveText(['Brick wall', 'Iron wall']);
  await expect(page.locator('#hotbar .block-slot.post .post-flag')).toHaveText('⚑');
  expect(await page.evaluate(() => window.__game!.fortifyAim())).toEqual({ voxel: null, place: { x: spot.x, y: 0, z: spot.z } });
  expect(await page.evaluate(() => window.__game!.act(2))).toBe(true); // stone wall, cost 3
  expect((await info(page)).cost).toBe(start.cost + 3);
  await frames(page);
  expect(await page.evaluate(() => window.__game!.fortifyAim())).toMatchObject({ voxel: { x: spot.x, y: 0, z: spot.z } });
  await page.screenshot({ path: `${SHOTS}/defense-fortify.png` });
  expect(await page.evaluate(() => window.__game!.act(0))).toBe(true);
  expect((await info(page)).cost).toBe(start.cost);

  // Metal blocks are locked at the start of a round, and the bar says when they unlock.
  await page.keyboard.press('Digit4'); // iron
  await expect(page.locator('.toast', { hasText: 'Iron wall is locked. Metal unlocks once you survive 8:00, or earn 3000 points.' })).toBeVisible();
  expect(await page.evaluate(() => window.__game!.act(2))).toBe(false);
  await expect(page.locator('.toast', { hasText: 'Metal blocks are not unlocked yet.' })).toBeVisible();

  // Over the budget nothing is built.
  await page.keyboard.press('Digit2'); // stone wall, cost 3
  const free = start.budget - start.cost;
  // Fill rows along the edge of the buildable area with cobblestone until the budget is nearly spent.
  await page.evaluate(
    (r) => {
      for (let i = 0; i < r.n; i++) window.__game!.defenseApply({ type: 'place', x: r.x + (i % 40), y: 0, z: r.z + Math.floor(i / 40), material: 'cobblestone' });
    },
    { ...start.origin, n: Math.floor(free / 3) },
  );
  const full = await info(page);
  expect(full.cost).toBeGreaterThan(full.budget - 3);
  await frames(page);
  expect(await page.evaluate(() => window.__game!.fortifyAim())).toEqual({ voxel: null, place: { x: spot.x, y: 0, z: spot.z } });
  expect(await page.evaluate(() => window.__game!.act(2))).toBe(false);
  await expect(page.locator('.toast', { hasText: 'Over the block budget.' })).toBeVisible();
  await page.keyboard.press('KeyF');
  await expect(page.locator('#hud-mode')).toHaveText('Warren Defense: Masonry');
});

test('perks are picked from cards, and the Shop sells budget, expansion, repairs and reinforcement, pausing the round', async ({ page }) => {
  const errors = await boot(page);
  await defenseWorld(page, 'Shop');
  await advance(page, 90);
  let d = await info(page);
  expect(d.wave).toBe(2);
  expect(d.offers).toBe(1);
  await frames(page);
  await expect(page.locator('#def-perk')).toBeVisible();

  // K opens the offer: three cards, pick one. The round waits while the cards are up.
  await page.evaluate(() => window.__game!.ecoSpeed(2));
  await page.keyboard.press('KeyK');
  const offer = page.locator('#perk-offer');
  await expect(offer).toBeVisible();
  expect((await page.evaluate(() => window.__game!.eco()!)).speed).toBe(0);
  await expect(offer.locator('.perk-card')).toHaveCount(3);
  await page.screenshot({ path: `${SHOTS}/defense-perk-offer.png` });
  await offer.locator('.perk-card').first().click();
  await expect(offer).toBeHidden();
  expect((await page.evaluate(() => window.__game!.eco()!)).speed).toBe(2);
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  d = await info(page);
  expect(d.perks).toBe(1);
  expect(d.offers).toBe(0);
  await frames(page);
  await expect(page.locator('#def-perk')).toBeHidden();

  // The strip has one Shop button instead of separate buy and repair buttons.
  await expect(page.locator('#def-buy')).toHaveCount(0);
  await expect(page.locator('#def-repair')).toHaveCount(0);
  await expect(page.locator('#def-shop')).toContainText('Shop (U)');

  // U opens the Shop: the warren's four purchases, then weapons (shown, not chosen) and perks.
  await page.evaluate(() => window.__game!.ecoSpeed(1));
  await page.keyboard.press('KeyU');
  const shop = page.locator('#shop');
  await expect(shop).toBeVisible();
  expect((await page.evaluate(() => window.__game!.eco()!)).speed).toBe(0);
  await expect(shop.locator('.shop-item .armory-name')).toHaveText(['More block budget', 'Expand the warren', 'Repair everything', 'Reinforce the warren']);
  await expect(shop.locator('.armory-weapon')).toHaveCount(9);
  await expect(shop.locator('.armory-weapon[data-weapon="slingshot"]')).toContainText('Carried');
  await expect(shop.locator('.armory-weapon[data-weapon="musket"]')).toContainText('Survive 6:00 and earn 1500 points');
  await expect(shop).not.toContainText('Make main');
  await page.screenshot({ path: `${SHOTS}/defense-shop.png` });

  // Reinforce once the points allow it: every block and the core get tougher.
  const reinforce = shop.locator('#shop-reinforce .shop-buy');
  if (await reinforce.isDisabled()) {
    await page.keyboard.press('Escape');
    for (let i = 0; i < 12 && (await info(page)).points < 120; i++) await advance(page, 15);
    await page.keyboard.press('KeyU');
  }
  const before = await info(page);
  await shop.locator('#shop-reinforce .shop-buy').click();
  const after = await info(page);
  expect(after.strength.every((l) => l >= 1)).toBe(true);
  expect(after.points).toBe(before.points - 120);
  await expect(shop.locator('#shop-reinforce')).toContainText('Level 1/8');
  await page.keyboard.press('Escape');
  await expect(shop).toBeHidden();
  expect((await page.evaluate(() => window.__game!.eco()!)).speed).toBe(1);
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  expect(errors).toEqual([]);
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
  await expect(summary).toContainText('The core held out for');
  await page.screenshot({ path: `${SHOTS}/defense-round-summary.png` });
  await summary.locator('#round-restart').click();
  await expect(summary).toBeHidden();
  const fresh = await info(page);
  expect(fresh.outcome).toBe('playing');
  expect(fresh.clock).toBe(0);
  expect(fresh.wave).toBe(0);
});

test('a lost round pays Clover, and a Warren Council upgrade carries over to the next round', async ({ page }) => {
  const errors = await boot(page);
  await defenseWorld(page, 'Council');
  expect((await page.evaluate(() => window.__game!.profile())).clover).toBe(0);
  await page.evaluate(() => window.__game!.defenseApply({ type: 'allocate', defenders: 0 }));
  for (let i = 0; i < 40 && (await info(page)).outcome === 'playing'; i++) await advance(page, 30);
  await frames(page, 4);
  const summary = page.locator('#round-summary');
  await expect(summary.locator('#round-reward')).toContainText('Clover');
  await expect(summary.locator('#round-achievements')).toContainText('Founding');
  const profile = await page.evaluate(() => window.__game!.profile());
  expect(profile.clover).toBeGreaterThanOrEqual(12);
  expect(profile.stats.rounds).toBe(1);
  expect(profile.achievements['first-round']).toBeTruthy();
  await page.screenshot({ path: `${SHOTS}/defense-round-reward.png` });

  // The Council: buy a level of Stockpile (more starting budget).
  await summary.locator('#round-council').click();
  const council = page.locator('#council');
  await expect(council).toBeVisible();
  await expect(council.locator('.council-achievement[data-achievement="first-round"]')).toContainText('Earned');
  await council.locator('.council-upgrade[data-upgrade="budget"] .council-buy').click();
  await expect(council.locator('.council-upgrade[data-upgrade="budget"]')).toContainText('level 1/8');
  await page.screenshot({ path: `${SHOTS}/defense-council.png` });
  await page.keyboard.press('Escape');

  // It is saved, and the next round starts with it.
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  expect((await page.evaluate(() => window.__game!.profile())).upgrades.budget).toBe(1);
  await page.evaluate(() => window.__game!.restartRound(7));
  const fresh = await info(page);
  expect(fresh.outcome).toBe('playing');
  expect(fresh.budget).toBe(750);
  // A reload doesn't pay the old round again.
  expect((await page.evaluate(() => window.__game!.profile())).stats.rounds).toBe(1);
  expect(errors).toEqual([]);
});

test('a defense world keeps its warren and round across a reload', async ({ page }) => {
  await boot(page);
  await defenseWorld(page, 'Keep');
  await advance(page, 45);
  const d = await info(page);
  await page.evaluate((p) => window.__game!.defenseApply({ type: 'place', x: p.x - 10, y: 0, z: p.z, material: 'stone' }), d.site);
  await page.evaluate(() => window.__game!.flushSave());
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  const back = await info(page);
  expect(back.wave).toBe(d.wave);
  expect(Math.abs(back.clock - d.clock)).toBeLessThan(5);
  expect(back.blocks).toBe(d.blocks + 1);
  expect(back.unlocked).toEqual(d.unlocked);
  expect(back.offers).toBe(d.offers);
  await expect(page.locator('#def-strip')).toBeVisible();
});

test('bears, tigers, hawks, elites and bosses look the part', async ({ page }) => {
  const errors = await boot(page);
  await defenseWorld(page, 'Menagerie');
  const d = await info(page);
  const at = { x: d.site.x, z: d.site.z + 14 };
  await page.evaluate(
    ({ x, z }) => {
      const g = window.__game!;
      g.defenseSpawn('bear', x - 6, z, undefined);
      g.defenseSpawn('tiger', x - 2, z, undefined);
      g.defenseSpawn('wolf', x + 2, z, 'elite');
      g.defenseSpawn('bear', x + 7, z + 1, 'boss');
      g.defenseSpawn('hawk', x, z - 4, undefined);
    },
    at,
  );
  await page.evaluate((p) => window.__game!.setPose({ position: [p.x, 6, p.z + 10], yaw: 0, pitch: -0.25 }), at);
  await frames(page, 4);
  const now = await info(page);
  expect(now.predators).toBe(5);
  await page.screenshot({ path: `${SHOTS}/defense-predators.png` });
  expect(errors).toEqual([]);
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
