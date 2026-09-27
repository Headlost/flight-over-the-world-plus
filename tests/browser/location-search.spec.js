import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('https://box.zakai.eu/**', route => route.fulfill({ status: 403, body: 'No admission in location fixture' }));
  await context.route('https://api.cesium.com/**', route => route.fulfill({ status: 403, body: 'No terrain in location fixture' }));
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6kWQAAAAASUVORK5CYII=', 'base64') }));
});

async function openPicker(page) {
  await page.goto(process.env.DEPARTURE_LIVE_URL || '/', { waitUntil: 'domcontentloaded' });
  await page.locator('#btn-solo').click();
  await page.locator('#menu [data-mode=free]').click();
  await page.locator('#city-input').fill('');
  await page.locator('#city-input-choose-map').click();
  await expect(page.locator('#pin-status')).toContainText('Click the map');
}

const washington = { features: [
  { geometry: { coordinates: [21.0737, 52.2423] }, properties: { name: 'Washington', osm_value: 'cafe', country: 'Poland' } },
  { geometry: { coordinates: [-120.2126, 47.2868] }, properties: { name: 'Washington', osm_value: 'state', country: 'United States' } },
  { geometry: { coordinates: [-77.036385, 38.895098] }, properties: { name: 'Washington', osm_value: 'city', state: 'District of Columbia', country: 'United States' } },
] };

test('hemisphere coordinates reach the exact Atlantic position without geocoding; invalid coordinates cannot reuse a pin', async ({ page }) => {
  let requests = 0;
  await page.route('https://photon.komoot.io/api/**', route => { requests++; return route.fulfill({ json: washington }); });
  await openPicker(page);
  await page.locator('#pin-query').fill('29.0000° N, 79.0000° W  ');
  await page.locator('#pin-search-submit').click();
  await expect(page.locator('#pin-status')).toContainText('29.000000, -79.000000');
  await expect(page.locator('#pin-use')).toBeEnabled();
  await page.locator('#pin-query').fill('91° N, 79° W');
  await expect(page.locator('#pin-use')).toBeDisabled();
  await page.locator('#pin-search-submit').click();
  await expect(page.locator('#pin-status')).toContainText('Coordinates:');
  await expect(page.locator('#pin-use')).toBeDisabled();
  await page.locator('#pin-query').fill('29°0′0″N 79°0′0″W');
  await page.locator('#pin-search-submit').click();
  await expect(page.locator('#pin-status')).toContainText('29.000000, -79.000000');
  await page.locator('#pin-use').click();
  await expect(page.locator('#city-input')).toHaveValue('29.000000, -79.000000');
  expect(requests).toBe(0);
});

test('Waszyngton selects the US city first and exposes other labelled results for keyboard selection', async ({ page }) => {
  const queries = [];
  await page.route('https://photon.komoot.io/api/**', route => {
    const url = new URL(route.request().url());
    queries.push(url.searchParams.get('q'));
    expect(url.searchParams.get('limit')).toBe('8');
    return route.fulfill({ json: washington });
  });
  await openPicker(page);
  await page.locator('#pin-query').fill('Waszyngton');
  await page.locator('#pin-search-submit').click();
  await expect(page.locator('#pin-status')).toContainText('38.895098, -77.036385');
  await expect(page.locator('#pin-status')).toContainText('District of Columbia, United States');
  const matches = page.locator('#pin-results button');
  await expect(matches).toHaveCount(3);
  await expect(matches.first()).toHaveAttribute('aria-pressed', 'true');
  const local = page.locator('#pin-results button').filter({ hasText: 'Poland' });
  await local.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pin-status')).toContainText('52.242300, 21.073700');
  await expect(local).toHaveAttribute('aria-pressed', 'true');
  expect(queries).toEqual(['Washington DC']);
});

test('an old network result cannot overwrite a newer coordinate search', async ({ page }) => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  let markRequested;
  const requested = new Promise(resolve => { markRequested = resolve; });
  await page.route('https://photon.komoot.io/api/**', async route => {
    markRequested(); await wait; await route.fulfill({ json: washington });
  });
  await openPicker(page);
  await page.locator('#pin-query').fill('Washington');
  await page.locator('#pin-search-submit').click();
  await requested;
  await page.locator('#pin-query').fill('29 N, 79 W');
  await page.locator('#pin-search-submit').click();
  await expect(page.locator('#pin-status')).toContainText('29.000000, -79.000000');
  const response = page.waitForResponse('https://photon.komoot.io/api/**');
  release(); await (await response).finished();
  await expect(page.locator('#pin-results')).toBeHidden();
  await page.locator('#pin-use').click();
  await expect(page.locator('#city-input')).toHaveValue('29.000000, -79.000000');
});
