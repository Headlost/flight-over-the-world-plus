import { expect, test } from '@playwright/test';

const TEST_GAMEPAD_ID = 'Test Standard Gamepad (STANDARD GAMEPAD)';
const BUTTON = Object.freeze({
  confirm: 0,
  back: 1,
  secondary: 2,
  faceNorth: 3,
  leftShoulder: 4,
  rightShoulder: 5,
  boost: 7,
  dpadUp: 12,
  dpadLeft: 14,
  dpadRight: 15,
});

async function installGamepadFixture(page) {
  await page.addInitScript(({ id }) => {
    const pads = [];
    const effects = [];
    let sequence = 0;
    let deferMicrophone = false;
    let microphoneResolve = null;
    let microphoneRequests = 0;

    const copyEffect = (kind, type, parameters = {}) => {
      effects.push({
        kind,
        type,
        parameters: { ...parameters },
      });
    };

    function createActuator() {
      return {
        type: 'dual-rumble',
        async playEffect(type, parameters) {
          copyEffect('playEffect', type, parameters);
          return 'complete';
        },
        async pulse(value, duration) {
          copyEffect('pulse', 'pulse', { value, duration });
          return true;
        },
        async reset() {
          copyEffect('reset', 'reset');
          return 'complete';
        },
      };
    }

    function dispatchGamepadEvent(type, gamepad) {
      const event = new Event(type);
      Object.defineProperty(event, 'gamepad', {
        configurable: true,
        enumerable: true,
        value: gamepad,
      });
      window.dispatchEvent(event);
    }

    function touch(gamepad) {
      sequence += 1;
      gamepad.timestamp = performance.now() + sequence;
    }

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => pads.slice(),
    });

    const microphoneTrack = { enabled: false, stop() {} };
    const microphoneStream = { getAudioTracks: () => [microphoneTrack] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          microphoneRequests += 1;
          if (!deferMicrophone) return microphoneStream;
          return new Promise(resolve => { microphoneResolve = () => resolve(microphoneStream); });
        },
      },
    });

    window.__gamepadFixture = {
      deferMicrophone() {
        deferMicrophone = true;
      },

      resolveMicrophone() {
        const resolve = microphoneResolve;
        microphoneResolve = null;
        deferMicrophone = false;
        resolve?.();
        return Boolean(resolve);
      },

      microphoneRequests() {
        return microphoneRequests;
      },

      connect(index = 0) {
        const actuator = createActuator();
        const gamepad = {
          id,
          index,
          connected: true,
          mapping: 'standard',
          timestamp: performance.now(),
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 17 }, () => ({
            pressed: false,
            touched: false,
            value: 0,
          })),
          vibrationActuator: actuator,
          hapticActuators: [actuator],
        };
        pads[index] = gamepad;
        dispatchGamepadEvent('gamepadconnected', gamepad);
        return { id: gamepad.id, index: gamepad.index };
      },

      disconnect(index = 0) {
        const gamepad = pads[index];
        if (!gamepad) return false;
        gamepad.connected = false;
        touch(gamepad);
        pads[index] = null;
        dispatchGamepadEvent('gamepaddisconnected', gamepad);
        return true;
      },

      setButton(buttonIndex, pressed, value = pressed ? 1 : 0, index = 0) {
        const gamepad = pads[index];
        if (!gamepad) throw new Error(`No connected gamepad at index ${index}`);
        gamepad.buttons[buttonIndex] = {
          pressed: Boolean(pressed),
          touched: Boolean(pressed) || Number(value) > 0,
          value: Number(value),
        };
        touch(gamepad);
      },

      setAxis(axisIndex, value, index = 0) {
        const gamepad = pads[index];
        if (!gamepad) throw new Error(`No connected gamepad at index ${index}`);
        gamepad.axes[axisIndex] = Math.max(-1, Math.min(1, Number(value)));
        touch(gamepad);
      },

      snapshot() {
        return {
          connected: pads.filter(Boolean).map(gamepad => ({
            id: gamepad.id,
            index: gamepad.index,
            axes: [...gamepad.axes],
            buttons: gamepad.buttons.map(button => ({ ...button })),
          })),
          effects: effects.map(effect => ({
            ...effect,
            parameters: { ...effect.parameters },
          })),
        };
      },
    };
  }, { id: TEST_GAMEPAD_ID });
}

async function connectGamepad(page, index = 0) {
  await page.evaluate(gamepadIndex => window.__gamepadFixture.connect(gamepadIndex), index);
  await expect(page.locator('#gamepad-list')).toContainText(TEST_GAMEPAD_ID);
}

