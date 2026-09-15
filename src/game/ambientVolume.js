export const AMBIENT_VOLUME_KEY = "fotw-ambient-volume";

export function clampAmbientVolume(value, fallback = 1) {
  if (value == null || (typeof value !== "number" && typeof value !== "string")
    || (typeof value === "string" && value.trim() === "")) return fallback;
  const volume = Number(value);
  return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : fallback;
}

export function loadAmbientVolume(storage) {
  try {
    const saved = (storage ?? globalThis.localStorage)?.getItem(AMBIENT_VOLUME_KEY);
    return clampAmbientVolume(saved);
  } catch { return 1; }
}

export function saveAmbientVolume(value, storage) {
  const volume = clampAmbientVolume(value);
  try {
    (storage ?? globalThis.localStorage)?.setItem(AMBIENT_VOLUME_KEY, String(volume));
  } catch { /* Browser storage is optional; the live control still works. */ }
  return volume;
}
