export const FULL_BOOST_SECONDS = 3;

/** Hold acceleration to reach the vehicle's configured maximum in its ramp time. */
export function advanceBoostRamp(craft, dt, held) {
  if (!held) {
    craft.boostRamp = null;
    return false;
  }
  if (!craft.boostRamp) {
    craft.boostRamp = {
      elapsed: 0,
      speed: craft.speed,
      throttle: craft.throttle,
    };
  }
  const ramp = craft.boostRamp;
  const seconds = Number.isFinite(craft.boostSeconds) && craft.boostSeconds > 0
    ? craft.boostSeconds : FULL_BOOST_SECONDS;
  ramp.elapsed = Math.min(seconds, ramp.elapsed + dt);
  const fraction = ramp.elapsed >= seconds - 1e-9
    ? 1 : ramp.elapsed / seconds;
  craft.throttle = ramp.throttle + (1 - ramp.throttle) * fraction;
  craft.speed = ramp.speed + (craft.boost - ramp.speed) * fraction;
  return true;
}
