import { expect, test } from '@playwright/test';

const BUTTON = { confirm: 0, back: 1, secondary: 2, start: 9, up: 12, down: 13, left: 14, right: 15 };

test.beforeEach(async ({ context, page }) => {
  await context.route('https://box.zakai.eu/**', route => route.fulfill({ status: 403, body: 'No admission in gamepad UI test' }));
  await context.route('https://api.cesium.com/**', route => route.fulfill({ status: 403, body: 'No terrain in gamepad UI test' }));
  await page.addInitScript(() => {
    let pad = null;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pad ? [pad] : [] });
    window.__uiPad = {
      connect() {
        pad = {
          id: 'UI Test Standard Gamepad', index: 0, connected: true, mapping: 'standard',
          timestamp: performance.now(), axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        const event = new Event('gamepadconnected');
        Object.defineProperty(event, 'gamepad', { value: pad });
        window.dispatchEvent(event);
      },
      button(index, pressed) {
        pad.buttons[index] = { pressed, touched: pressed, value: Number(pressed) };
        pad.timestamp = performance.now();
      },
      axis(index, value) {
        pad.axes[index] = value;
        pad.timestamp = performance.now();
      },
    };
  });
});

async function ready(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#landing')).toBeVisible();
  await page.locator('#input-gamepad').click();
  await page.evaluate(() => window.__uiPad.connect());
  // Browser privacy gating consumes the first press; release before navigation.
  await page.evaluate(() => window.__uiPad.button(0, true));
  await page.waitForTimeout(140);
  await page.evaluate(() => window.__uiPad.button(0, false));
  await page.waitForTimeout(140);
}

async function press(page, index, assertion) {
  await page.evaluate(button => window.__uiPad.button(button, true), index);
  try {
    if (assertion) await assertion();
    else await page.waitForTimeout(140);
  } finally {
    await page.evaluate(button => window.__uiPad.button(button, false), index);
  }
  await page.waitForTimeout(120);
}

test('left stick changes the vehicle; Start activates solo and multiplayer Start', async ({ page }) => {
  await ready(page);
  await page.locator('#btn-solo').click();
  await expect(page.locator('#menu')).toBeVisible();

  const original = await page.locator('#car-name').textContent();
  await page.evaluate(() => window.__uiPad.axis(0, 1));
  await expect(page.locator('#car-name')).not.toHaveText(original);
  await page.evaluate(() => window.__uiPad.axis(0, 0));
  await page.waitForTimeout(120);

  await page.evaluate(() => {
    window.__soloStartClicks = 0;
    document.querySelector('#start-btn').addEventListener('click', event => {
      window.__soloStartClicks++;
      event.stopImmediatePropagation();
    }, true);
  });
  await press(page, BUTTON.start, async () => {
    await expect.poll(() => page.evaluate(() => window.__soloStartClicks)).toBe(1);
  });

  await page.evaluate(() => {
    window.__testPopulateLobby(2);
    document.querySelector('#menu').classList.add('hidden');
    document.querySelector('#lobby').classList.remove('hidden');
    window.__lobbyStartClicks = 0;
    document.querySelector('#lobby-start').addEventListener('click', event => {
      window.__lobbyStartClicks++;
      event.stopImmediatePropagation();
    }, true);
  });
  const lobbyOriginal = await page.locator('#lobby-car-name').textContent();
  await page.evaluate(() => window.__uiPad.axis(0, 1));
  await expect(page.locator('#lobby-car-name')).not.toHaveText(lobbyOriginal);
  await page.evaluate(() => window.__uiPad.axis(0, 0));
  await page.waitForTimeout(120);
  await press(page, BUTTON.start, async () => {
    await expect.poll(() => page.evaluate(() => window.__lobbyStartClicks)).toBe(1);
  });
});

test('D-pad navigates the departure controls without changing vehicles in solo and multiplayer', async ({ page }) => {
  await ready(page);
  await page.locator('#btn-solo').click();
  await expect(page.locator('#menu')).toBeVisible();

  async function checkDepartureNavigation(citySelector, vehicleSelector) {
    const originalVehicle = await page.locator(vehicleSelector).textContent();
    const cityId = citySelector.slice(1);
    const visited = [];
    for (let step = 0; step < 12; step += 1) {
      const focused = await page.evaluate(() => document.activeElement?.id || document.activeElement?.className || 'none');
      visited.push(focused);
      if (focused === cityId) break;
      await press(page, BUTTON.down);
    }
    expect(visited, `D-pad Down should reach ${citySelector} from the active lobby/menu focus`).toContain(cityId);
    await expect(page.locator(vehicleSelector)).toHaveText(originalVehicle);
    await press(page, BUTTON.right, async () => {
      await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('pick-location'))).toBe(true);
    });
    await expect(page.locator(vehicleSelector)).toHaveText(originalVehicle);

    await press(page, BUTTON.left, async () => {
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(cityId);
    });
    await expect(page.locator(vehicleSelector)).toHaveText(originalVehicle);

    await press(page, BUTTON.up, async () => {
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).not.toBe(cityId);
    });
    await expect(page.locator(vehicleSelector)).toHaveText(originalVehicle);
    await press(page, BUTTON.down);
    await expect(page.locator(vehicleSelector)).toHaveText(originalVehicle);
  }

  await checkDepartureNavigation('#city-input', '#car-name');

  await page.evaluate(() => {
    window.__testPopulateLobby(2);
    document.querySelector('#menu').classList.add('hidden');
    document.querySelector('#lobby').classList.remove('hidden');
  });
  await expect(page.locator('#lobby')).toBeVisible();
  await page.locator('#lobby .mode-card[data-mode="free"]').click();
  await expect(page.locator('#lobby-city')).toBeVisible();
  await checkDepartureNavigation('#lobby-city', '#lobby-car-name');
});

