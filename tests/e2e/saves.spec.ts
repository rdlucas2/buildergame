import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  await page.evaluate(() => window.__game!.setStartVisible(false));
  return errors;
}

/**
 * Edits the saved copy of a world straight in the browser's storage, as an older version left it.
 * It does so from a blank page on the same site, so the game isn't running to save over it.
 */
async function editStoredWorld(page: Page, id: string, edit: string): Promise<void> {
  await page.route('**/blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }));
  await page.goto('/blank');
  await page.evaluate(
    ({ id, edit }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('buildergame-worlds');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          const store = tx.objectStore('kv');
          const get = store.get(id);
          get.onsuccess = () => {
            const world = get.result;
            new Function('world', edit)(world);
            store.put(world, id);
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    { id, edit },
  );
}

test('a Warren Defense world saved by the first version still opens after an update', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  const id = await page.evaluate(() => window.__game!.createWorld('Old round', 'defense', 5));
  await page.evaluate(() => window.__game!.flushSave());
  // Take away everything added to rounds since the first version.
  await editStoredWorld(
    page,
    id,
    `const d = world.ecosystem.defense;
     for (const k of ['unlocked', 'mainWeapon', 'loadout', 'tiers', 'strength', 'perks', 'offers', 'offersMade', 'milestones', 'rerolls', 'rewarded', 'bosses']) delete d[k];
     delete d.stats.firstLoss; delete d.base.coreDamage;`,
  );
  const errors = await boot(page);
  await expect(page.locator('#hud-mode')).toHaveText('Warren Defense: Old round');
  const d = await page.evaluate(() => window.__game!.defense()!);
  expect(d.unlocked).toEqual(['slingshot']);
  expect(errors).toEqual([]);
});

test('a world that can not be opened at all no longer stops the game from starting', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game!.ecoSpeed(0));
  const id = await page.evaluate(() => window.__game!.createWorld('Broken round', 'defense', 6));
  await page.evaluate(() => window.__game!.flushSave());
  await editStoredWorld(page, id, `delete world.ecosystem.defense.base;`);
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  await page.evaluate(() => window.__game!.setStartVisible(false));
  // It starts in a fresh world and says why; the broken one is kept.
  await expect(page.locator('.toast', { hasText: `"Broken round" couldn't be opened` })).toBeVisible();
  await expect(page.locator('#hud-mode')).toHaveText('World: My World');
  const names = (await page.evaluate(() => window.__game!.listWorlds())).map((w) => w.name);
  expect(names).toContain('Broken round');
  // Opening it from the World menu says so and stays put.
  expect(await page.evaluate((id) => window.__game!.switchWorld(id), id)).toBe(false);
  await expect(page.locator('#hud-mode')).toHaveText('World: My World');
});
