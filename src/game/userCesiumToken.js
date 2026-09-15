export const CESIUM_ACCESS_MODE = Object.freeze({
  DEFAULT: 'default',
  CUSTOM: 'custom',
});

export const USER_CESIUM_PREFERENCE_KEY = 'fotw-cesium-access-v1';
export const USER_CESIUM_PENDING_START_KEY = 'fotw-cesium-start-v1';

const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 4096;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function browserSessionStorage() {
  try { return globalThis.sessionStorage || null; }
  catch { return null; }
}

function selectedStorage(storage) {
  return storage === undefined ? browserSessionStorage() : storage;
}

function removeStoredPreference(storage) {
  try { storage?.removeItem(USER_CESIUM_PREFERENCE_KEY); }
  catch { /* session storage is optional */ }
}

function readStoredPreference(storage) {
  const target = selectedStorage(storage);
  if (!target) return { mode: CESIUM_ACCESS_MODE.DEFAULT, token: '' };

  let raw;
  try { raw = target.getItem(USER_CESIUM_PREFERENCE_KEY); }
  catch { return { mode: CESIUM_ACCESS_MODE.DEFAULT, token: '' }; }
  if (!raw) return { mode: CESIUM_ACCESS_MODE.DEFAULT, token: '' };

  try {
    const saved = JSON.parse(raw);
    if (saved?.mode === CESIUM_ACCESS_MODE.DEFAULT) {
      return { mode: CESIUM_ACCESS_MODE.DEFAULT, token: '' };
    }
    if (saved?.mode === CESIUM_ACCESS_MODE.CUSTOM) {
      const token = normalizeCesiumIonToken(saved.token);
      if (validateCesiumIonToken(token).ok) return { mode: CESIUM_ACCESS_MODE.CUSTOM, token };
    }
  } catch { /* discard malformed session data below */ }

  removeStoredPreference(target);
  return { mode: CESIUM_ACCESS_MODE.DEFAULT, token: '' };
}

function savePreference(preference, storage) {
  const target = selectedStorage(storage);
  if (!target) return false;
  try {
    target.setItem(USER_CESIUM_PREFERENCE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

export function normalizeCesiumIonToken(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateCesiumIonToken(value) {
  const token = normalizeCesiumIonToken(value);
  if (!token) return { ok: false, code: 'empty' };
  if (token.length < MIN_TOKEN_LENGTH) return { ok: false, code: 'too_short' };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, code: 'too_long' };
  if (!JWT_SHAPE.test(token)) return { ok: false, code: 'invalid_format' };
  return { ok: true, code: 'valid' };
}

export function getUserCesiumAccessMode(storage) {
  return readStoredPreference(storage).mode;
}

// Read this immediately before selecting and registering the terrain auth plugin.
// An empty string means the deployment's default broker/token should remain active.
export function getActiveUserCesiumToken(storage) {
  return readStoredPreference(storage).token;
}

export function selectDefaultCesiumAccess(storage) {
  const ok = savePreference({ mode: CESIUM_ACCESS_MODE.DEFAULT }, storage);
  return { ok, mode: CESIUM_ACCESS_MODE.DEFAULT, code: ok ? 'saved' : 'storage_unavailable' };
}

export function selectCustomCesiumAccess(value, storage) {
  const token = normalizeCesiumIonToken(value);
  const validation = validateCesiumIonToken(token);
  if (!validation.ok) return { ok: false, mode: CESIUM_ACCESS_MODE.CUSTOM, code: validation.code };
  const ok = savePreference({ mode: CESIUM_ACCESS_MODE.CUSTOM, token }, storage);
  return { ok, mode: CESIUM_ACCESS_MODE.CUSTOM, code: ok ? 'saved' : 'storage_unavailable' };
}

export function clearUserCesiumAccess(storage) {
  removeStoredPreference(selectedStorage(storage));
}

export function queueCesiumStart(action, storage) {
  if (action !== 'solo' && action !== 'multiplayer') return false;
  const target = selectedStorage(storage);
  if (!target) return false;
  try {
    target.setItem(USER_CESIUM_PENDING_START_KEY, action);
    return true;
  } catch {
    return false;
  }
}

export function consumeCesiumStart(storage) {
  const target = selectedStorage(storage);
  if (!target) return '';
  try {
    const action = target.getItem(USER_CESIUM_PENDING_START_KEY);
    target.removeItem(USER_CESIUM_PENDING_START_KEY);
    return action === 'solo' || action === 'multiplayer' ? action : '';
  } catch {
    return '';
  }
}
