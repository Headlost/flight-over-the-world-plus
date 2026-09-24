import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GamepadControls,
  findSpatialNavigationTarget,
  getConfirmBackButtons,
  getGamepadButtonLabels,
  identifyGamepadFamily,
  loadGamepadPreferences,
  normalizeGamepadPreferences,
  normalizeStick,
  readGamepadState,
  saveGamepadPreferences,
} from '../src/game/gamepadControls.js';

function button(pressed = false, value = pressed ? 1 : 0) {
  return { pressed, touched: pressed || value > 0, value };
}

function makePad(overrides = {}) {
  return {
    id: 'Xbox Wireless Controller',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => button()),
    ...overrides,
  };
}

test('radial deadzone is continuous, circular and clamps diagonal magnitude', () => {
  assert.deepEqual(normalizeStick(0.12, 0, 0.16), { x: 0, y: 0, magnitude: 0 });
  const edge = normalizeStick(0.160001, 0, 0.16);
  assert.ok(edge.x > 0 && edge.x < 0.00001);
  const diagonal = normalizeStick(1, 1, 0.16);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12);
  assert.ok(diagonal.x > 0 && diagonal.y > 0);
});

test('controller families use their visible confirm and back conventions', () => {
  assert.equal(identifyGamepadFamily('Xbox Wireless Controller'), 'xbox');
  assert.equal(identifyGamepadFamily('Sony DualSense Wireless Controller'), 'playstation');
  assert.equal(identifyGamepadFamily('Nintendo Switch Pro Controller'), 'nintendo');
  assert.equal(identifyGamepadFamily('USB joystick'), 'generic');
  assert.deepEqual(getConfirmBackButtons('xbox'), { confirm: 0, back: 1 });
  assert.deepEqual(getConfirmBackButtons('nintendo'), { confirm: 1, back: 0 });
  assert.equal(getGamepadButtonLabels('playstation').confirm, 'Cross');
  assert.equal(getGamepadButtonLabels('nintendo').confirm, 'A');
  assert.equal(getGamepadButtonLabels('xbox').select, 'View');
  assert.equal(getGamepadButtonLabels('playstation').rightStick, 'R3');
});

test('standard state maps sticks, triggers, shoulders and D-pad into semantic controls', () => {
  const pad = makePad({
    axes: [0.7, -0.65, -0.5, 0.8],
    buttons: Array.from({ length: 17 }, (_, index) => {
      if (index === 5 || index === 12) return button(true);
      if (index === 6) return button(false, 0.25);
      if (index === 7) return button(true, 0.9);
      return button();
    }),
  });
  const state = readGamepadState(pad, { deadzone: 0.1 });
  assert.ok(state.flight.roll > 0.6);
  assert.ok(state.flight.pitch < -0.5, 'stick-up follows the existing W/up pitch convention');
  assert.ok(state.flight.lookX < -0.4 && state.flight.lookY > 0.7);
  assert.equal(state.flight.yaw, 0);
  assert.equal(state.buttons.rightShoulder, true);
  assert.ok(state.flight.throttle > 0.6);
  assert.equal(state.buttons.navUp, true);
  assert.equal(state.mapping, 'standard');
});

test('Nintendo auto layout swaps confirm/back while explicit standard layout remains positional', () => {
  const buttons = Array.from({ length: 17 }, () => button());
  buttons[1] = button(true);
  let state = readGamepadState(makePad({
    id: 'Nintendo Switch Pro Controller',
    buttons,
  }));
  assert.equal(state.buttons.confirm, true);
  assert.equal(state.buttons.back, false);

  buttons[1] = button();
  buttons[0] = button(true);
  state = readGamepadState(makePad({
    id: 'Nintendo Switch Pro Controller',
    buttons,
  }), { layout: 'standard' });
  assert.equal(state.buttons.confirm, true);
  assert.equal(state.labels.confirm, 'A');
});

test('diagonal stick or D-pad input produces only one menu direction per frame', () => {
  const buttons = Array.from({ length: 17 }, () => button());
  buttons[12] = button(true);
  buttons[15] = button(true);
  let state = readGamepadState(makePad({ buttons }));
  assert.equal(state.buttons.navUp, true);
  assert.equal(state.buttons.navRight, false);

  state = readGamepadState(makePad({ axes: [0.9, 0.7, 0, 0] }), { deadzone: 0.1 });
  assert.equal(state.buttons.navRight, true);
  assert.equal(state.buttons.navDown, false);
});