async function chooseGamepadInput(page) {
  const choice = page.locator('#input-gamepad');
  await choice.click();
  await expect.poll(() => choice.evaluate(element => {
    if ('checked' in element) return element.checked;
    return element.getAttribute('aria-pressed') === 'true'
      || element.getAttribute('aria-selected') === 'true';
  })).toBe(true);
}

async function setGamepadButton(page, button, pressed, value = pressed ? 1 : 0) {
  await page.evaluate(({ button, pressed, value }) => {
    window.__gamepadFixture.setButton(button, pressed, value);
  }, { button, pressed, value });
}

async function wakeGamepad(page) {
  // The manager deliberately consumes the first hardware gesture because
  // privacy-gated browsers may reveal a controller only on that gesture. A
  // neutral frame is required before controls may activate lobby UI.
  await setGamepadButton(page, BUTTON.confirm, true);
  await page.waitForTimeout(120);
  await setGamepadButton(page, BUTTON.confirm, false);
  await page.waitForTimeout(120);
}

async function pressGamepadButton(page, button, assertion) {
  await setGamepadButton(page, button, true);
  try {
    if (assertion) await assertion();
    else await page.waitForTimeout(120);
  } finally {
    await setGamepadButton(page, button, false);
  }
  // Chromium is capped to one application frame per 66 ms under WebDriver.
  // Waiting through a neutral frame prevents the next press being treated as
  // one continuous hold by the edge-triggered gamepad manager.
  await page.waitForTimeout(100);
}

async function setGamepadAxis(page, axis, value) {
  await page.evaluate(({ axis, value }) => {
    window.__gamepadFixture.setAxis(axis, value);
  }, { axis, value });
}

test.beforeEach(async ({ context, page }) => {
  await context.route('https://box.zakai.eu/**', route => route.fulfill({
    status: 403,
    body: 'Production admission disabled in gamepad fixtures',
  }));
  await context.route('https://api.cesium.com/**', route => route.fulfill({
    status: 403,
    body: 'Terrain disabled in gamepad fixtures',
  }));
  await installGamepadFixture(page);
});

test('detects a standard pad on the landing screen and attempts optional haptics', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#landing')).toBeVisible();
  await expect(page.locator('#input-keyboard')).toBeVisible();
  await expect(page.locator('#input-gamepad')).toBeVisible();
  await expect(page.locator('#gamepad-panel')).toBeHidden();

  await chooseGamepadInput(page);
  await expect(page.locator('#gamepad-panel')).toBeVisible();
  await expect(page.locator('#gamepad-status')).not.toHaveText('');

  await connectGamepad(page);
  await wakeGamepad(page);

  const vibration = page.locator('#gamepad-vibration');
  await expect(vibration).toBeVisible();
  if (await vibration.evaluate(element => 'checked' in element)) {
    if (!await vibration.isChecked()) await vibration.check();
  } else {
    await vibration.click();
  }
  await expect(page.locator('#gamepad-vibration-test')).toBeEnabled();
  await page.locator('#gamepad-vibration-test').click();
  await expect.poll(() => page.evaluate(() => window.__gamepadFixture.snapshot().effects.length)).toBeGreaterThan(0);

  const effect = await page.evaluate(() => window.__gamepadFixture.snapshot().effects[0]);
  expect(['playEffect', 'pulse']).toContain(effect.kind);
  expect(errors).toEqual([]);
});

test('uses D-pad, left stick, A and B from the first screen through the solo menu', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await connectGamepad(page);
  await chooseGamepadInput(page);
  await wakeGamepad(page);

  await page.locator('#btn-solo').focus();
  await pressGamepadButton(page, BUTTON.dpadRight, async () => {
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('btn-multi');
  });

  await setGamepadAxis(page, 0, -1);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('btn-solo');
  await setGamepadAxis(page, 0, 0);
  await page.waitForTimeout(100);

  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#landing')).toBeHidden();
  });

  await pressGamepadButton(page, BUTTON.back, async () => {
    await expect(page.locator('#landing')).toBeVisible();
    await expect(page.locator('#menu')).toBeHidden();
  });
});

