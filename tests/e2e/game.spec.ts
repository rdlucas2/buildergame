import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  await page.evaluate(() => window.__game!.setStartVisible(false));
  expect(errors).toEqual([]);
}

/** Builds a 5×3×5 hut with a door, saves it under `name`, returns its id. */
async function buildHut(page: Page, name: string): Promise<string> {
  const id = await page.evaluate(async (name) => {
    const g = window.__game!;
    await g.enterStructureMode();
    g.fillBox({ x: 30, y: 0, z: 30 }, { x: 35, y: 3, z: 35 }, 'planks');
    g.fillBox({ x: 31, y: 1, z: 31 }, { x: 34, y: 3, z: 34 }, null);
    g.fillBox({ x: 32, y: 1, z: 34 }, { x: 33, y: 3, z: 35 }, null);
    g.setVoxel(30, 1, 32, 'glass');
    const s = await g.saveStructure(name);
    await g.nextFrame();
    return s?.id ?? null;
  }, name);
  expect(id).not.toBeNull();
  return id!;
}

test('boots into an empty world with a working WebGL scene', async ({ page }) => {
  await boot(page);
  const stats = await page.evaluate(() => window.__game!.stats());
  expect(stats.placements).toBe(0);
  expect(stats.drawCalls).toBeGreaterThan(0); // ground rendered
  await expect(page.locator('#hud-mode')).toHaveText(/World: My World/);
  await page.screenshot({ path: `${SHOTS}/world-empty.png` });
});

test('structure mode measures what you build and refuses to save nothing', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__game!.enterStructureMode());
  expect(await page.evaluate(() => window.__game!.mode())).toBe('structure');
  expect(await page.evaluate(() => window.__game!.dimensions())).toEqual({ size: null, blocks: 0 });
  expect(await page.evaluate(() => window.__game!.saveStructure('nothing'))).toBeNull();

  await page.evaluate(() => {
    const g = window.__game!;
    g.setVoxel(10, 0, 10, 'stone');
    g.setVoxel(14, 2, 12, 'brick');
  });
  expect(await page.evaluate(() => window.__game!.dimensions())).toEqual({ size: { x: 5, y: 3, z: 3 }, blocks: 2 });

  // undo removes the last block, redo brings it back
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__game!.dimensions())).toEqual({ size: { x: 1, y: 1, z: 1 }, blocks: 1 });
  await page.keyboard.press('Control+y');
  expect((await page.evaluate(() => window.__game!.dimensions()))!.blocks).toBe(2);

  // the live HUD shows the dimensions
  await expect(page.locator('#hud-status')).toContainText('Size 5 × 3 × 3');
  await page.screenshot({ path: `${SHOTS}/structure-mode.png` });
});

test('mouse clicks take control, then place and remove blocks through the crosshair', async ({ page }) => {
  await boot(page);
  const lookDown = () =>
    page.evaluate(async () => {
      const g = window.__game!;
      g.setPose({ position: [32.5, 4, 36.5], yaw: 0, pitch: -Math.PI / 2 + 0.05 }); // straight down
      await g.nextFrame();
    });
  await page.evaluate(() => window.__game!.enterStructureMode());

  // The first click only captures the mouse. Chromium on Linux rejects raw-input pointer lock, so
  // this also proves the plain-lock fallback works and the game does not give up on capturing.
  await page.locator('canvas').click({ position: { x: 640, y: 360 } });
  await expect.poll(() => page.evaluate(() => window.__game!.pointer().locked)).toBe(true);
  await page.waitForTimeout(500); // the rejected raw-input request reports its error after the lock lands
  expect(await page.evaluate(() => window.__game!.pointer())).toEqual({ locked: true, unavailable: false });
  expect(await page.locator('.toast', { hasText: 'Pointer lock is not available' }).count()).toBe(0);
  expect((await page.evaluate(() => window.__game!.dimensions()))!.blocks).toBe(0);

  // While locked, click in place (no pointer move) as a real locked mouse would.
  await lookDown();
  expect((await page.evaluate(() => window.__game!.hover()))?.place).toEqual({ x: 32, y: 0, z: 36 });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__game!.dimensions()!.blocks)).toBe(1);

  await lookDown();
  expect((await page.evaluate(() => window.__game!.hover()))?.voxel).toEqual({ x: 32, y: 0, z: 36 });
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await expect.poll(() => page.evaluate(() => window.__game!.dimensions()!.blocks)).toBe(0);
});

