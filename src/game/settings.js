import { QUALITY } from './quality.js';
import { ionTokenList } from './ionTokens.js';
import {
  brightnessLevelFromMultiplier,
  brightnessMultiplierFromLevel,
  DISPLAY_BRIGHTNESS,
  sanitizeBrightnessLevel,
  sanitizeBrightnessMultiplier,
} from './displayBrightness.js';

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

function applyMenuBrightness() {
  const multiplier = sanitizeBrightnessMultiplier(settings.brightness);
  const colors = [
    ['--menu-navy', [8, 20, 38], 1],
    ['--menu-surface', [13, 31, 53], 0.97],
    ['--menu-border', [133, 169, 205], 0.48],
    ['--menu-field', [35, 62, 89], 1],
    ['--menu-field-border', [93, 124, 155], 1],
    ['--menu-glow', [216, 162, 74], 0.14],
  ];
  for (const [property, rgb, alpha] of colors) {
    const adjusted = rgb.map(channel => Math.min(255, Math.round(channel * multiplier)));
    document.documentElement.style.setProperty(property, `rgba(${adjusted.join(', ')}, ${alpha})`);
  }
  // Menu previews are separate transparent canvases. CSS updates their last
  // rendered frame immediately, including while a settings dialog is open.
  document.documentElement.style.setProperty('--menu-preview-brightness', String(multiplier));
}

export function setupSettings(onQualityChange, onOpen, onBrightnessChange = onQualityChange) {
  const dialog = document.createElement('dialog');
  dialog.className = 'flight-dialog display-settings-dialog';
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.innerHTML = `<form method="dialog">
    <div class="dialog-heading"><h2 id="settings-title">Flight settings</h2><button value="close" aria-label="Close settings">×</button></div>
    <p>Ready to fly online. Rendering sharpens the visible area first and progressively fills nearby directions after landing.</p>
    <p class="settings-note"><strong>${QUALITY.performance.label}</strong> · up to 2560 × 1440, with mipmapped, anisotropically filtered terrain textures.</p>
    <label class="check"><input id="adaptive" type="checkbox"> Adapt resolution to keep flight smooth</label>
    <p class="settings-note" id="quality-warning">Adaptive resolution protects frame rate while nearby map tiles sharpen progressively. Close-up detail is limited by the source survey available at a location.</p>
    <div class="display-brightness-control">
      <label for="display-brightness">Image brightness</label>
      <output id="display-brightness-value" for="display-brightness">50%</output>
      <input id="display-brightness" type="range" min="${DISPLAY_BRIGHTNESS.levelMin}" max="${DISPLAY_BRIGHTNESS.levelMax}" step="1" value="${DISPLAY_BRIGHTNESS.levelDefault}" aria-describedby="display-brightness-scale display-brightness-note">
      <div class="display-brightness-scale" id="display-brightness-scale" aria-hidden="true">
        <span>0% · darker</span>
        <span>50% · standard</span>
        <span>100% · brighter</span>
      </div>
    </div>
    <p class="settings-note" id="display-brightness-note">50% keeps the standard image. Move toward 0% for a darker view or toward 100% for a brighter view. Menus and aircraft previews update immediately; text stays easy to read.</p>
    <button value="close">Done</button>
  </form>`;
  document.body.append(dialog);
  const a = dialog.querySelector('#adaptive');
  const brightness = dialog.querySelector('#display-brightness');
  const brightnessOutput = dialog.querySelector('#display-brightness-value');
  a.checked = settings.adaptive;
  const renderBrightnessLevel = (level) => {
    const percent = Math.round(sanitizeBrightnessLevel(level));
    brightness.value = String(percent);
    brightness.setAttribute('aria-valuetext', `${percent}%`);
    brightnessOutput.textContent = `${percent}%`;
  };
  renderBrightnessLevel(brightnessLevelFromMultiplier(settings.brightness));
  applyMenuBrightness();
  const syncBrightness = (persist = false) => {
    const level = sanitizeBrightnessLevel(brightness.value);
    settings.brightness = brightnessMultiplierFromLevel(level);
    renderBrightnessLevel(level);
    applyMenuBrightness();
    if (persist) saveSettings();
    onBrightnessChange();
  };
  const change = () => {
    settings.quality = 'performance'; settings.adaptive = a.checked;
    saveSettings();
    onQualityChange();
  };
  a.addEventListener('change', change);
  brightness.addEventListener('input', () => syncBrightness(false));
  brightness.addEventListener('change', () => syncBrightness(true));
  const button = document.createElement('button');
  button.id = 'settings-toggle'; button.type = 'button'; button.textContent = '⚙ Settings';
  const open = () => { onOpen(); if (!dialog.open) dialog.showModal(); };
  button.addEventListener('click', open); document.body.append(button);
  return { open };
}
