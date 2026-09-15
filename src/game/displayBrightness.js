export const DISPLAY_BRIGHTNESS = Object.freeze({
  default: 1,
  min: 0.35,
  max: 1.80,
  levelDefault: 50,
  levelMin: 0,
  levelMax: 100,
});

function finiteNumber(value) {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : NaN;
  return numeric;
}

export function sanitizeBrightnessMultiplier(value) {
  const numeric = finiteNumber(value);
  if (!Number.isFinite(numeric)) return DISPLAY_BRIGHTNESS.default;
  return Math.min(DISPLAY_BRIGHTNESS.max, Math.max(DISPLAY_BRIGHTNESS.min, numeric));
}

export function sanitizeBrightnessLevel(value) {
  const numeric = finiteNumber(value);
  if (!Number.isFinite(numeric)) return DISPLAY_BRIGHTNESS.levelDefault;
  return Math.min(DISPLAY_BRIGHTNESS.levelMax, Math.max(DISPLAY_BRIGHTNESS.levelMin, numeric));
}

export function brightnessMultiplierFromLevel(value) {
  const level = sanitizeBrightnessLevel(value);
  const midpoint = DISPLAY_BRIGHTNESS.levelDefault;
  if (level <= midpoint) {
    const darkness = (midpoint - level) / (midpoint - DISPLAY_BRIGHTNESS.levelMin);
    return DISPLAY_BRIGHTNESS.min ** darkness;
  }
  const brightness = (level - midpoint) / (DISPLAY_BRIGHTNESS.levelMax - midpoint);
  return DISPLAY_BRIGHTNESS.max ** brightness;
}

export function brightnessLevelFromMultiplier(value) {
  const multiplier = sanitizeBrightnessMultiplier(value);
  const midpoint = DISPLAY_BRIGHTNESS.levelDefault;
  if (multiplier <= DISPLAY_BRIGHTNESS.default) {
    const darkness = Math.log(multiplier) / Math.log(DISPLAY_BRIGHTNESS.min);
    return midpoint - darkness * (midpoint - DISPLAY_BRIGHTNESS.levelMin);
  }
  const brightness = Math.log(multiplier) / Math.log(DISPLAY_BRIGHTNESS.max);
  return midpoint + brightness * (DISPLAY_BRIGHTNESS.levelMax - midpoint);
}

export function brightnessAdjustedExposure(baseExposure, multiplier = DISPLAY_BRIGHTNESS.default) {
  return baseExposure * sanitizeBrightnessMultiplier(multiplier);
}