test('D-pad mirrors the left stick during flight and Y/A mirror Q/E yaw', () => {
  const buttons = Array.from({ length: 17 }, () => button());
  buttons[12] = button(true);
  buttons[15] = button(true);
  buttons[3] = button(true);
  let state = readGamepadState(makePad({ buttons }));
  assert.equal(state.flight.roll, 1);
  assert.equal(state.flight.pitch, -1);
  assert.equal(state.flight.yaw, -1);

  buttons[3] = button();
  buttons[0] = button(true);
  state = readGamepadState(makePad({ buttons }));
  assert.equal(state.flight.yaw, 1);

  state = readGamepadState(makePad({ axes: [-0.6, 0.5, 0, 0], buttons }));
  assert.ok(state.flight.roll < -0.5, 'active analog X takes priority over D-pad X');
  assert.ok(state.flight.pitch > 0.4, 'active analog Y takes priority over D-pad Y');
});

test('missing axes and buttons on a generic controller are safely neutral', () => {
  const state = readGamepadState(makePad({
    id: 'Minimal USB HID',
    mapping: '',
    axes: [Number.NaN],
    buttons: [null],
  }));
  assert.deepEqual(state.flight, {
    roll: 0,
    pitch: 0,
    yaw: 0,
    throttle: 0,
    cameraClimb: 0,
    lookX: 0,
    lookY: 0,
  });
  assert.equal(state.buttons.confirm, false);
  assert.equal(state.mapping, 'generic');
});

test('spatial navigation chooses the closest visible target in the requested direction', () => {
  const element = (left, top, width = 30, height = 20) => ({
    focus() {},
    getBoundingClientRect: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    }),
  });
  const current = element(0, 0);
  const right = element(60, 0);
  const farRight = element(120, 50);
  const below = element(0, 55);
  assert.equal(findSpatialNavigationTarget(current, [current, farRight, below, right], 'right'), right);
  assert.equal(findSpatialNavigationTarget(current, [current, farRight, below, right], 'down'), below);
});

test('preferences are clamped, persisted and tolerate malformed storage', () => {
  const data = new Map();
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  const normalized = normalizeGamepadPreferences({
    mode: 'gamepad',
    layout: 'nintendo',
    deadzone: 4,
    haptics: false,
    hapticsIntensity: -2,
  });
  assert.deepEqual(normalized, {
    mode: 'gamepad',
    layout: 'nintendo',
    deadzone: 0.5,
    haptics: false,
    hapticsIntensity: 0,
  });
  assert.equal(saveGamepadPreferences(storage, normalized, 'pad'), true);
  assert.deepEqual(loadGamepadPreferences(storage, 'pad'), normalized);
  data.set('broken', '{');
  assert.equal(loadGamepadPreferences(storage, 'broken').mode, 'auto');
});

test('first controller gesture is consumed, then neutral and a fresh edge activate controls', () => {
  const pad = makePad();
  const pads = [pad];
  const actions = [];
  const manager = new GamepadControls({
    navigatorTarget: { getGamepads: () => pads },
    windowTarget: null,
    documentTarget: null,
    storage: null,
    preferences: { mode: 'gamepad' },
    autoActivate: false,
    autoHaptics: false,
    onAction: (action, detail) => actions.push([action, detail.phase]),
  });

  pad.buttons[0] = button(true);
  manager.poll(0);
  assert.deepEqual(actions, []);
  assert.deepEqual(manager.snapshot.flight, {
    roll: 0,
    pitch: 0,
    yaw: 0,
    throttle: 0,
    cameraClimb: 0,
    lookX: 0,
    lookY: 0,
  });

  pad.buttons[0] = button();
  manager.poll(16);
  pad.buttons[0] = button(true);
  manager.poll(32);
  assert.deepEqual(actions, [['confirm', 'pressed']]);

  pad.axes[0] = 0.8;
  manager.poll(48);
  assert.ok(manager.snapshot.flight.roll > 0.7);
  pads[0] = null;
  manager.poll(64);
  assert.equal(manager.snapshot.connected, false);
  assert.equal(manager.snapshot.flight.roll, 0);
});

