import { test, expect } from '@playwright/test';
import { Quaternion, Vector3 } from 'three';

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
    name: 'Mooney M20M',
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
    touchIncludes: ['Walk or steer', 'Takeoff controls'],
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

test('new fleet replaces archived aircraft and Free Flight in both carousels', async ({ page }) => {
  test.setTimeout(90000);
  // This assertion covers the chooser, not the visual assets. Avoid loading
  // every large GLB twice (solo and lobby) while cycling all labels.
  await page.route('**/models/*.glb', route => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  for (const [openButton, label, nextButton] of [
    ['#btn-solo', '#car-name', '#car-next'],
    ['#btn-multi', '#lobby-car-name', '#lobby-car-next'],
  ]) {
    await page.locator(openButton).click();
    const seen = new Set();
    for (let index = 0; index < 12; index += 1) {
      const name = (await page.locator(label).textContent())?.trim();
      if (seen.has(name)) break;
      seen.add(name);
      await page.locator(nextButton).click();
    }
    expect([...seen].sort()).toEqual([
      'Mooney M20M', 'Boeing 737-800', 'Airbus A380',
      'Lockheed AC-130 Hercules', 'Northrop Grumman B-2 Spirit',
      'Fighter', 'Rocket', 'Parachutist', 'Dziki dzik',
    ].sort());
    for (const archived of ['Piper PA-28', 'Dash 8 Q400', 'Cessna Citation', 'Free flight']) {
      expect([...seen]).not.toContain(archived);
    }
    if (openButton === '#btn-solo') await page.locator('#menu-back').click();
  }
});

test('new fleet applies revised cruise, maximum speed and course authority to gameplay', async ({ page }) => {
  await page.route('**/models/*.glb', route => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  for (const [key, cruiseKmh, maximumKmh] of [
    ['mooney', 220, 450], ['boeing737', 417.5, 876],
    ['a380', 450, 945], ['ac130', 320, 670], ['b2', 450, 1010],
  ]) {
    expect(await page.evaluate(vehicle => window.__testVisualVehicle(vehicle), key)).toBe(true);
    const values = await page.evaluate(() => {
      const { plane } = window.__game;
      return { cruise: plane.cruise * 3.6, maximum: plane.boost * 3.6,
        speed: plane.speed * 3.6, turnRate: plane.turnRate, boostSeconds: plane.boostSeconds };
    });
    expect(values.cruise).toBeCloseTo(cruiseKmh, 6);
    expect(values.maximum).toBeCloseTo(maximumKmh, 6);
    expect(values.speed).toBeCloseTo(cruiseKmh, 6);
    expect(values.turnRate).toBe(3);
    expect(values.boostSeconds).toBe(1);
  }
});

test('right mouse drag looks right in parachutist first-person camera', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
  await expect.poll(() => page.evaluate(() => !!window.__game.planeMesh?.userData?.parachutist?.character?.visualSkin),
    { timeout: 20000 }).toBe(true);
  const model = await page.evaluate(() => {
    const rig = window.__game.planeMesh.userData.parachutist;
    return { skin: rig.character.visualSkin.isSkinnedMesh,
      bones: rig.character.visualSkin.skeleton.bones.length,
      canopy: rig.canopy.name, lines: rig.canopy.getObjectByName('Branched suspension and brake lines')?.isLineSegments };
  });
  expect(model).toEqual({ skin: true, bones: 14, canopy: 'parachute-canopy', lines: true });
  await page.screenshot({ path: 'test-results/vehicle-controls-parachutist-game.png' });
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -2400);
  await expect.poll(() => page.evaluate(() => window.__dbg?.firstPerson)).toBe(true);
  const before = await page.evaluate(() => ({
    quaternion: window.__game.camera.quaternion.toArray(),
    heading: window.__game.plane.heading,
  }));
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 100, y, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const after = await page.evaluate(() => ({
    quaternion: window.__game.camera.quaternion.toArray(),
    heading: window.__game.plane.heading,
  }));
  const initialRight = new Vector3(1, 0, 0).applyQuaternion(new Quaternion(...before.quaternion));
  const newForward = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...after.quaternion));
  expect(newForward.dot(initialRight)).toBeGreaterThan(0.05);
  expect(Math.abs(after.heading - before.heading)).toBeLessThan(0.02);
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
    await chooseVehicle(page, 'Mooney M20M');
    await page.locator('#start-btn').click();
    await expect(page.locator('#menu')).toBeHidden({ timeout: 12000 });
    await openHelp();
    await expect(page.locator('#touch-help-intro')).toHaveText('Mooney M20M controls.');
    await expect(page.locator('#touch-help-list')).toContainText('Joystick');
    await expect(page.locator('#touch-help-list')).toContainText('Faster / Slower');
    await expect(page.locator('#touch-help-list')).not.toContainText('Takeoff');
    await expect(page.locator('#touch-help-list')).not.toContainText('Smoke');
    await expect(page.locator('#touch-help-list')).not.toContainText('Destinations');
    await closeHelp();

    expect(errors).toEqual([]);
  });
});
