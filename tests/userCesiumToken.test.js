import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CESIUM_ACCESS_MODE,
  USER_CESIUM_PENDING_START_KEY,
  USER_CESIUM_PREFERENCE_KEY,
  clearUserCesiumAccess,
  consumeCesiumStart,
  getActiveUserCesiumToken,
  getUserCesiumAccessMode,
  normalizeCesiumIonToken,
  queueCesiumStart,
  selectCustomCesiumAccess,
  selectDefaultCesiumAccess,
  validateCesiumIonToken,
} from '../src/game/userCesiumToken.js';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); },
  };
}

function fixtureToken(mark = 'a') {
  return ['headerpart', mark.repeat(28), 'signature'.repeat(4)].join('.');
}

test('normalizes only surrounding whitespace and validates a JWT-shaped ion token', () => {
  const token = fixtureToken();
  assert.equal(normalizeCesiumIonToken(` \n${token}\t `), token);
  assert.deepEqual(validateCesiumIonToken(token), { ok: true, code: 'valid' });
  assert.equal(validateCesiumIonToken('').code, 'empty');
  assert.equal(validateCesiumIonToken('short.token.value').code, 'too_short');
  assert.equal(validateCesiumIonToken(`header.${'x'.repeat(40)}.bad value`).code, 'invalid_format');
  assert.equal(validateCesiumIonToken(`a.${'x'.repeat(4096)}.z`).code, 'too_long');
});

test('keeps deployment default active until a valid custom token is selected', () => {
  const storage = memoryStorage();
  assert.equal(getUserCesiumAccessMode(storage), CESIUM_ACCESS_MODE.DEFAULT);
  assert.equal(getActiveUserCesiumToken(storage), '');

  const token = fixtureToken('b');
  assert.deepEqual(selectCustomCesiumAccess(token, storage), {
    ok: true, mode: CESIUM_ACCESS_MODE.CUSTOM, code: 'saved',
  });
  assert.equal(getUserCesiumAccessMode(storage), CESIUM_ACCESS_MODE.CUSTOM);
  assert.equal(getActiveUserCesiumToken(storage), token);

  assert.deepEqual(selectDefaultCesiumAccess(storage), {
    ok: true, mode: CESIUM_ACCESS_MODE.DEFAULT, code: 'saved',
  });
  assert.equal(getActiveUserCesiumToken(storage), '');
  assert.equal(JSON.parse(storage.snapshot()[USER_CESIUM_PREFERENCE_KEY]).token, undefined);
});

test('never stores invalid input and discards malformed session data', () => {
  const storage = memoryStorage();
  assert.deepEqual(selectCustomCesiumAccess('not a token', storage), {
    ok: false, mode: CESIUM_ACCESS_MODE.CUSTOM, code: 'too_short',
  });
  assert.deepEqual(storage.snapshot(), {});

  storage.setItem(USER_CESIUM_PREFERENCE_KEY, JSON.stringify({ mode: 'custom', token: 'broken' }));
  assert.equal(getActiveUserCesiumToken(storage), '');
  assert.equal(getUserCesiumAccessMode(storage), CESIUM_ACCESS_MODE.DEFAULT);
  assert.deepEqual(storage.snapshot(), {});
});

test('uses only the supplied session-like storage and clears the complete preference', () => {
  const storage = memoryStorage();
  const token = fixtureToken('c');
  selectCustomCesiumAccess(token, storage);
  assert.match(storage.snapshot()[USER_CESIUM_PREFERENCE_KEY], /"mode":"custom"/);
  clearUserCesiumAccess(storage);
  assert.deepEqual(storage.snapshot(), {});
});

test('fails closed when session storage is unavailable', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(getActiveUserCesiumToken(blocked), '');
  assert.equal(getUserCesiumAccessMode(blocked), CESIUM_ACCESS_MODE.DEFAULT);
  assert.deepEqual(selectCustomCesiumAccess(fixtureToken('d'), blocked), {
    ok: false, mode: CESIUM_ACCESS_MODE.CUSTOM, code: 'storage_unavailable',
  });
});

test('queues only a safe start action across the one required reload', () => {
  const storage = memoryStorage();
  assert.equal(queueCesiumStart('solo', storage), true);
  assert.equal(storage.snapshot()[USER_CESIUM_PENDING_START_KEY], 'solo');
  assert.equal(consumeCesiumStart(storage), 'solo');
  assert.equal(consumeCesiumStart(storage), '');
  assert.equal(queueCesiumStart('multiplayer', storage), true);
  assert.equal(consumeCesiumStart(storage), 'multiplayer');
  assert.equal(queueCesiumStart('unexpected', storage), false);
});
