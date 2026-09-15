import test from "node:test";
import assert from "node:assert/strict";
import {
  brightnessAdjustedExposure,
  DISPLAY_BRIGHTNESS,
  sanitizeBrightnessMultiplier,
} from "../src/game/displayBrightness.js";

test("brightness multiplier defaults safely and stays within the supported range", () => {
  assert.deepEqual(DISPLAY_BRIGHTNESS, { default: 1, min: 0.80, max: 1.25 });
  for (const invalid of [undefined, null, true, false, "", "   ", "bright", NaN, Infinity, -Infinity, {}, []]) {
    assert.equal(sanitizeBrightnessMultiplier(invalid), 1);
  }
  assert.equal(sanitizeBrightnessMultiplier(0.5), 0.80);
  assert.equal(sanitizeBrightnessMultiplier("0.80"), 0.80);
  assert.equal(sanitizeBrightnessMultiplier(1), 1);
  assert.equal(sanitizeBrightnessMultiplier("1.15"), 1.15);
  assert.equal(sanitizeBrightnessMultiplier(1.25), 1.25);
  assert.equal(sanitizeBrightnessMultiplier(2), 1.25);
});

test("adjusted exposure multiplies the base exposure by the sanitized brightness", () => {
  assert.equal(brightnessAdjustedExposure(1.1), 1.1);
  assert.equal(brightnessAdjustedExposure(1.1, 1.2), 1.1 * 1.2);
  assert.equal(brightnessAdjustedExposure(1.14, 2), 1.14 * 1.25);
  assert.equal(brightnessAdjustedExposure(1.14, 0.2), 1.14 * 0.80);
  assert.equal(brightnessAdjustedExposure(1.1, "invalid"), 1.1);
});