test('D-pad skips map attribution links while navigating the location dialog', async ({ page }) => {
  await ready(page);
  await page.locator('#btn-solo').click();
  await page.locator('#city-input').fill('52.230000, 21.010000');
  await page.locator('#city-input + .pick-location').click();
  await expect(page.locator('.location-dialog')).toBeVisible();
  const attribution = page.locator('.location-dialog .leaflet-control-attribution a');
  await expect(attribution.first()).toBeVisible();
  await expect(page.locator('#pin-use')).toBeEnabled();

  await page.locator('#pin-query').focus();
  await press(page, BUTTON.right, async () => {
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('pin-search-submit');
  });

  for (const selector of ['#pin-close', '#pin-query', '#pin-search-submit', '#pin-use']) {
    for (const direction of [BUTTON.up, BUTTON.down, BUTTON.left, BUTTON.right]) {
      await page.locator(selector).focus();
      await press(page, direction);
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.leaflet-control-attribution'))),
        `D-pad ${direction} from ${selector} must not focus map attribution`).toBe(false);
    }
  }
});

test('X picks up the departure pin; D-pad moves it; X drops it', async ({ page }) => {
  await ready(page);
  await page.locator('#btn-solo').click();
  await page.locator('#city-input + .pick-location').click();
  await expect(page.locator('.location-dialog')).toBeVisible();

  await press(page, BUTTON.secondary, async () => {
    await expect(page.locator('#pin-status')).toContainText('Pin picked up');
  });
  const before = await page.locator('#pin-status').textContent();
  await press(page, BUTTON.right, async () => {
    await expect(page.locator('#pin-status')).not.toHaveText(before);
  });
  const afterDpad = await page.locator('#pin-status').textContent();
  await page.evaluate(() => window.__uiPad.axis(0, -1));
  await expect(page.locator('#pin-status')).not.toHaveText(afterDpad);
  await page.evaluate(() => window.__uiPad.axis(0, 0));
  await page.waitForTimeout(120);
  await press(page, BUTTON.secondary, async () => {
    await expect(page.locator('#pin-status')).not.toContainText('Pin picked up');
  });
  await expect(page.locator('#pin-use')).toBeEnabled();
  await page.locator('#pin-use').focus();
  await press(page, BUTTON.confirm, async () => {
    await expect(page.locator('.location-dialog')).toBeHidden();
  });
  await expect(page.locator('#city-input')).toHaveValue(/^-?\d+\.\d{6}, -?\d+\.\d{6}$/);
});

test('pause audio controls and multiplayer nickname work without a keyboard', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    document.querySelector('#landing').classList.add('hidden');
    document.querySelector('#pause').classList.add('show');
  });
  await page.locator('#music-pause-toggle').focus();
  await press(page, BUTTON.confirm, async () => {
    await expect(page.locator('#music-pause-toggle')).toHaveAttribute('aria-pressed', 'true');
  });
  await page.locator('#ambient-pause-volume').evaluate(input => {
    input.value = '45';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  await press(page, BUTTON.right, async () => {
    await expect(page.locator('#ambient-pause-volume')).toHaveValue('46');
  });
  await expect(page.locator('#ambient-game-volume')).toHaveValue('46');

  await page.evaluate(() => {
    document.querySelector('#pause').classList.remove('show');
    window.__testPopulateLobby(2);
    document.querySelector('#lobby').classList.remove('hidden');
  });
  await expect(page.locator('#player-name-input')).toBeVisible();
  await page.locator('#player-name-input').focus();
  await press(page, BUTTON.confirm, async () => {
    await expect(page.locator('#gamepad-keyboard')).toBeVisible();
  });
  await page.locator('[data-gamepad-key="A"]').focus();
  await press(page, BUTTON.confirm, async () => {
    await expect(page.locator('#player-name-input')).toHaveValue('HostA');
  });
  await page.locator('[data-gamepad-keyboard-action="done"]').focus();
  await press(page, BUTTON.confirm, async () => {
    await expect(page.locator('#gamepad-keyboard')).toBeHidden();
  });
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('form')?.className)).toBe('player-name-form');
});
