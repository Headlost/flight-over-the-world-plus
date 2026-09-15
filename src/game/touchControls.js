const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const TOUCH_STICK_DEFAULTS = Object.freeze({
  deadZone: 0.12,
  curve: 1.45,
  inputResponse: 11,
  knobResponse: 18,
});

/** Convert a screen-space pointer delta to the stick's local coordinate system. */
export function screenToStickDelta(dx, dy, virtualLandscape = false) {
  const x = Number.isFinite(dx) ? dx : 0;
  const y = Number.isFinite(dy) ? dy : 0;
  // virtual-landscape rotates the body by -90deg. Applying the inverse here
  // keeps the knob under the finger and preserves the directions printed on it.
  return virtualLandscape ? { x: -y, y: x } : { x, y };
}

/**
 * Clamp to a circular gate, remove a radial dead zone continuously, then apply
 * a gentle response curve for precise movement near the centre.
 */
export function mapRadialStick(dx, dy, radius, options = {}) {
  const safeRadius = Math.max(1e-6, Number.isFinite(radius) ? radius : 0);
  const deadZone = clamp(Number.isFinite(options.deadZone) ? options.deadZone : TOUCH_STICK_DEFAULTS.deadZone, 0, 0.95);
  const curve = Math.max(0.25, Number.isFinite(options.curve) ? options.curve : TOUCH_STICK_DEFAULTS.curve);
  const x = Number.isFinite(dx) ? dx : 0;
  const y = Number.isFinite(dy) ? dy : 0;
  const magnitude = Math.hypot(x, y);
  if (magnitude <= 1e-9) return { x: 0, y: 0, knobX: 0, knobY: 0, magnitude: 0 };

  const directionX = x / magnitude;
  const directionY = y / magnitude;
  const clampedMagnitude = Math.min(magnitude, safeRadius);
  const normalized = clampedMagnitude / safeRadius;
  const remapped = normalized <= deadZone
    ? 0
    : Math.pow((normalized - deadZone) / (1 - deadZone), curve);

  return {
    x: directionX * remapped,
    y: directionY * remapped,
    knobX: directionX * clampedMagnitude,
    knobY: directionY * clampedMagnitude,
    magnitude: remapped,
  };
}

export function smoothValue(current, target, dt, response) {
  const from = Number.isFinite(current) ? current : 0;
  const to = Number.isFinite(target) ? target : 0;
  const seconds = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
  const speed = Math.max(0, Number.isFinite(response) ? response : 0);
  if (!seconds || !speed) return from;
  const next = from + (to - from) * (1 - Math.exp(-speed * seconds));
  return Math.abs(next - to) < 1e-5 ? to : next;
}

export function smoothStick(current, target, dt, response = TOUCH_STICK_DEFAULTS.inputResponse) {
  return {
    x: smoothValue(current?.x, target?.x, dt, response),
    y: smoothValue(current?.y, target?.y, dt, response),
  };
}