test('save, place, reject overlap, stack, persist across reload', async ({ page }) => {
  await boot(page);
  const id = await buildHut(page, 'Hut');

  // saving a new structure drops you back into the world already placing it
  expect(await page.evaluate(() => window.__game!.mode())).toBe('world');
  const lib = await page.evaluate(() => window.__game!.library());
  expect(lib).toHaveLength(1);
  expect(lib[0]).toMatchObject({ name: 'Hut', size: { x: 5, y: 3, z: 5 }, hasThumbnail: true });
  expect(await page.evaluate(() => window.__game!.placing()?.structureId)).toBe(id);

  // aim at the ground: the preview snaps to a valid target
  await page.evaluate(async () => {
    const g = window.__game!;
    g.setPose({ position: [0, 6, 10], yaw: 0, pitch: -0.5 });
    await g.nextFrame();
  });
  const placing = await page.evaluate(() => window.__game!.placing());
  expect(placing?.ok).toBe(true);
  expect(placing?.target?.y).toBe(0);
  await page.screenshot({ path: `${SHOTS}/placing-preview.png` });

  const placed = await page.evaluate(() => window.__game!.confirmPlacement());
  expect(placed).not.toBeNull();
  const pos = placed!.position;

  // overlapping is rejected, touching is fine, stacking on top works
  expect(await page.evaluate(([id, pos]) => window.__game!.evaluate(id, { x: pos.x + 1, y: 0, z: pos.z }, 0), [id, pos] as const)).toMatchObject({ ok: false, reason: 'overlap', colliding: [placed!.id] });
  expect(await page.evaluate(([id, pos]) => window.__game!.evaluate(id, { x: pos.x + 5, y: 0, z: pos.z }, 1), [id, pos] as const)).toMatchObject({ ok: true });
  expect(await page.evaluate(([id, pos]) => window.__game!.evaluate(id, { x: pos.x, y: 3, z: pos.z }, 2), [id, pos] as const)).toMatchObject({ ok: true });
  expect(await page.evaluate(([id, pos]) => window.__game!.evaluate(id, { x: pos.x, y: -1, z: pos.z }, 0), [id, pos] as const)).toMatchObject({ ok: false, reason: 'below-ground' });
  expect(await page.evaluate(([id, pos]) => window.__game!.placeAt(id, { x: pos.x + 5, y: 0, z: pos.z }, 1), [id, pos] as const)).toMatchObject({ ok: true });
  expect(await page.evaluate(([id, pos]) => window.__game!.placeAt(id, { x: pos.x + 5, y: 0, z: pos.z }, 1), [id, pos] as const)).toMatchObject({ ok: false, reason: 'overlap' });

  // rotating the preview over the placed hut turns it red
  await page.evaluate(async () => {
    const g = window.__game!;
    g.rotatePlacing();
    await g.nextFrame();
  });
  const over = await page.evaluate(() => window.__game!.placing());
  expect(over?.rotation).toBe(1);
  expect(over?.ok).toBe(false);
  await page.screenshot({ path: `${SHOTS}/placing-blocked.png` });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__game!.placing())).toBeNull();

  await page.evaluate(() => window.__game!.flushSave());
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  const after = await page.evaluate(() => ({ world: window.__game!.world(), lib: window.__game!.library(), stats: window.__game!.stats() }));
  expect(after.world.placements).toHaveLength(2);
  expect(after.lib).toHaveLength(1);
  expect(after.stats.rendered).toBe(2);
  await page.evaluate(() => window.__game!.setStartVisible(false));
  await page.screenshot({ path: `${SHOTS}/world-after-reload.png` });
});

