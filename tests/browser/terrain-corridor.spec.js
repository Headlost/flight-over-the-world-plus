import { test, expect } from '@playwright/test';

test('Shift adds a bounded forward terrain corridor and releasing it restores the baseline view', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.fulfill({ status: 503, body: 'offline terrain fixture' }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.__game))).toBe(true);
  expect(await page.evaluate(() => window.__testVisualVehicle('boeing737'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.terrainFlightCorridor?.active)).toBe(false);
  const normalError = await page.evaluate(() => window.__dbg.terrainErrorTarget);

  await page.keyboard.down('Shift');
  await expect.poll(() => page.evaluate(() => window.__dbg?.terrainFlightCorridor?.active)).toBe(true);
  const boosted = await page.evaluate(() => ({
    ...window.__dbg.terrainFlightCorridor,
    errorTarget: window.__dbg.terrainErrorTarget,
  }));
  expect(boosted.length).toBeGreaterThan(1800);
  expect(boosted.length).toBeLessThanOrEqual(6000);
  expect(boosted.width).toBe(48);
  expect(boosted.prefetchPending).toBeLessThanOrEqual(2);
  expect(boosted.errorTarget).toBe(normalError);

  await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => window.__dbg?.terrainFlightCorridor?.active)).toBe(false);
  expect(await page.evaluate(() => window.__dbg.terrainErrorTarget)).toBe(normalError);
  expect(errors).toEqual([]);
});
