const raycastHits = [];
const ROCKET_REAR_VIEW_SECONDS = 1.2;
const ROCKET_CAMERA_TRANSITION_SECONDS = 1.6;

export function rocketLaunchCameraPhase(elapsedSeconds) {
  if (!Number.isFinite(elapsedSeconds)) return 0;
  const t = Math.max(0, Math.min(1,
    (elapsedSeconds - ROCKET_REAR_VIEW_SECONDS) / ROCKET_CAMERA_TRANSITION_SECONDS,
  ));
  return t * t * (3 - 2 * t);
}

export function parachutistCameraClimbAssist(cameraPitch, dragging) {
  if (!dragging || !Number.isFinite(cameraPitch)) return 0;
  return Math.max(0, Math.min(1, (0.14 - cameraPitch) / 0.55));
}

function isRendered(object, sceneRoot) {
  let current = object;
  while (current) {
    if (!current.visible) return false;
    if (current === sceneRoot) return true;
    current = current.parent;
  }
  return false;
}

/** Raycast terrain that is loaded for physics, including an off-camera fallback. */
export function raycastTerrain(tiles, raycaster) {
  raycastHits.length = 0;
  if (typeof tiles?.raycastGround === "function") {
    tiles.raycastGround(raycaster, raycastHits);
  } else if (typeof tiles?.raycast === "function") {
    tiles.raycast(raycaster, raycastHits);
  } else if (tiles?.group) {
    raycaster.intersectObject(tiles.group, true, raycastHits);
  }
  const hit = raycastHits[0] || null;
  raycastHits.length = 0;
  return hit;
}

/**
 * Raycast only tile scenes that are currently attached to the renderer group.
 * TilesRenderer keeps active fallback LODs parented but detached, so its normal
 * raycast can hit geometry that is not being drawn. Use this for the camera;
 * ground physics uses raycastTerrain because the point directly below a high
 * aircraft is commonly outside the camera frustum.
 */
export function raycastVisibleTerrain(tiles, raycaster) {
  // Keep the renderer's bounding-volume traversal. Directly raycasting Google
  // tile scenes can miss compressed / batched content even when it is drawn.
  // Swapping the set synchronously makes the native traversal consider only
  // visible LODs instead of detached active fallbacks.
  if (typeof tiles?.raycast === "function" && tiles.activeTiles && tiles.visibleTiles) {
    const activeTiles = tiles.activeTiles;
    const accelerateRaycast = tiles.accelerateRaycast;
    raycastHits.length = 0;
    try {
      tiles.activeTiles = tiles.visibleTiles;
      // Google Photorealistic bounding volumes are intentionally loose and can
      // exclude a visible child from accelerated traversal. The visible set is
      // already small, so testing it directly is both reliable and bounded.
      tiles.accelerateRaycast = false;
      tiles.raycast(raycaster, raycastHits);
    } finally {
      tiles.activeTiles = activeTiles;
      tiles.accelerateRaycast = accelerateRaycast;
    }
    const hit = raycastHits[0] || null;
    raycastHits.length = 0;
    return hit;
  }

  // Lightweight fallback used by isolated tests and non-TilesRenderer scenes.
  const scenes = tiles?.group?.children;
  if (!scenes?.length) return null;
  let closest = null;
  for (const scene of scenes) {
    raycastHits.length = 0;
    raycaster.intersectObject(scene, true, raycastHits);
    for (const hit of raycastHits) {
      if (!isRendered(hit.object, scene)) continue;
      if (!closest || hit.distance < closest.distance) closest = hit;
      break;
    }
  }
  raycastHits.length = 0;
  return closest;
}

export class ContactConfirmation {
  constructor(requiredSamples = 2) {
    this.requiredSamples = Math.max(1, Math.floor(requiredSamples));
    this.count = 0;
  }

  sample(contact) {
    this.count = contact ? this.count + 1 : 0;
    return this.count >= this.requiredSamples;
  }

  reset() {
    this.count = 0;
  }
}

/**
 * Dampen only the camera's vehicle-local orbit offset. Capping the damping
 * step prevents a long tile-loading frame from consuming the whole backlog in
 * one visible snap; vehicle translation and rotation are applied afterwards.
 */
export function updateChaseOffset(offset, goal, dt, response = 12) {
  const dampingDt = Math.min(1 / 30, Math.max(0, dt));
  const amount = 1 - Math.exp(-Math.max(0, response) * dampingDt);
  offset.lerp(goal, amount);
  return offset;
}