test('remove and move placements with X and G, undo restores', async ({ page }) => {
  await boot(page);
  const id = await buildHut(page, 'Hut');
  await page.evaluate(() => window.__game!.cancelPlacing());
  const r = await page.evaluate((id) => window.__game!.placeAt(id, { x: -2, y: 0, z: -2 }, 0), id);
  expect(r?.ok).toBe(true);
  // look at the hut from above
  await page.evaluate(async () => {
    const g = window.__game!;
    g.setPose({ position: [0.5, 12, 0.5], yaw: 0, pitch: -Math.PI / 2 + 0.01 });
    await g.nextFrame();
  });
  expect((await page.evaluate(() => window.__game!.hoveredPlacement()))?.id).toBe(r!.placementId);
  await page.keyboard.press('KeyX');
  expect((await page.evaluate(() => window.__game!.world())).placements).toHaveLength(0);
  await page.keyboard.press('Control+z');
  expect((await page.evaluate(() => window.__game!.world())).placements).toHaveLength(1);

  await page.evaluate(() => window.__game!.nextFrame());
  await page.keyboard.press('KeyG');
  expect(await page.evaluate(() => window.__game!.placing()?.structureId)).toBe(id);
  expect((await page.evaluate(() => window.__game!.world())).placements).toHaveLength(0);
  await page.keyboard.press('Escape'); // put it back
  expect((await page.evaluate(() => window.__game!.world())).placements).toHaveLength(1);
});

test('structure files round-trip into another world; identical imports are reused', async ({ page }) => {
  await boot(page);
  const id = await buildHut(page, 'Shared Hut');
  await page.evaluate(() => window.__game!.cancelPlacing());
  const text = await page.evaluate((id) => window.__game!.exportStructure(id), id);
  expect(text).not.toBeNull();
  const file = JSON.parse(text!);
  expect(file).toMatchObject({ format: 'buildergame.structure', version: 1, id, name: 'Shared Hut', size: { x: 5, y: 3, z: 5 } });
  expect(file.voxels).toMatchObject({ encoding: 'rle-u16-base64', order: 'xzy' });
  expect(file.palette.map((p: { material: string }) => p.material).sort()).toEqual(['glass', 'planks']);

  // re-import: identical → reused, edited copy → new id
  expect(await page.evaluate((t) => window.__game!.importStructure(t), text!)).toBe(id);
  const edited = { ...file, name: 'Shared Hut v2', voxels: { ...file.voxels } };
  edited.palette = [...file.palette].reverse(); // different content, same id
  const newId = await page.evaluate((t) => window.__game!.importStructure(t), JSON.stringify(edited));
  expect(newId).not.toBeNull();
  expect(newId).not.toBe(id);
  expect(await page.evaluate(() => window.__game!.library().length)).toBe(2);
  // garbage is rejected with a message, not a crash
  expect(await page.evaluate(() => window.__game!.importStructure('{"format":"nope"}'))).toBeNull();
  await expect(page.locator('.toast-error')).toBeVisible();

  // a fresh world can place the imported structure
  const wid = await page.evaluate(() => window.__game!.createWorld('Second'));
  expect(await page.evaluate(() => window.__game!.world().id)).toBe(wid);
  expect(await page.evaluate((nid) => window.__game!.placeAt(nid!, { x: 0, y: 0, z: 0 }, 3), newId)).toMatchObject({ ok: true });
});