test('enters a city with the TV-style keyboard using D-pad, left stick and confirm', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await connectGamepad(page);
  await chooseGamepadInput(page);
  await wakeGamepad(page);

  await page.locator('#btn-solo').focus();
  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect(page.locator('#menu')).toBeVisible();
  });

  await page.locator('#city-input').focus();
  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect(page.locator('#gamepad-keyboard')).toBeVisible();
  });
  await expect.poll(() => page.evaluate(() => document.activeElement?.dataset?.gamepadKey)).toBe('1');

  await pressGamepadButton(page, BUTTON.dpadRight, async () => {
    await expect.poll(() => page.evaluate(() => document.activeElement?.dataset?.gamepadKey)).toBe('2');
  });
  await setGamepadAxis(page, 0, -1);
  await expect.poll(() => page.evaluate(() => document.activeElement?.dataset?.gamepadKey)).toBe('1');
  await setGamepadAxis(page, 0, 0);
  await page.waitForTimeout(100);

  await page.locator('[data-gamepad-keyboard-action="clear"]').focus();
  await pressGamepadButton(page, BUTTON.confirm);
  for (const character of ['P', 'A', 'R', 'I', 'S']) {
    await page.locator(`[data-gamepad-key="${character}"]`).focus();
    await pressGamepadButton(page, BUTTON.confirm);
  }
  await expect(page.locator('#city-input')).toHaveValue('PARIS');

  await page.locator('[data-gamepad-keyboard-action="done"]').focus();
  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect(page.locator('#gamepad-keyboard')).toBeHidden();
  });
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('start-btn');
});

test('uses the left bumper for push-to-talk and returns from Street View when the game regains focus', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await connectGamepad(page);
  await chooseGamepadInput(page);
  await wakeGamepad(page);

  expect(await page.evaluate(() => window.__testPopulateLobby(2))).toBe(2);
  await page.evaluate(() => window.__gamepadFixture.deferMicrophone());
  await setGamepadButton(page, BUTTON.leftShoulder, true);
  await expect.poll(() => page.evaluate(() => window.__gamepadFixture.microphoneRequests())).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => window.__gamepadFixture.resolveMicrophone())).toBe(true);
  await expect.poll(() => page.evaluate(() => ({
    talkOn: window.__testLobbyMessages.some(entry => (
      entry.kind === 'send' && entry.data?.t === 'talk' && entry.data?.on === true
    )),
    hardwareHeld: window.__gamepadFixture.snapshot().connected[0]?.buttons[4]?.pressed,
    managerHeld: window.__dbg?.gamepad?.buttons?.leftShoulder,
    voiceText: document.querySelector('#voice-ind')?.textContent,
  }))).toMatchObject({ talkOn: true, hardwareHeld: true, managerHeld: false });
  await setGamepadButton(page, BUTTON.leftShoulder, false);
  await expect.poll(() => page.evaluate(() => window.__testLobbyMessages.some(entry => (
    entry.kind === 'send' && entry.data?.t === 'talk' && entry.data?.on === false
  )))).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(160);

  expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
  await page.evaluate(() => {
    window.__testStreetWindow = { closed: false, opener: window, close() { this.closed = true; } };
    window.open = () => window.__testStreetWindow;
  });
  await pressGamepadButton(page, BUTTON.rightShoulder, async () => {
    await expect(page.locator('#street-prompt')).toBeVisible();
  });
  await page.locator('#street-enter').focus();
  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect(page.locator('#street-mode')).toHaveClass(/open/);
  });
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
  });
  await expect(page.locator('#street-mode')).toHaveClass(/open/);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(async () => {
    return page.locator('#street-mode').evaluate(node => node.classList.contains('open'));
  }).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__testStreetWindow.closed)).toBe(true);
});

test('right bumper closes the Street View popup even while the game is blurred', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await connectGamepad(page);
  await chooseGamepadInput(page);
  await wakeGamepad(page);
  expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
  await page.evaluate(() => {
    window.__testStreetWindow = { closed: false, close() { this.closed = true; } };
    window.open = () => window.__testStreetWindow;
  });
  await page.locator('#street-view-link').click();
  await page.locator('#street-enter').click();
  await expect(page.locator('#street-mode')).toHaveClass(/open/);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(180);
  await setGamepadButton(page, BUTTON.rightShoulder, true);
  await expect.poll(() => page.evaluate(() => window.__testStreetWindow.closed)).toBe(true);
  await expect(page.locator('#street-mode')).not.toHaveClass(/open/);
  await setGamepadButton(page, BUTTON.rightShoulder, false);
});

test('space hints show A for orbit and Y for atmosphere on a standard gamepad', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await connectGamepad(page);
  await chooseGamepadInput(page);
  await wakeGamepad(page);
  expect(await page.evaluate(() => window.__testRocketLaunch())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
  expect(await page.evaluate(() => window.__testSpaceApproach('Mars', 240, 0))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceActionHint?.key)).toBe('A');
  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect.poll(() => page.evaluate(() => window.__dbg?.orbitBody)).toBe('Mars');
  });
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceActionHint?.key)).toBe('Y');
});

