import { expect, test } from '@playwright/test';

async function openAndVerifyGuide(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('/cesium-token-guide.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Jak uzyskać własny token Cesium ion?' })).toBeVisible();

  const images = page.locator('main img');
  await expect(images).toHaveCount(6);
  for (let index = 0; index < await images.count(); index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(
      () => image.evaluate(node => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0),
      { timeout: 30_000 },
    ).toBe(true);
  }
  const imageState = await images.evaluateAll(nodes => (
    nodes.map(node => ({
      complete: node.complete,
      naturalWidth: node.naturalWidth,
      naturalHeight: node.naturalHeight,
      src: node.getAttribute('src'),
    }))
  ));
  expect(imageState.every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)).toBe(true);
  expect(imageState.every(image => image.src?.endsWith('.webp') && image.src.includes('/current/'))).toBe(true);

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).toContain('Spam/Junk');
  expect(bodyText).toContain('Resend verification email');
  expect(bodyText).toContain('wylogowanie i ponowne zalogowanie');
  expect(bodyText).toContain('Twój token zostaje w bieżącej karcie przeglądarki');
  expect(bodyText).toContain('nie udostępnia go innym graczom');
  expect(bodyText).not.toMatch(/schemat/i);

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    overflowingSections: [...document.querySelectorAll('.step')].filter(
      section => section.scrollWidth > section.clientWidth,
    ).length,
  }));
  expect(layout.page).toBeLessThanOrEqual(layout.viewport);
  expect(layout.overflowingSections).toBe(0);
}

test('Cesium token guide uses current redacted screenshots and complete safety guidance', async ({ page }) => {
  test.setTimeout(120_000);
  await openAndVerifyGuide(page, { width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/cesium-guide-desktop.png', fullPage: true });
});

test('Cesium token guide remains readable without horizontal overflow on a phone', async ({ page }) => {
  test.setTimeout(120_000);
  await openAndVerifyGuide(page, { width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/cesium-guide-mobile.png', fullPage: true });
});
