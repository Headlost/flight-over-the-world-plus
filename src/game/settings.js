import { QUALITY } from './quality.js';
import { ionTokenList } from './ionTokens.js';
import { DISPLAY_BRIGHTNESS, sanitizeBrightnessMultiplier } from './displayBrightness.js';

function readSettings() {
  try {
    const value = JSON.parse(localStorage.getItem('fotw-settings') || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}
const saved = readSettings();
// The deployment supplies the default terrain access. An optional player token
// is handled separately and only for the lifetime of the current browser tab.
export const settings = {
  quality: QUALITY[saved.quality] ? saved.quality : 'performance',
  adaptive: saved.adaptive !== false,
  brightness: sanitizeBrightnessMultiplier(saved.brightness),
  terrainPoolEndpoint: (import.meta.env.VITE_TERRAIN_POOL_ENDPOINT || '').trim(),
  ion: import.meta.env.VITE_CESIUM_ION_KEY || '',
  ionTokens: ionTokenList(import.meta.env.VITE_CESIUM_ION_KEY, import.meta.env.VITE_CESIUM_ION_FALLBACK_KEYS),
};
try { sessionStorage.removeItem('fotw-keys'); } catch { /* old setup is no longer used */ }

function saveSettings() {
  try {
    localStorage.setItem('fotw-settings', JSON.stringify({
      quality: settings.quality,
      adaptive: settings.adaptive,
      brightness: settings.brightness,
    }));
  } catch { /* local preferences are optional */ }
}

export function setupSettings(onQualityChange, onOpen) {
  const dialog = document.createElement('dialog');
  dialog.className = 'flight-dialog';
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.innerHTML = `<form method="dialog">
    <div class="dialog-heading"><h2 id="settings-title">Flight settings</h2><button value="close" aria-label="Close settings">×</button></div>
    <p>Ready to fly online. Rendering sharpens the visible area first and progressively fills nearby directions after landing.</p>
    <p class="settings-note"><strong>${QUALITY.performance.label}</strong> · up to 2560 × 1440, with mipmapped, anisotropically filtered terrain textures.</p>
    <label class="check"><input id="adaptive" type="checkbox"> Adapt resolution to keep flight smooth</label>
    <p class="settings-note" id="quality-warning">Adaptive resolution protects frame rate while nearby map tiles sharpen progressively. Close-up detail is limited by the source survey available at a location.</p>
    <div class="display-brightness-control">
      <label for="display-brightness">Image brightness</label>
      <output id="display-brightness-value" for="display-brightness">100%</output>
      <input id="display-brightness" type="range" min="${DISPLAY_BRIGHTNESS.min * 100}" max="${DISPLAY_BRIGHTNESS.max * 100}" step="1" value="100" aria-describedby="display-brightness-note">
    </div>
    <p class="settings-note" id="display-brightness-note">Adjusts the 3D scene through filmic exposure so highlights, contrast and terrain detail remain visible. Interface text is unchanged.</p>
    <button value="close">Done</button>
  </form>`;
  document.body.append(dialog);
  const a = dialog.querySelector('#adaptive');
  const brightness = dialog.querySelector('#display-brightness');
  const brightnessOutput = dialog.querySelector('#display-brightness-value');
  a.checked = settings.adaptive;
  brightness.value = String(Math.round(settings.brightness * 100));
  const syncBrightness = (persist = false) => {
    settings.brightness = sanitizeBrightnessMultiplier(Number(brightness.value) / 100);
    const percent = Math.round(settings.brightness * 100);
    brightness.value = String(percent);
    brightness.setAttribute('aria-valuetext', `${percent}%`);
    brightnessOutput.textContent = `${percent}%`;
    if (persist) saveSettings();
    onQualityChange();
  };
  syncBrightness(false);
  const change = () => {
    settings.quality = 'performance'; settings.adaptive = a.checked;
    saveSettings();
    onQualityChange();
  };
  a.addEventListener('change', change);
  brightness.addEventListener('input', () => syncBrightness(true));
  brightness.addEventListener('change', () => syncBrightness(true));
  const button = document.createElement('button');
  button.id = 'settings-toggle'; button.type = 'button'; button.textContent = '⚙ Settings';
  const open = () => { onOpen(); if (!dialog.open) dialog.showModal(); };
  button.addEventListener('click', open); document.body.append(button);
  return { open };
}