test('world bundles carry their structures and survive id conflicts', async ({ page }) => {
  await boot(page);
  const id = await buildHut(page, 'Bundle Hut');
  await page.evaluate((id) => {
    const g = window.__game!;
    g.cancelPlacing();
    g.placeAt(id, { x: 0, y: 0, z: 0 }, 0);
    g.placeAt(id, { x: 8, y: 0, z: 0 }, 2);
  }, id);
  const b64 = await page.evaluate(() => window.__game!.exportWorldBundleBase64());
  expect(b64.length).toBeGreaterThan(100);

  // importing into the same browser: same world id → new world, identical structure → reused
  const importedId = await page.evaluate((b) => window.__game!.importWorldBundleBase64(b), b64);
  expect(importedId).not.toBeNull();
  const worlds = await page.evaluate(() => window.__game!.listWorlds());
  expect(worlds).toHaveLength(2);
  const w = await page.evaluate(() => window.__game!.world());
  expect(w.id).toBe(importedId);
  expect(w.placements).toHaveLength(2);
  expect(w.placements.every((p) => p.structureId === id)).toBe(true);
  expect(await page.evaluate(() => window.__game!.library().length)).toBe(1);
  expect(await page.evaluate(() => window.__game!.stats().rendered)).toBe(2);
  expect(await page.evaluate(() => window.__game!.importWorldBundleBase64('AAAA'))).toBeNull();
});

