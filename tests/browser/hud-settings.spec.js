import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('https://box.zakai.eu/**', route => route.fulfill({ status: 403, body: 'Terrain disabled in HUD fixture' }));
  await context.route('https://api.cesium.com/**', route => route.fulfill({ status: 403, body: 'Terrain disabled in HUD fixture' }));
});

test('flight HUD can be hidden, keeps safety UI available and persists', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.__game))).toBe(true);

  await page.locator('#settings-toggle').click();
  const toggle = page.locator('#show-flight-hud');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.locator('body')).toHaveClass(/hud-hidden/);
  await expect(page.locator('#f-instruments')).toHaveCSS('display', 'none');
  await expect(page.locator('#f-center')).toHaveCSS('display', 'none');
  await expect(page.locator('#hud')).not.toHaveCSS('display', 'none');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fotw-settings')).hud)).toBe(false);
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toHaveClass(/hud-hidden/);
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#show-flight-hud')).not.toBeChecked();
  await page.locator('#show-flight-hud').check();
  await expect(page.locator('body')).not.toHaveClass(/hud-hidden/);
  await expect(page.locator('#f-instruments')).toHaveCSS('display', 'flex');
  expect(errors).toEqual([]);
});

test('hiding the HUD during an active flight keeps the animation loop alive', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.__game))).toBe(true);
  await page.locator('#btn-solo').click();
  await page.evaluate(() => window.__testTerrainLoading(20));
  await page.locator('#city-input').fill('52.249558, 20.985260');
  await page.locator('#start-btn').click();
  await expect(page.locator('#menu')).toBeHidden({ timeout: 10000 });

  const frameBefore = await page.evaluate(() => window.__dbg.frame);
  await page.locator('#settings-toggle').click();
  await page.locator('#show-flight-hud').uncheck();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(page.locator('#fatal')).toHaveClass(/hidden/);
  await expect(page.locator('#fatal')).not.toContainText('radius');
  await expect.poll(() => page.evaluate(() => window.__dbg.frame)).toBeGreaterThan(frameBefore + 4);
});
