import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';

function meanLuminance(buffer) {
  const { data, width, height } = PNG.sync.read(buffer);
  let total = 0;
  for (let index = 0; index < data.length; index += 4) {
    total += data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
  }
  return total / (width * height);
}

test('brightness previews immediately on the landing page, aircraft menu and multiplayer lobby', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors = [], external = [], evidence = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.host === '127.0.0.1:5179') return route.continue();
    external.push(url.hostname);
    return route.fulfill({ status: 403, body: 'External network disabled in menu brightness fixture' });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('fotw-settings')) localStorage.setItem('fotw-settings', JSON.stringify({
      quality: 'performance', adaptive: false, brightness: 1,
    }));
  });
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden();
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);

  for (const screen of ['landing', 'menu', 'lobby']) {
    if (screen === 'menu') await page.locator('#btn-solo').click();
    if (screen === 'lobby') {
      await page.locator('#menu-back').click();
      await page.locator('#btn-multi').click();
      await page.evaluate(() => window.__testPopulateLobby(1));
    }
    await expect(page.locator(`#${screen}`)).toBeVisible();
    await expect(page.locator(`#${screen}`)).toHaveCSS('opacity', '1');
    await page.locator('#settings-toggle').click();
    const samples = {};
    for (const level of [50, 0, 100]) {
      await page.locator('#display-brightness').fill(String(level));
      await expect(page.locator('#display-brightness-value')).toHaveText(`${level}%`);
      const multiplier = level === 0 ? 0.35 : level === 100 ? 1.8 : 1;
      const style = await page.evaluate(screen => {
        const surface = document.querySelector(`#${screen}`);
        const preview = surface.querySelector('canvas');
        return {
          background: getComputedStyle(surface).backgroundColor,
          card: getComputedStyle(surface.querySelector('.menu-card')).backgroundColor,
          text: getComputedStyle(surface.querySelector('h1')).color,
          filter: getComputedStyle(surface).filter,
          preview: preview ? getComputedStyle(preview).filter : null,
          dialog: getComputedStyle(document.querySelector('.display-settings-dialog')).backgroundColor,
          label: getComputedStyle(document.querySelector('label[for="display-brightness"]')).color,
        };
      }, screen);
      if (screen !== 'landing') expect(style.preview).toBe(`brightness(${multiplier})`);
      expect(style.filter, 'menu text must not be dimmed together with the scene').toBe('none');
      // This screenshot is outside the dialog but still behind its real
      // backdrop. It tests the pixels the player sees while dragging, rather
      // than merely checking an exposure variable hidden behind the menu.
      const patch = await page.screenshot({ clip: { x: 40, y: 220, width: 80, height: 80 } });
      samples[level] = { ...style, luminance: meanLuminance(patch) };
      if (screen === 'lobby' && level !== 50) {
        await page.screenshot({ path: testInfo.outputPath(`lobby-brightness-${level}.png`) });
      }
    }
    expect(samples[0].luminance, `${screen} visibly darkens while settings remain open`).toBeLessThan(samples[50].luminance * 0.75);
    expect(samples[100].luminance, `${screen} visibly brightens while settings remain open`).toBeGreaterThan(samples[50].luminance * 1.4);
    expect(samples[0].card).not.toBe(samples[50].card);
    expect(samples[100].card).not.toBe(samples[50].card);
    expect(samples[0].text).toBe(samples[100].text);
    expect(samples[0].label).toBe(samples[100].label);
    expect(samples[0].dialog).toBe(samples[100].dialog);
    evidence.push({ screen, samples });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  }
  await page.locator('#settings-toggle').click();
  await page.locator('#display-brightness').fill('75');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.locator('#loader')).toBeHidden();
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#display-brightness')).toHaveValue('75');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--menu-preview-brightness').trim())).toBe(String(Math.sqrt(1.8)));
  expect(errors).toEqual([]);
  expect(external.filter(host => /box\.zakai\.eu|cesium\.com|googleapis\.com/.test(host)), 'menu preview must not request paid terrain').toEqual([]);
  const output = testInfo.outputPath('menu-brightness-pixels.json');
  writeFileSync(output, JSON.stringify(evidence, null, 2));
  await testInfo.attach('menu-brightness-pixels', { path: output, contentType: 'application/json' });
});
