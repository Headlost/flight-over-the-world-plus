export const QUALITY = Object.freeze({
  // One adaptive profile gives the tile streamer enough GPU budget for sharp
  // nearby scenery without forcing every display to render a 4K framebuffer.
  performance: { label: 'Adaptive high detail', pixels: 2560 * 1440, dpr: 1.5, error: 7, bytes: 600e6, shadows: false },
});

export function renderRatio(key, width, height, deviceRatio = 1, maxSize = 8192) {
  const q = QUALITY[key] || QUALITY.performance;
  const budget = Math.sqrt(q.pixels / Math.max(1, width * height));
  const desired = Math.min(deviceRatio, q.dpr, budget);
  return Math.max(0.1, Math.min(desired, maxSize / width, maxSize / height));
}

export class AdaptiveQuality {
  constructor() { this.reset(); }
  reset() { this.seconds = 0; this.frames = 0; this.scale = 1; this.lastFps = 60; }
  sample(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.5) return false;
    this.seconds += dt; this.frames++;
    if (this.seconds < 3) return false;
    const fps = this.frames / this.seconds;
    this.lastFps = fps;
    const previous = this.scale;
    if (fps < 42) this.scale = Math.max(0.5, this.scale - 0.1);
    else if (fps > 57) this.scale = Math.min(1, this.scale + 0.05);
    this.seconds = 0; this.frames = 0;
    return previous !== this.scale;
  }
}

/**
 * Streaming budgets for progressive 3D Tiles refinement. The visible camera is
 * served first. Keep the existing visible detail and CPU cache budgets so
 * removing off-screen sweeps does not trade sharpness for lower memory use.
 */
export function terrainStreamProfile(mode, fps = 60, mobile = false, cacheFull = false, memorySafe = false, fastFlight = false) {
  const rate = Number.isFinite(fps) ? Math.max(1, fps) : 60;
  let profile;
  if (mode === 'street') {
    const error = mobile
      ? rate >= 50 ? 4 : rate >= 32 ? 5.25 : 7
      : rate >= 52 ? 2.75 : rate >= 32 ? 4.25 : 6;
    profile = {
      error,
      errorFalloff: 2,
      maxTilesProcessed: rate < 28 ? 90 : rate < 45 ? 130 : 180,
      cacheTiles: mobile ? 1200 : 3800,
      cacheBytes: mobile ? 220e6 : 700e6,
      gpuBytes: mobile ? 130e6 : 240e6,
    };
  } else if (mode === 'landing') {
    profile = {
      error: mobile ? 6 : rate < 32 ? 6 : 4,
      errorFalloff: 1.5,
      maxTilesProcessed: rate < 32 ? 100 : 170,
      cacheTiles: mobile ? 1000 : 3200,
      cacheBytes: mobile ? 190e6 : 620e6,
      gpuBytes: mobile ? 110e6 : 220e6,
    };
  } else {
    profile = {
      error: 7,
      errorFalloff: 1,
      maxTilesProcessed: rate < 32 ? 120 : 250,
      cacheTiles: mobile ? 800 : 2400,
      cacheBytes: mobile ? 160e6 : 520e6,
      gpuBytes: mobile ? 88e6 : 180e6,
    };
  }

  profile.prefetch = false;
  profile.resolutionScale ??= 1;

  if (fastFlight) {
    // Keep the same screen-space error and cache budgets. Only spread tile-tree
    // expansion and GLTF parsing over more frames so a fast turn cannot place a
    // large synchronous burst in the middle of one rendered frame.
    profile.maxTilesProcessed = Math.min(profile.maxTilesProcessed, mobile ? 55 : 84);
    profile.maxConcurrentParses = mobile ? 1 : 2;
  }

  if (!mobile) return profile;

  const mobileProcessed = mode === 'street' ? 120 : mode === 'landing' ? 100 : 90;
  profile.maxTilesProcessed = Math.min(profile.maxTilesProcessed, mobileProcessed);
  profile.prefetch = false;
  if (!memorySafe) return profile;

  // Keep the same visible detail target, but prevent a recovering phone from
  // retaining or decoding enough neighbouring tiles to be killed by the OS.
  const safe = mode === 'street'
    ? { cacheTiles: 700, cacheBytes: 144e6, gpuBytes: 104e6, maxTilesProcessed: 80 }
    : mode === 'landing'
      ? { cacheTiles: 600, cacheBytes: 128e6, gpuBytes: 92e6, maxTilesProcessed: 70 }
      : { cacheTiles: 480, cacheBytes: 96e6, gpuBytes: 72e6, maxTilesProcessed: 60 };
  return {
    ...profile,
    cacheTiles: Math.min(profile.cacheTiles, safe.cacheTiles),
    cacheBytes: Math.min(profile.cacheBytes, safe.cacheBytes),
    gpuBytes: Math.min(profile.gpuBytes, safe.gpuBytes),
    maxTilesProcessed: Math.min(profile.maxTilesProcessed, safe.maxTilesProcessed),
    prefetch: false,
  };
}