test('uses D-pad for flight and Y/A as Q/E rudder on Dziki Dzik', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await connectGamepad(page);
  await chooseGamepadInput(page);
  await wakeGamepad(page);

  expect(await page.evaluate(() => window.__testPopulateLobby(2))).toBe(2);
  expect(await page.evaluate(() => Boolean(window.__testMultiplayerContactPose({
    key: 'dzikiDzik', state: 'airborne', h: 1400,
  })))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.selectedPlane)).toBe('dzikiDzik');

  await setGamepadButton(page, BUTTON.dpadRight, true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.controls?.roll || 0)).toBeGreaterThan(0.3);
  await setGamepadButton(page, BUTTON.dpadRight, false);
  await setGamepadButton(page, BUTTON.dpadUp, true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.controls?.pitch || 0)).toBeLessThan(-0.3);
  await setGamepadButton(page, BUTTON.dpadUp, false);

  await setGamepadButton(page, BUTTON.faceNorth, true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.controls?.yaw || 0)).toBeLessThan(-0.3);
  await setGamepadButton(page, BUTTON.faceNorth, false);
  await setGamepadButton(page, BUTTON.confirm, true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.controls?.yaw || 0)).toBeGreaterThan(0.3);
  await setGamepadButton(page, BUTTON.confirm, false);
});

test('secondary button toggles Boeing and Airbus contrails as well as Dziki smoke', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.__game))).toBe(true);
  await connectGamepad(page);
  await chooseGamepadInput(page);
  await wakeGamepad(page);

  const toggle = page.locator('#acro-smoke-toggle');
  for (const key of ['boeing737', 'a380', 'dzikiDzik']) {
    expect(await page.evaluate(vehicle => window.__testVisualVehicle(vehicle), key)).toBe(true);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await pressGamepadButton(page, BUTTON.secondary);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await pressGamepadButton(page, BUTTON.secondary);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }

  expect(await page.evaluate(() => window.__testVisualVehicle('mooney'))).toBe(true);
  await expect(toggle).toBeHidden();
  await pressGamepadButton(page, BUTTON.secondary);
  expect(await page.evaluate(() => window.__dbg.acroSmokeEnabled)).toBe(true);
});

test('secondary button cycles the parachutist camera through close, first-person and distant views', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await connectGamepad(page);
  await chooseGamepadInput(page);
  await wakeGamepad(page);

  expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.selectedPlane)).toBe('parachutist');
  await expect.poll(() => page.evaluate(() => window.__dbg?.orbitZoom)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__dbg?.firstPerson)).toBe(false);

  await pressGamepadButton(page, BUTTON.secondary, async () => {
    await expect.poll(() => page.evaluate(() => window.__dbg?.orbitZoom)).toBe(0.7);
    await expect.poll(() => page.evaluate(() => window.__dbg?.firstPerson)).toBe(false);
  });
  await pressGamepadButton(page, BUTTON.secondary, async () => {
    await expect.poll(() => page.evaluate(() => window.__dbg?.orbitZoom)).toBe(0.5);
    await expect.poll(() => page.evaluate(() => window.__dbg?.firstPerson)).toBe(true);
  });
  await pressGamepadButton(page, BUTTON.secondary, async () => {
    await expect.poll(() => page.evaluate(() => window.__dbg?.orbitZoom)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__dbg?.firstPerson)).toBe(false);
  });
});

test('rocket black-hole warning offers Sound On through gamepad A and escalates haptics', async ({ page }) => {
  test.setTimeout(30000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await connectGamepad(page);
  await chooseGamepadInput(page);
  await wakeGamepad(page);
  expect(await page.evaluate(() => window.__testRocketLaunch())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);

  await page.locator('#music-game-toggle').click();
  await expect.poll(() => page.evaluate(() => window.__dbg?.music?.muted)).toBe(true);
  await page.locator('#ambient-game-volume').evaluate(input => {
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => window.__testSpaceApproach('Galactic Core', 4000, 92))).toBe(true);
  await expect(page.locator('#black-hole-sound-prompt')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/black-hole-sound-warning/);
  await expect(page.locator('body')).toHaveClass(/black-hole-music-off/);
  await expect(page.locator('body')).toHaveClass(/black-hole-ambient-off/);
  await expect.poll(() => page.evaluate(() => window.__gamepadFixture.snapshot().effects
    .some(effect => effect.parameters.duration >= 105 && effect.parameters.strongMagnitude >= 0.15))).toBe(true);

  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect.poll(() => page.evaluate(() => window.__dbg?.music?.muted)).toBe(false);
    await expect.poll(() => page.locator('#ambient-game-volume').inputValue()).toBe('100');
    expect(await page.evaluate(() => window.__dbg?.orbitBody)).toBeNull();
  });
  // Some browsers require a trusted pointer gesture to unblock media despite
  // the pad's explicit action. Keep the prompt available until audio plays.
  if (await page.locator('#black-hole-sound-prompt').isVisible()) {
    await page.locator('#black-hole-sound-prompt button').click();
  }
  await expect(page.locator('#black-hole-sound-prompt')).toBeHidden();
  expect(await page.evaluate(() => window.__testSpaceApproach('Galactic Core', 10000, 92))).toBe(true);
  await expect(page.locator('body')).not.toHaveClass(/black-hole-sound-warning/);
});

