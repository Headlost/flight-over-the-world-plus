export const PLAYER_STACK_HEIGHT = 1.72;
export const MAX_PLAYER_BUMP = 8;

export function interactionProfile(key, state, wingspan = 10) {
  const span = Number.isFinite(wingspan) ? Math.max(1, wingspan) : 10;
  const body = { radius: 0.58, halfHeight: 0.9, centerHeight: 0.9 };
  if (key === "parachutist" && state === "grounded") {
    return { kind: "person", ...body, stackable: true, volumes: [body] };
  }
  if (key === "parachutist") {
    const canopy = { radius: span * 0.5, halfHeight: 1.4, centerHeight: 7.2 };
    return { kind: "canopy", ...canopy, stackable: true, volumes: [body, canopy] };
  }
  const hull = { radius: Math.max(2.2, span * 0.5), halfHeight: Math.max(1.2, span * 0.12), centerHeight: 0 };
  return {
    kind: "aircraft",
    ...hull,
    stackable: false,
    volumes: [hull],
  };
}

export function classifyPlayerContact({
  localKey,
  localState,
  localWingspan,
  remoteKey,
  remoteState,
  remoteWingspan,
  horizontalDistance,
  verticalDelta,
  localMotion = 0,
  remoteMotion = 0,
}) {
  if (![horizontalDistance, verticalDelta, localMotion, remoteMotion].every(Number.isFinite)) return null;
  const local = interactionProfile(localKey, localState, localWingspan);
  const remote = interactionProfile(remoteKey, remoteState, remoteWingspan);
  const horizontal = Math.max(0, horizontalDistance);

  if (local.stackable && remote.kind === "person" && horizontal <= 0.68) {
    const stackError = verticalDelta - PLAYER_STACK_HEIGHT;
    if (stackError >= -0.72 && stackError <= 0.9) {
      return { type: "support", supportOffset: PLAYER_STACK_HEIGHT };
    }
  }

  // Once one walking character is clearly above another, let the upper player
  // stand on the lower one instead of producing a sideways contact every frame.
  if (local.kind === "person" && remote.kind === "person" && Math.abs(verticalDelta) > 0.92) return null;

  let penetration = 0;
  for (const ownVolume of local.volumes) for (const otherVolume of remote.volumes) {
    const radius = ownVolume.radius + otherVolume.radius;
    const verticalLimit = ownVolume.halfHeight + otherVolume.halfHeight;
    const centerDelta = verticalDelta + ownVolume.centerHeight - otherVolume.centerHeight;
    if (horizontal < radius && Math.abs(centerDelta) < verticalLimit) {
      penetration = Math.max(penetration, radius - horizontal);
    }
  }
  if (!penetration) return null;
  const walking = local.kind === "person" && remote.kind === "person";
  const relativeMotion = Math.abs(localMotion) + Math.abs(remoteMotion);
  const strength = walking
    ? Math.min(3.2, 0.7 + relativeMotion * 0.42 + penetration * 1.1)
    : Math.min(MAX_PLAYER_BUMP, 1.8 + relativeMotion * 0.018 + penetration * 0.32);
  return { type: "push", penetration, strength, walking };
}

// Test the relative path as well as its endpoint: fast aircraft can cross one
// another completely between two rendered frames.
export function sweptPlayerContact(options, previous, current) {
  if (![previous?.x, previous?.y, previous?.z, current?.x, current?.y, current?.z].every(Number.isFinite)) return null;
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const dz = current.z - previous.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  if (lengthSq < 0.000001) return null;
  const t = Math.max(0, Math.min(1, -(previous.x * dx + previous.y * dy + previous.z * dz) / lengthSq));
  if (t <= 0 || t >= 1) return null;
  const x = previous.x + dx * t;
  const y = previous.y + dy * t;
  const z = previous.z + dz * t;
  const contact = classifyPlayerContact({ ...options, horizontalDistance: Math.hypot(x, z), verticalDelta: y });
  return contact?.type === "push" ? { ...contact, swept: true } : null;
}

export function clampBumpVector(x, y, z, maximum = MAX_PLAYER_BUMP) {
  const values = [x, y, z].map(value => Number.isFinite(value) ? value : 0);
  const limit = Number.isFinite(maximum) ? Math.max(0, maximum) : MAX_PLAYER_BUMP;
  const length = Math.hypot(...values);
  if (!length || length <= limit) return { x: values[0], y: values[1], z: values[2] };
  const scale = limit / length;
  return { x: values[0] * scale, y: values[1] * scale, z: values[2] * scale };
}
