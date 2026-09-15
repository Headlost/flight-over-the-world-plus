import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapRadialStick,
  screenToStickDelta,
  smoothStick,
  smoothValue,
} from '../src/game/touchControls.js';

test('virtual landscape converts screen motion back into the rotated stick coordinates', () => {
  assert.deepEqual(screenToStickDelta(30, -12, false), { x: 30, y: -12 });
  assert.deepEqual(screenToStickDelta(30, -12, true), { x: 12, y: 30 });
  // rotate(-90deg) maps local (x,y) to screen (y,-x), so this follows the finger.
  const local = screenToStickDelta(35, 0, true);
  assert.deepEqual({ screenX: local.y, screenY: -local.x }, { screenX: 35, screenY: 0 });
});

test('radial stick has a continuous circular dead zone and clamps diagonals', () => {
  const radius = 100;
  assert.deepEqual(mapRadialStick(0, 0, radius), { x: 0, y: 0, knobX: 0, knobY: 0, magnitude: 0 });
  assert.equal(mapRadialStick(12, 0, radius).magnitude, 0);
  assert.ok(mapRadialStick(12.001, 0, radius).magnitude < 1e-5, 'there is no jump at the dead-zone edge');

  const diagonal = mapRadialStick(100, 100, radius);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12);
  assert.ok(Math.abs(Math.hypot(diagonal.knobX, diagonal.knobY) - radius) < 1e-10);
  assert.ok(diagonal.x > 0 && diagonal.y > 0);

  const precise = mapRadialStick(35, 0, radius);
  assert.ok(precise.x > 0 && precise.x < 0.2, 'the centre curve keeps small corrections precise');
});

test('exponential smoothing is stable across 30, 60 and 120 FPS', () => {
  const simulate = (fps) => {
    let state = { x: 0, y: 0 };
    for (let frame = 0; frame < fps; frame += 1) {
      state = smoothStick(state, { x: 1, y: -0.5 }, 1 / fps, 11);
    }
    return state;
  };
  const results = [30, 60, 120].map(simulate);
  for (const state of results) {
    assert.ok(Math.abs(state.x - results[0].x) < 1e-10);
    assert.ok(Math.abs(state.y - results[0].y) < 1e-10);
    assert.ok(state.x > 0.9999 && state.y < -0.4999);
  }
  assert.equal(smoothValue(0.7, 0, 0, 11), 0.7);
  assert.ok(smoothValue(0.7, 0, 1 / 60, 11) < 0.7);
});