test('controls the multiplayer lobby carousel and returns with the back button', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await connectGamepad(page);
  await chooseGamepadInput(page);
  await wakeGamepad(page);

  await page.locator('#btn-multi').focus();
  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect(page.locator('#lobby')).toBeVisible();
    await expect(page.locator('#landing')).toBeHidden();
  });

  await page.locator('#lobby-car-prev').focus();
  await pressGamepadButton(page, BUTTON.dpadRight, async () => {
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('lobby-car-next');
  });
  const initialVehicle = await page.locator('#lobby-car-name').textContent();
  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect(page.locator('#lobby-car-name')).not.toHaveText(initialVehicle || '');
  });

  await pressGamepadButton(page, BUTTON.back, async () => {
    await expect(page.locator('#landing')).toBeVisible();
    await expect(page.locator('#lobby')).toBeHidden();
  });
});

test('navigates the vehicle carousel, then clears held flight input on disconnect', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.__game))).toBe(true);
  await connectGamepad(page);
  await chooseGamepadInput(page);
  await wakeGamepad(page);

  await page.locator('#btn-solo').focus();
  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect(page.locator('#menu')).toBeVisible();
  });

  await page.locator('#car-prev').focus();
  await pressGamepadButton(page, BUTTON.dpadRight, async () => {
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('car-next');
  });
  const initialVehicle = await page.locator('#car-name').textContent();
  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect(page.locator('#car-name')).not.toHaveText(initialVehicle || '');
  });

  // Return to the first aircraft so the flight-input assertion is independent
  // of vehicle-specific aerobatic response curves.
  for (let clicks = 0; clicks < 10
    && (await page.locator('#car-name').textContent())?.trim() !== 'Mooney M20M'; clicks += 1) {
    await page.locator('#car-next').click();
  }
  await expect(page.locator('#car-name')).toHaveText('Mooney M20M');
  await page.evaluate(() => window.__testTerrainLoading(20));
  await page.locator('#city-input').fill('52.249558, 20.985260');
  await page.locator('#start-btn').focus();
  await pressGamepadButton(page, BUTTON.confirm, async () => {
    await expect(page.locator('#menu')).toBeHidden({ timeout: 12000 });
  });

  await setGamepadAxis(page, 0, 0.85);
  await setGamepadAxis(page, 1, -0.7);
  await setGamepadButton(page, BUTTON.boost, true);
  await expect.poll(() => page.evaluate(() => ({
    roll: Math.abs(window.__dbg?.controls?.roll || 0),
    pitch: Math.abs(window.__dbg?.controls?.pitch || 0),
    throttle: window.__dbg?.controls?.throttle || 0,
  }))).toMatchObject({
    roll: expect.any(Number),
    pitch: expect.any(Number),
    throttle: 1,
  });
  await expect.poll(() => page.evaluate(() => Math.abs(window.__dbg?.controls?.roll || 0))).toBeGreaterThan(0.3);
  await expect.poll(() => page.evaluate(() => Math.abs(window.__dbg?.controls?.pitch || 0))).toBeGreaterThan(0.2);

  const connectedStatus = await page.locator('#gamepad-status').textContent();
  expect(await page.evaluate(() => window.__gamepadFixture.disconnect())).toBe(true);
  await expect(page.locator('#gamepad-status')).not.toHaveText(connectedStatus || '');
  await expect.poll(() => page.evaluate(() => {
    const controls = window.__dbg?.controls;
    if (!controls) return Number.POSITIVE_INFINITY;
    return Math.abs(controls.roll) + Math.abs(controls.pitch) + Math.abs(controls.throttle);
  })).toBeLessThan(0.08);

  expect(errors).toEqual([]);
});