test('panels: library, materials, world menu and help open and close', async ({ page }) => {
  await boot(page);
  await buildHut(page, 'Panel Hut');
  await page.evaluate(() => window.__game!.cancelPlacing());
  await page.keyboard.press('Tab');
  await expect(page.locator('#library-panel')).toBeVisible();
  await expect(page.locator('#library-grid .card')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/library.png` });
  await page.locator('#library-grid .card [data-action="place"]').click();
  await expect(page.locator('#library-panel')).toHaveCount(0);
  expect(await page.evaluate(() => window.__game!.placing()?.structureId)).toBeTruthy();
  await page.keyboard.press('Escape');

  await page.keyboard.press('KeyM');
  await expect(page.locator('#world-panel')).toBeVisible();
  await expect(page.locator('#world-list .list-row')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/world-menu.png` });
  await page.keyboard.press('Escape');
  await expect(page.locator('#world-panel')).toHaveCount(0);

  await page.keyboard.press('KeyH');
  await expect(page.locator('#help-panel')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.__game!.enterStructureMode());
  await page.keyboard.press('KeyE');
  await expect(page.locator('#material-picker')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/materials.png` });
  await page.locator('#material-picker [data-material="gold"]').click();
  await expect(page.locator('#hotbar .slot.selected')).toContainText('Gold');
  await page.keyboard.press('Digit3');
  await expect(page.locator('#hotbar .slot.selected .slot-key')).toHaveText('3');
});

test('400 placements of one structure stay cheap to draw and check', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  const id = await buildHut(page, 'Stress Hut');
  const r = await page.evaluate(async (id) => {
    const g = window.__game!;
    g.cancelPlacing();
    let ok = 0;
    const t0 = performance.now();
    for (let i = 0; i < 400; i++) {
      const res = g.placeAt(id, { x: (i % 20) * 7, y: 0, z: Math.floor(i / 20) * 7 }, (i % 4) as 0 | 1 | 2 | 3);
      if (res?.ok) ok++;
    }
    let rejected = 0;
    for (let i = 0; i < 100; i++) if (!g.placeAt(id, { x: (i % 20) * 7 + 1, y: 0, z: Math.floor(i / 20) * 7 }, 0)?.ok) rejected++;
    const placeMs = performance.now() - t0;
    g.setStartVisible(false);
    g.setPose({ position: [70, 40, 170], yaw: 0, pitch: -0.4 });
    await g.nextFrame();
    const frameMs = await g.frameTime(20);
    return { ok, rejected, placeMs, frameMs, stats: g.stats() };
  }, id);
  expect(r.ok).toBe(400);
  expect(r.rejected).toBe(100);
  expect(r.stats.placements).toBe(400);
  expect(r.stats.rendered).toBe(400);
  expect(r.stats.drawCalls).toBeLessThan(12); // ground + 2 instanced batches + outlines, not 400+
  expect(r.placeMs).toBeLessThan(5000);
  await page.screenshot({ path: `${SHOTS}/stress-400.png` });
});

test('built-in examples: place from the library, survive reload, travel in bundles, edit as copies', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('#library-panel')).toBeVisible();
  await page.locator('.tab[data-tab="examples"]').click();
  const cards = page.locator('#examples-grid .card');
  await expect(cards).toHaveCount(6);
  await expect(cards.locator('.card-title')).toHaveText(['Cottage', 'Farmhouse', 'Modern House', 'Eiffel Tower', 'Arc de Triomphe', 'Rabbit Warren']);
  for (const src of await cards.locator('img.thumb').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src))) {
    expect(src.startsWith('data:image/')).toBe(true);
  }
  await page.screenshot({ path: `${SHOTS}/library-examples.png` });

  // Place the Eiffel Tower from its card.
  await page.locator('#examples-grid .card[data-structure-id="example-eiffel-tower"] [data-action="place"]').click();
  await expect(page.locator('#library-panel')).toHaveCount(0);
  expect(await page.evaluate(() => window.__game!.placing()?.structureId)).toBe('example-eiffel-tower');
  await page.evaluate(async () => {
    const g = window.__game!;
    g.setPose({ position: [0, 30, 90], yaw: 0, pitch: -0.35 });
    await g.nextFrame();
  });
  expect(await page.evaluate(() => window.__game!.placing()?.ok)).toBe(true);
  expect(await page.evaluate(() => window.__game!.confirmPlacement()?.structureId)).toBe('example-eiffel-tower');
  await page.evaluate(() => window.__game!.cancelPlacing());
  await page.screenshot({ path: `${SHOTS}/example-eiffel-placed.png` });

  // Examples are not copied into the player's library, yet the placement survives a reload.
  expect(await page.evaluate(() => window.__game!.library())).toEqual([]);
  await page.evaluate(() => window.__game!.flushSave());
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  const after = await page.evaluate(() => ({ world: window.__game!.world(), stats: window.__game!.stats() }));
  expect(after.world.placements.map((p) => p.structureId)).toEqual(['example-eiffel-tower']);
  expect(after.stats.rendered).toBe(1);

  // A world bundle carries the example and imports back onto the built-in copy.
  const b64 = await page.evaluate(() => window.__game!.exportWorldBundleBase64());
  expect(await page.evaluate((b) => window.__game!.importWorldBundleBase64(b), b64)).not.toBeNull();
  expect((await page.evaluate(() => window.__game!.world())).placements.map((p) => p.structureId)).toEqual(['example-eiffel-tower']);
  expect(await page.evaluate(() => window.__game!.library())).toEqual([]);

  // Editing an example works on a copy: saving creates a new structure and the example is unchanged.
  const before = await page.evaluate(() => window.__game!.examples().find((e) => e.id === 'example-cottage')!.blocks);
  await page.evaluate(() => window.__game!.enterStructureMode('example-cottage'));
  await expect(page.locator('#hud-mode')).toContainText('copy of "Cottage"');
  expect((await page.evaluate(() => window.__game!.dimensions()))!.blocks).toBe(before);
  await page.evaluate(() => window.__game!.setVoxel(1, 60, 1, 'gold'));
  const copy = await page.evaluate(() => window.__game!.saveStructure('My Cottage').then((s) => (s ? { id: s.id, author: s.author } : null)));
  expect(copy).not.toBeNull();
  expect(copy!.id.startsWith('example-')).toBe(false);
  expect(copy!.author).toBe('');
  const mine = await page.evaluate(() => window.__game!.library());
  expect(mine.map((s) => s.name)).toEqual(['My Cottage']);
  expect(await page.evaluate(() => window.__game!.examples().find((e) => e.id === 'example-cottage')!.blocks)).toBe(before);
});

