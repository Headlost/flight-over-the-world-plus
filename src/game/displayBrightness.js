export const DISPLAY_BRIGHTNESS = Object.freeze({
  default: 1,
  min: 0.80,
  max: 1.25,
});

export function sanitizeBrightnessMultiplier(value) {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : NaN;
  if (!Number.isFinite(numeric)) return DISPLAY_BRIGHTNESS.default;
  return Math.min(DISPLAY_BRIGHTNESS.max, Math.max(DISPLAY_BRIGHTNESS.min, numeric));
}

export function brightnessAdjustedExposure(baseExposure, multiplier = DISPLAY_BRIGHTNESS.default) {
  return baseExposure * sanitizeBrightnessMultiplier(multiplier);
}
