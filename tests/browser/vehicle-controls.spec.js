import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('https://box.zakai.eu/**', route => route.fulfill({ status: 403, body: 'Production admission disabled in controls fixture' }));
  await context.route('https://api.cesium.com/**', route => route.fulfill({ status: 403, body: 'Terrain disabled in controls fixture' }));
});

async function chooseVehicle(page, name) {
  const label = page.locator('#car-name');
  for (let clicks = 0; clicks <= 10; clicks += 1) {
    if ((await label.textContent())?.trim() === name) return;
    if (clicks < 10) await page.locator('#car-next').click();
  }
  throw new Error(`Vehicle ${name} was not available in the carousel`);
}

async function expectFocusedCopy(page, {
  name,
  includes,
  excludes,
  touchIncludes = [],
  touchExcludes = [],
}) {
  await chooseVehicle(page, name);
  const desktop = page.locator('#vehicle-controls');
  const mobile = page.locator('#vehicle-controls-touch');
  for (const phrase of includes) await expect(desktop).toContainText(phrase);
  for (const phrase of excludes) await expect(desktop).not.toContainText(phrase);
  await expect(mobile).toContainText('Landscape recommended');
  for (const phrase of touchIncludes) await expect(mobile).toContainText(phrase);
  for (const phrase of touchExcludes) await expect(mobile).not.toContainText(phrase);
}

test('the launcher describes only the currently selected vehicle', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#btn-solo').click();

  await expectFocusedCopy(page, {
    name: 'Piper PA-28',
    includes: ['W/S pitch', 'A/D roll and steer'],
    excludes: ['loops', 'twin smoke', 'On foot', 'Under canopy', 'launch to orbit'],
    touchIncludes: ['pitch and steer'],
    touchExcludes: ['loops and rolls', 'takeoff controls', 'Launch to orbit'],
  });
  await expectFocusedCopy(page, {
    name: 'Dziki dzik',
    includes: ['W/S loops', 'Q/E rapid turns', 'Z twin smoke'],
    excludes: ['On foot', 'Under canopy', 'launch to orbit'],
    touchIncludes: ['loops and rolls', 'Q / E'],
    touchExcludes: ['takeoff controls', 'Launch to orbit'],
  });
  await expectFocusedCopy(page, {
    name: 'Parachutist',
    includes: ['On foot', 'Under canopy', 'gentle takeoff'],
    excludes: ['loops', 'twin smoke', 'launch to orbit'],
    touchIncludes: ['Walk or steer', 'takeoff controls'],
    touchExcludes: ['loops and rolls', 'Launch to orbit'],
  });
  await page.screenshot({ path: 'test-results/vehicle-controls-parachutist-menu.png', fullPage: true });
  await expectFocusedCopy(page, {
    name: 'Rocket',
    includes: ['W/S pitch', 'R launch to orbit'],
    excludes: ['loops', 'twin smoke', 'On foot', 'Under canopy'],
    touchIncludes: ['Fly with the joystick', 'Launch to orbit'],
    touchExcludes: ['loops and rolls', 'takeoff controls'],
  });

  await page.evaluate(() => {
    window.dispatchEvent(new Event('keydown'));
    window.dispatchEvent(new Event('keyup'));
  });
  await expect(page.locator('#menu-error')).toBeEmpty();
  expect(errors).toEqual([]);
});

test.describe('selected vehicle mobile help', () => {
  test.use({
    viewport: { width: 393, height: 851 },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    hasTouch: true,
    isMobile: true,
  });

  test('help follows the vehicle and switches the rocket copy in space', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
    await page.locator('#btn-solo').click();
    await page.evaluate(() => window.__testTerrainLoading(20));
    await page.locator('#city-input').fill('52.249558, 20.985260');

    const openHelp = async () => {
      await page.locator('#touch-help').click();
      await expect(page.locator('#touch-help-dialog')).toBeVisible();
    };
    const closeHelp = async () => {
      await page.getByRole('button', { name: 'Back to flight' }).click();
      await expect(page.locator('#touch-help-dialog')).toBeHidden();
    };
    const backToMenu = async () => {
      await page.locator('#touch-pause').click();
      await page.locator('#btn-restart').click();
      await expect(page.locator('#menu')).toBeVisible();
    };

    await chooseVehicle(page, 'Dziki dzik');
    await page.locator('#start-btn').click();
    await expect(page.locator('#menu')).toBeHidden({ timeout: 12000 });
    await openHelp();
    await expect(page.locator('#touch-help-intro')).toHaveText('Dziki dzik controls.');
    await expect(page.locator('#touch-help-list')).toContainText('Q / E');
    await expect(page.locator('#touch-help-list')).toContainText('Smoke');
    await expect(page.locator('#touch-help-list')).not.toContainText('Takeoff');
    await closeHelp();
    await backToMenu();

    await chooseVehicle(page, 'Parachutist');
    await page.locator('#start-btn').click();
    await expect(page.locator('#menu')).toBeHidden({ timeout: 12000 });
    await openHelp();
    await expect(page.locator('#touch-help-intro')).toHaveText('Parachutist controls.');
    await expect(page.locator('#touch-help-list')).toContainText('Joystick under canopy');
    await expect(page.locator('#touch-help-list')).toContainText('Takeoff');
    await expect(page.locator('#touch-help-list')).not.toContainText('Smoke');
    await closeHelp();
    await backToMenu();

    await chooseVehicle(page, 'Rocket');
    await page.locator('#start-btn').click();
    await expect(page.locator('#menu')).toBeHidden({ timeout: 12000 });
    await openHelp();
    await expect(page.locator('#touch-help-intro')).toHaveText('Rocket controls.');
    await expect(page.locator('#touch-help-list')).toContainText('Launch to orbit');
    await expect(page.locator('#touch-help-list')).not.toContainText('Destinations');
    await closeHelp();

    expect(await page.evaluate(() => window.__testRocketLaunch())).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
    await openHelp();
    await expect(page.locator('#touch-help-intro')).toHaveText('Rocket controls in space.');
    await expect(page.locator('#touch-help-list')).toContainText('Destinations');
    await expect(page.locator('#touch-help-list')).toContainText('hyperdrive');
    await expect(page.locator('#touch-help-list')).not.toContainText('Launch to orbit');
    await page.screenshot({ path: 'test-results/vehicle-controls-rocket-space-help.png', fullPage: true });
    await closeHelp();

    await backToMenu();
    await chooseVehicle(page, 'Piper PA-28');
    await page.locator('#start-btn').click();
    await expect(page.locator('#menu')).toBeHidden({ timeout: 12000 });
    await openHelp();
    await expect(page.locator('#touch-help-intro')).toHaveText('Piper PA-28 controls.');
    await expect(page.locator('#touch-help-list')).toContainText('Joystick');
    await expect(page.locator('#touch-help-list')).toContainText('Faster / Slower');
    await expect(page.locator('#touch-help-list')).not.toContainText('Takeoff');
    await expect(page.locator('#touch-help-list')).not.toContainText('Smoke');
    await expect(page.locator('#touch-help-list')).not.toContainText('Destinations');
    await closeHelp();

    expect(errors).toEqual([]);
  });
});