test('mode changes and active-pad disconnects require neutral input before resuming', () => {
  const pad0 = makePad({ index: 0 });
  const pad1 = makePad({ index: 1, id: 'Sony DualSense Wireless Controller' });
  const pads = [pad0, pad1];
  const actions = [];
  const manager = new GamepadControls({
    navigatorTarget: { getGamepads: () => pads },
    windowTarget: null,
    documentTarget: null,
    storage: null,
    preferences: { mode: 'gamepad' },
    autoActivate: false,
    autoHaptics: false,
    onAction: (action, detail) => actions.push([action, detail.phase]),
  });

  pad0.buttons[0] = button(true);
  manager.poll(0);
  pad0.buttons[0] = button();
  manager.poll(10);
  pad1.buttons[0] = button(true);
  manager.poll(20);
  pad1.buttons[0] = button();
  manager.poll(30);
  assert.equal(manager.snapshot.activeIndex, 1);

  manager.setMode('keyboard');
  pad1.axes[0] = 0.9;
  manager.poll(40);
  manager.setMode('gamepad');
  manager.poll(50);
  assert.equal(manager.snapshot.flight.roll, 0);
  assert.deepEqual(actions, []);
  pad1.axes[0] = 0;
  manager.poll(60);
  pad1.axes[0] = 0.9;
  manager.poll(70);
  assert.ok(manager.snapshot.flight.roll > 0.8);
  assert.deepEqual(actions, [['navRight', 'pressed']]);
  actions.length = 0;

  pad0.axes[0] = -0.9;
  pads[1] = null;
  manager.poll(80);
  assert.equal(manager.snapshot.activeIndex, 0);
  assert.equal(manager.snapshot.flight.roll, 0);
  assert.deepEqual(actions, []);
  pad0.axes[0] = 0;
  manager.poll(90);
  pad0.axes[0] = -0.9;
  manager.poll(100);
  assert.ok(manager.snapshot.flight.roll < -0.8);
  assert.deepEqual(actions, [['navLeft', 'pressed']]);
});

test('small trigger drift does not wake or hold a privacy-gated controller', () => {
  const pad = makePad();
  pad.buttons[7] = button(false, 0.2);
  const manager = new GamepadControls({
    navigatorTarget: { getGamepads: () => [pad] },
    windowTarget: null,
    documentTarget: null,
    storage: null,
    preferences: { mode: 'gamepad' },
    autoHaptics: false,
  });
  manager.poll(0);
  assert.equal(manager.snapshot.activeIndex, null);
  assert.equal(manager.records.get(0).firstGestureConsumed, false);
  assert.equal(manager.records.get(0).current.values.boost > 0, true);
});

test('fresh button reads remain available while the animation manager is suspended', () => {
  const pad = makePad();
  const manager = new GamepadControls({
    navigatorTarget: { getGamepads: () => [pad] },
    windowTarget: null,
    documentTarget: null,
    preferences: { mode: 'gamepad' },
  });
  pad.buttons[0] = button(true);
  manager.poll(1);
  pad.buttons[0] = button(false);
  manager.poll(2);
  pad.buttons[4] = button(true);
  manager.suspend();
  assert.equal(manager.isActionPressed('leftShoulder'), true);
  pad.buttons[4] = button(false);
  assert.equal(manager.isActionPressed('leftShoulder'), false);
});

test('haptics use dual-rumble when supported and respect intensity/disable settings', async () => {
  const effects = [];
  const pad = makePad({
    vibrationActuator: {
      effects: ['dual-rumble'],
      async playEffect(type, effect) {
        effects.push({ type, effect });
        return 'complete';
      },
    },
  });
  const manager = new GamepadControls({
    navigatorTarget: { getGamepads: () => [pad] },
    windowTarget: null,
    documentTarget: null,
    storage: null,
    preferences: { mode: 'gamepad', haptics: true, hapticsIntensity: 0.5 },
  });
  manager.poll(0);
  assert.equal(await manager.vibrate({ duration: 90, weakMagnitude: 0.8, strongMagnitude: 1 }, 0), true);
  assert.equal(effects[0].type, 'dual-rumble');
  assert.equal(effects[0].effect.duration, 90);
  assert.equal(effects[0].effect.weakMagnitude, 0.4);
  assert.equal(effects[0].effect.strongMagnitude, 0.5);
  manager.setHapticsEnabled(false);
  assert.equal(await manager.vibrate('impact'), false);
  manager.setHapticsEnabled(true);
  manager.setMode('keyboard');
  assert.equal(await manager.vibrate('impact', 0), false);
});

test('haptics discover later actuators and fall back from rejected playEffect to pulse', async () => {
  const pulses = [];
  const hybrid = {
    effects: ['dual-rumble'],
    async playEffect() {
      throw new Error('unsupported');
    },
    async pulse(value, duration) {
      pulses.push({ value, duration });
      return true;
    },
  };
  const pad = makePad({
    vibrationActuator: { effects: [], async playEffect() { throw new Error('unsupported'); } },
    hapticActuators: [{}, hybrid],
  });
  const manager = new GamepadControls({
    navigatorTarget: { getGamepads: () => [pad] },
    windowTarget: null,
    documentTarget: null,
    storage: null,
    preferences: { mode: 'gamepad', haptics: true },
  });
  manager.poll(0);
  assert.equal(manager.devices[0].haptics, true);
  assert.equal(await manager.vibrate({ duration: 55, weakMagnitude: 0.2, strongMagnitude: 0.7 }, 0), true);
  assert.deepEqual(pulses, [{ value: 0.7, duration: 55 }]);
});
