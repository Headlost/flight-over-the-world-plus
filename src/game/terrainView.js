export function terrainDetailFor(agl = 0, grounded = false, previous = '') {
  const height = Number.isFinite(agl) ? Math.max(0, agl) : 0;
  if (grounded) return 'street';
  if (height >= 30000 || (previous === 'upper' && height >= 28000)) return 'upper';
  if (height >= 3000 || (previous === 'high' && height >= 2600)) return 'high';
  if (height < 240 || (previous === 'landing' && height < 320)) return 'landing';
  return 'normal';
}

// FogExp2 transmits exp(-(density * distance)^2). Only clip terrain once
// less than 0.01% contributes to the image; never add fog to hide missing data.
export function terrainVisibleDistance(fogDensity, sceneFar = 2e6) {
  if (!Number.isFinite(fogDensity) || fogDensity <= 0) return sceneFar;
  return Math.min(sceneFar, Math.sqrt(-Math.log(0.0001)) / fogDensity);
}

// The scene camera can see the sky and spacecraft at much greater distances.
// Only this matching, shorter frustum is allowed to request terrain tiles.
export function syncTerrainCamera(view, terrain, distance) {
  const far = Math.max(view.near + 1, distance);
  if (terrain.fov !== view.fov || terrain.aspect !== view.aspect || terrain.near !== view.near
    || terrain.zoom !== view.zoom || terrain.far !== far) {
    terrain.fov = view.fov;
    terrain.aspect = view.aspect;
    terrain.near = view.near;
    terrain.zoom = view.zoom;
    terrain.far = far;
    terrain.updateProjectionMatrix();
  }
  view.updateMatrixWorld(true);
  view.matrixWorld.decompose(terrain.position, terrain.quaternion, terrain.scale);
  terrain.updateMatrixWorld(true);
}
