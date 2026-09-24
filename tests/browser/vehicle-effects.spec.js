import { test, expect } from '@playwright/test';

test('new fleet renders moving propellers and correctly placed jet and rocket exhaust', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.fulfill({ status: 503, body: 'offline visual fixture' }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);

  for (const [key, count] of [
    ['mooney', 1], ['ac130', 4],
  ]) {
    expect(await page.evaluate(vehicle => window.__testVisualVehicle(vehicle), key)).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      window.__game.planeMesh?.userData?.modelLoaded), { timeout: 20000 }).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      window.__game.planeMesh?.userData?.spinRotors?.length)).toBe(count);
    const turns = await page.evaluate(() => window.__game.planeMesh.userData.spinRotors
      .map(holder => holder.rotation.z));
    await expect.poll(() => page.evaluate(() => window.__game.planeMesh.userData.spinRotors
      .map(holder => holder.rotation.z))).not.toEqual(turns);
    await page.screenshot({ path: `test-results/vehicle-effects-${key}.png` });
  }

  for (const [key, count] of [
    ['boeing737', 2], ['a380', 4], ['b2', 2], ['jet', 2],
  ]) {
    expect(await page.evaluate(vehicle => window.__testVisualVehicle(vehicle), key)).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      window.__game.planeMesh?.userData?.modelLoaded), { timeout: 20000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => ({
      count: window.__game.planeMesh?.userData?.jetExhaust?.children.length,
      visible: window.__game.planeMesh?.userData?.jetExhaust?.visible,
    }))).toEqual({ count, visible: true });
    if (key === 'b2') {
      expect(await page.evaluate(() => window.__game.planeMesh.userData.jetExhaust
        .userData.layout.blueOnly)).toBe(true);
      // Keep a no-effect reference so a blue line painted into the GLB cannot
      // be mistaken for the dynamically attached exhaust.
      await page.evaluate(() => {
        const data = window.__game.planeMesh.userData;
        data.testHiddenJetExhaust = data.jetExhaust;
        data.jetExhaust.visible = false;
        data.jetExhaust = null; // prevent the animation loop from re-enabling it
      });
      await page.waitForTimeout(150); // capture a rendered frame, not the old canvas buffer
      await page.screenshot({ path: 'test-results/vehicle-effects-b2-no-exhaust.png' });
      await page.evaluate(() => {
        const data = window.__game.planeMesh.userData;
        data.jetExhaust = data.testHiddenJetExhaust;
        delete data.testHiddenJetExhaust;
        data.jetExhaust.visible = true;
      });
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: `test-results/vehicle-effects-${key === 'jet' ? 'fighter' : key}.png` });
  }

  expect(await page.evaluate(() => window.__testVisualVehicle('rocket'))).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    window.__game.planeMesh?.userData?.modelLoaded), { timeout: 20000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const plume = window.__game.planeMesh?.userData?.rocketPlume;
    return plume && { visible: plume.visible, y: plume.position.y,
      centred: Math.abs(plume.position.x) < 0.02,
      core: !!plume.getObjectByName('rocket-nozzle-white-hot-core'),
      ribs: !!plume.getObjectByName('rocket-nozzle-glowing-ribs') };
  })).toEqual({ visible: true, y: expect.any(Number), centred: true, core: true, ribs: true });
  const rocketY = await page.evaluate(() => window.__game.planeMesh.userData.rocketPlume.position.y);
  expect(rocketY).toBeGreaterThan(-2.2);
  expect(rocketY).toBeLessThan(-1);
  await page.screenshot({ path: 'test-results/vehicle-effects-rocket.png' });
  expect(errors).toEqual([]);
});

