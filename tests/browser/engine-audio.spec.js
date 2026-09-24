import { test, expect } from '@playwright/test';

test('recorded jet engines soften the narrow whistle without losing their loops', async ({ page }) => {
  test.setTimeout(75000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.fulfill({ status: 503, body: 'offline audio fixture' }));
  await page.addInitScript(() => {
    window.__engineFilters = [];
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      createBiquadFilter() {
        const filter = super.createBiquadFilter();
        window.__engineFilters.push(filter);
        return filter;
      }
    };
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.keyboard.press('z'); // Web Audio requires a real user gesture.

  expect(await page.evaluate(() => window.__testVisualVehicle('boeing737'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.audio?.activeSample),
    { timeout: 20000 }).toBe('airliner');
  expect(await page.evaluate(() => window.__engineFilters.some(filter =>
    filter.type === 'lowpass' && Math.abs(filter.frequency.value - 3600) < 1 &&
    Math.abs(filter.Q.value - 0.65) < 0.001
  ))).toBe(true);

  expect(await page.evaluate(() => window.__testVisualVehicle('b2'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.audio?.activeSample),
    { timeout: 20000 }).toBe('b2');
  expect(await page.evaluate(() => window.__engineFilters.some(filter =>
    filter.type === 'peaking' && Math.abs(filter.frequency.value - 2400) < 1 &&
    Math.abs(filter.Q.value - 0.9) < 0.001 && Math.abs(filter.gain.value + 7) < 0.001
  ))).toBe(true);
  expect(errors).toEqual([]);
});
