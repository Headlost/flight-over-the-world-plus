const GRAVITY_WARNING_THRESHOLD = 0.025;

function unit(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

// Keep the pulse short enough that a new frame never queues a long vibration.
// Capture progress takes over near the event horizon even if gravity fluctuates.
export function blackHoleRumblePattern(intensity, captureProgress = 0) {
  const gravity = unit((intensity - GRAVITY_WARNING_THRESHOLD) / (1 - GRAVITY_WARNING_THRESHOLD));
  const capture = unit(captureProgress);
  const force = Math.max(gravity, capture > 0 ? 0.72 + capture * 0.28 : 0);
  if (force <= 0) return null;
  return {
    intervalMs: Math.round(520 - force * 230),
    duration: Math.round(105 + force * 170),
    weakMagnitude: 0.12 + force * 0.88,
    strongMagnitude: 0.08 + force * 0.92,
  };
}

export const BLACK_HOLE_ENTRY_RUMBLE = Object.freeze({
  duration: 850,
  weakMagnitude: 1,
  strongMagnitude: 1,
});