test('Boeing and Airbus leave persistent white trails from each engine while accelerating', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.fulfill({ status: 503, body: 'offline visual fixture' }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);

  for (const [key, emitterCount] of [['boeing737', 2], ['a380', 4]]) {
    expect(await page.evaluate(vehicle => window.__testVisualVehicle(vehicle), key)).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      window.__game.planeMesh?.userData?.modelLoaded), { timeout: 20000 }).toBe(true);
    const toggle = page.locator('#acro-smoke-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveText('Contrails on · Z');
    if (key === 'boeing737') {
      await page.mouse.move(600, 500);
      await page.mouse.wheel(0, 1250);
    }
    await page.keyboard.down('Shift');
    await expect.poll(() => page.evaluate(() =>
      window.__dbg?.airlinerContrails?.emitterCount)).toBe(emitterCount);
    await expect.poll(() => page.evaluate(() =>
      window.__dbg?.airlinerContrails?.count)).toBeGreaterThan(emitterCount * 18);
    await page.waitForTimeout(1800);
    if (key === 'boeing737') {
      const canvas = await page.locator('#game-canvas').boundingBox();
      const x = canvas.x + canvas.width * 0.55;
      const y = canvas.y + canvas.height * 0.55;
      await page.mouse.move(x, y);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(x - 250, y - 75, { steps: 12 });
      await page.mouse.up({ button: 'right' });
    }
    await page.screenshot({ path: `test-results/airliner-contrails-${key}-active.png` });
    await page.keyboard.up('Shift');
    await expect.poll(() => page.evaluate(() =>
      window.__dbg?.airlinerContrails?.emitterCount)).toBe(0);
    const remaining = await page.evaluate(() => window.__dbg.airlinerContrails.count);
    expect(remaining).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__dbg.airlinerContrails.lifeSeconds)).toBe(12);
    await page.screenshot({ path: `test-results/airliner-contrails-${key}.png` });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveText('Contrails off · Z');
    const retained = await page.evaluate(() => window.__dbg.airlinerContrails.count);
    await page.keyboard.down('Shift');
    await page.waitForTimeout(220);
    expect(await page.evaluate(() => window.__dbg.airlinerContrails.emitterCount)).toBe(0);
    expect(await page.evaluate(() => window.__dbg.airlinerContrails.count)).toBeLessThanOrEqual(retained);
    await page.keyboard.up('Shift');

    await page.keyboard.press('z');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.down('Shift');
    await expect.poll(() => page.evaluate(() => window.__dbg.airlinerContrails.emitterCount)).toBe(emitterCount);
    await page.keyboard.up('Shift');
  }
  expect(await page.evaluate(() => window.__testVisualVehicle('dzikiDzik'))).toBe(true);
  await expect(page.locator('#acro-smoke-toggle')).toBeVisible();
  await expect(page.locator('#acro-smoke-toggle')).toHaveText('Smoke on · Z');
  await page.keyboard.press('z');
  await expect(page.locator('#acro-smoke-toggle')).toHaveText('Smoke off · Z');

  expect(await page.evaluate(() => window.__testVisualVehicle('mooney'))).toBe(true);
  await expect(page.locator('#acro-smoke-toggle')).toBeHidden();
  const beforeOrdinaryZ = await page.evaluate(() => window.__dbg.acroSmokeEnabled);
  await page.keyboard.press('z');
  expect(await page.evaluate(() => window.__dbg.acroSmokeEnabled)).toBe(beforeOrdinaryZ);
  expect(errors).toEqual([]);
});

test('replacement parachutist walks without skin vertices escaping the body', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.fulfill({ status: 503, body: 'offline visual fixture' }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
  const skinReady = await page.waitForFunction(() =>
    window.__game.planeMesh?.userData?.parachutist?.character?.visualSkin?.isSkinnedMesh,
  null, { timeout: 30000 }).catch(() => false);
  expect(skinReady || errors.join('\n')).toBeTruthy();
  await page.keyboard.down('w');
  await page.waitForTimeout(450);
  const bounds = await page.evaluate(() => {
    const skin = window.__game.planeMesh.userData.parachutist.character.visualSkin;
    const { position } = skin.geometry.attributes;
    let farthest = 0;
    for (let index = 0; index < position.count; index += 23) {
      const deformed = skin.getVertexPosition(index, skin.userData.testVector ||= skin.position.clone());
      farthest = Math.max(farthest, Math.abs(deformed.x), Math.abs(deformed.y), Math.abs(deformed.z));
    }
    return { farthest, vertices: position.count };
  });
  await page.screenshot({ path: 'test-results/vehicle-effects-parachutist-walk.png' });
  await page.keyboard.up('w');
  expect(bounds.vertices).toBeGreaterThan(50000);
  expect(bounds.farthest).toBeLessThan(3);
});

test('steady jet recordings decode, loop and switch with the aircraft', async ({ page }) => {
  test.setTimeout(75000);
  await page.route('https://**/*', route => route.fulfill({ status: 503, body: 'offline visual fixture' }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.keyboard.press('z'); // real user gesture unlocks Web Audio
  expect(await page.evaluate(() => window.__testVisualVehicle('boeing737'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.audio?.activeSample),
    { timeout: 20000 }).toBe('airliner');
  expect(await page.evaluate(() => window.__dbg.audio.sampleError)).toBe(null);

  expect(await page.evaluate(() => window.__testVisualVehicle('a380'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.audio?.activeSample)).toBe('airliner');
  expect(await page.evaluate(() => window.__testVisualVehicle('b2'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.audio?.activeSample),
    { timeout: 20000 }).toBe('b2');
  expect(await page.evaluate(() => window.__testVisualVehicle('jet'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.audio?.activeSample)).toBe(null);
});

test('a missing recording leaves the procedural engine running and another jet can load', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('https://**/*', route => route.fulfill({ status: 503, body: 'offline visual fixture' }));
  await page.route('**/sounds/b2-cruise.ogg', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.keyboard.press('z');
  expect(await page.evaluate(() => window.__testVisualVehicle('b2'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.audio?.sampleError),
    { timeout: 20000 }).toBe('HTTP 404');
  expect(await page.evaluate(() => window.__dbg.audio.built)).toBe(true);
  expect(await page.evaluate(() => window.__dbg.audio.activeSample)).toBe(null);
  expect(await page.evaluate(() => window.__testVisualVehicle('boeing737'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.audio?.activeSample),
    { timeout: 20000 }).toBe('airliner');
});
