import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

async function exhaustState(page) {
  return page.evaluate(() => {
    const root = window.__game.planeMesh;
    const exhaust = root.userData.jetExhaust;
    return {
      key: root.userData.key, visible: exhaust?.visible === true,
      rootVisible: root.visible, nozzles: exhaust?.children.length || 0,
      throttle: window.__game.plane.throttle, power: exhaust?.userData.power.value,
      lengths: exhaust?.userData.flames.map(flame => flame.scale.z),
      crashed: window.__dbg.crashed, menuOpen: window.__dbg.menuOpen,
    };
  });
}

// Sample the actual application framebuffer at the two nozzle openings. A
// second frame hides only the effect for the visual comparison, leaving the
// fighter, camera, lighting and native flight integration in place.
async function nozzlePixels(page) {
  return page.evaluate(() => new Promise(resolve => {
    const scene = window.__scene, exhaust = window.__game.planeMesh.userData.jetExhaust;
    const before = scene.onBeforeRender, after = scene.onAfterRender;
    const samples = [];
    scene.onBeforeRender = function (...args) {
      before?.apply(this, args);
      if (samples.length === 1) exhaust.visible = false;
    };
    scene.onAfterRender = function (renderer, sceneArg, camera, ...args) {
      after?.call(this, renderer, sceneArg, camera, ...args);
      const gl = renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      samples.push(exhaust.children.map(nozzle => {
        const center = nozzle.getWorldPosition(nozzle.position.clone()).project(camera);
        const x = Math.round((center.x + 1) * 0.5 * width);
        const y = Math.round((center.y + 1) * 0.5 * height);
        const pixels = new Uint8Array(5 * 5 * 4);
        gl.readPixels(x - 2, y - 2, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let light = 0;
        for (let i = 0; i < pixels.length; i += 4) light += pixels[i] + pixels[i + 1] + pixels[i + 2];
        return { light: light / 75, x, y, z: center.z };
      }));
      if (samples.length === 3) {
        scene.onBeforeRender = before; scene.onAfterRender = after;
        exhaust.visible = true;
        resolve(samples.slice(0, 2));
      }
    };
  }));
}

test('fighter GLB emits from both nozzles, responds to boost and extinguishes on pause, menu and impact', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [], shaderErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /shader|compile|validate_status/i.test(message.text())) shaderErrors.push(message.text());
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    return route.fulfill({ status: 403, body: 'External services disabled in jet exhaust fixture' });
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await expect(page.locator('#loader')).toBeHidden();
  await page.locator('#btn-solo').click();
  expect(await page.evaluate(() => window.__testFighterFlight())).toBe(true);
  await expect.poll(() => exhaustState(page)).toMatchObject({ key: 'jet', visible: true, rootVisible: true, nozzles: 2 });
  const cruise = await exhaustState(page);
  const pixels = await nozzlePixels(page);
  for (let nozzle = 0; nozzle < 2; nozzle++) {
    expect(pixels[0][nozzle].z).toBeLessThan(1);
    expect(pixels[0][nozzle].light - pixels[1][nozzle].light,
      `nozzle ${nozzle + 1} must brighten actual flight pixels`).toBeGreaterThan(8);
  }
  mkdirSync('.local-baselines/jet-exhaust', { recursive: true });
  await page.screenshot({ path: '.local-baselines/jet-exhaust/cruise.png' });
  await page.keyboard.down('Shift');
  await expect.poll(async () => (await exhaustState(page)).power, { timeout: 12000 }).toBeGreaterThan(cruise.power + 0.18);
  const boost = await exhaustState(page);
  expect(boost.lengths[0]).toBeGreaterThan(cruise.lengths[0] * 1.15);
  await expect.poll(async () => (await exhaustState(page)).power, { timeout: 12000 }).toBeGreaterThan(0.7);
  await page.screenshot({ path: '.local-baselines/jet-exhaust/boost.png' });
  await page.mouse.move(720, 550);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(535, 550, { steps: 12 });
  await page.mouse.up({ button: 'right' });
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(700);
  await page.screenshot({ path: '.local-baselines/jet-exhaust/three-quarter.png' });
  await page.keyboard.up('Shift');
  await page.keyboard.press('Escape');
  await expect.poll(() => exhaustState(page)).toMatchObject({ visible: false, crashed: false, menuOpen: false });
  await page.keyboard.press('Escape');
  await expect.poll(() => exhaustState(page)).toMatchObject({ visible: true });
  await page.keyboard.press('Escape');
  await page.locator('#btn-restart').click();
  await expect(page.locator('#menu')).toBeVisible();
  await expect.poll(() => exhaustState(page)).toMatchObject({ visible: false, menuOpen: true });
  expect(await page.evaluate(() => window.__testFighterFlight())).toBe(true);
  await expect.poll(() => exhaustState(page)).toMatchObject({ visible: true });
  await page.evaluate(() => {
    window.__testTerrainLoading(20);
    window.__game.plane.height = 0;
  });
  await expect.poll(() => exhaustState(page)).toMatchObject({ visible: false, rootVisible: false, crashed: true });
  expect(shaderErrors).toEqual([]);
  expect(errors).toEqual([]);
});
