import test from "node:test";
import assert from "node:assert/strict";
import {
  brightnessAdjustedExposure,
  brightnessLevelFromMultiplier,
  brightnessMultiplierFromLevel,
  DISPLAY_BRIGHTNESS,
  sanitizeBrightnessLevel,
  sanitizeBrightnessMultiplier,
} from "../src/game/displayBrightness.js";

const closeTo = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
};

test("brightness values default safely and stay within their supported ranges", () => {
  assert.deepEqual(DISPLAY_BRIGHTNESS, {
    default: 1,
    min: 0.35,
    max: 1.80,
    levelDefault: 50,
    levelMin: 0,
    levelMax: 100,
  });
  for (const invalid of [undefined, null, true, false, "", "   ", "bright", NaN, Infinity, -Infinity, {}, []]) {
    assert.equal(sanitizeBrightnessMultiplier(invalid), 1);
    assert.equal(sanitizeBrightnessLevel(invalid), 50);
  }
  assert.equal(sanitizeBrightnessMultiplier(0.1), 0.35);
  assert.equal(sanitizeBrightnessMultiplier("0.35"), 0.35);
  assert.equal(sanitizeBrightnessMultiplier(1), 1);
  assert.equal(sanitizeBrightnessMultiplier("1.2"), 1.2);
  assert.equal(sanitizeBrightnessMultiplier(1.8), 1.8);
  assert.equal(sanitizeBrightnessMultiplier(2), 1.8);
  assert.equal(sanitizeBrightnessLevel(-1), 0);
  assert.equal(sanitizeBrightnessLevel("25"), 25);
  assert.equal(sanitizeBrightnessLevel(50), 50);
  assert.equal(sanitizeBrightnessLevel(101), 100);
});

test("the 0-100 control has a neutral midpoint and a clear monotonic exposure curve", () => {
  closeTo(brightnessMultiplierFromLevel(0), 0.35);
  closeTo(brightnessMultiplierFromLevel(25), Math.sqrt(0.35));
  closeTo(brightnessMultiplierFromLevel(50), 1);
  closeTo(brightnessMultiplierFromLevel(75), Math.sqrt(1.8));
  closeTo(brightnessMultiplierFromLevel(100), 1.8);

  let previous = brightnessMultiplierFromLevel(0);
  for (let level = 1; level <= 100; level += 1) {
    const current = brightnessMultiplierFromLevel(level);
    assert.ok(current > previous, `brightness should increase at level ${level}`);
    previous = current;
  }
});

test("stored legacy multipliers round-trip without changing the rendered image", () => {
  for (const multiplier of [0.35, 0.8, 1, 1.2, 1.21, 1.25, 1.8]) {
    const level = brightnessLevelFromMultiplier(multiplier);
    closeTo(brightnessMultiplierFromLevel(level), multiplier);
  }
  closeTo(brightnessLevelFromMultiplier(1.2), 65.50916069389866);
  closeTo(brightnessLevelFromMultiplier(1.21), 66.21509732960621);
});

test("adjusted exposure multiplies Earth and space exposure by sanitized brightness", () => {
  assert.equal(brightnessAdjustedExposure(1.1), 1.1);
  assert.equal(brightnessAdjustedExposure(1.1, brightnessMultiplierFromLevel(0)), 1.1 * 0.35);
  assert.equal(brightnessAdjustedExposure(1.1, brightnessMultiplierFromLevel(100)), 1.1 * 1.8);
  assert.equal(brightnessAdjustedExposure(1.14, brightnessMultiplierFromLevel(25)), 1.14 * Math.sqrt(0.35));
  assert.equal(brightnessAdjustedExposure(1.14, brightnessMultiplierFromLevel(75)), 1.14 * Math.sqrt(1.8));
  assert.equal(brightnessAdjustedExposure(1.1, "invalid"), 1.1);
});
