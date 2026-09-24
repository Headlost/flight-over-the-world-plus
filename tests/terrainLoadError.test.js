import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainLoadErrorMessage } from '../src/game/terrainLoadError.js';

test('an ordinary descendant tile failure does not become a global lobby error', () => {
  assert.equal(terrainLoadErrorMessage({
    tile: { content: { uri: 'missing.glb' } },
    error: new Error('404'),
  }), null);
});

test('a failed root still produces an actionable terrain connection message', () => {
  const generic = terrainLoadErrorMessage({ tile: null, error: new TypeError('Failed to fetch') });
  assert.match(generic, /Terrain could not start/);
  assert.match(generic, /Game access/);
});

test('safe broker reason and custom-token root failures have specific messages', () => {
  const error = new Error('admission failed');
  error.terrainReason = 'admission_unavailable';
  assert.match(terrainLoadErrorMessage({ tile: null, error }), /temporarily paused/);
  assert.match(terrainLoadErrorMessage({ tile: null, error }, { userToken: true }), /your Cesium token/);
});

test('broker timeout and confirmed-budget refusals never collapse into the generic terrain error', () => {
  for (const [reason, expected] of [
    ['admission_timeout', /timed out before the broker responded/],
    ['no_confirmed_remaining_budget', /confirmed shared terrain limit/],
    ['no_confirmed_monthly_budget', /confirmed shared terrain limit/],
    ['monthly_budget_exhausted', /limit has been reached/],
    ['budget_busy', /admission is busy/],
    ['request_already_claimed', /second shared allocation was prevented/],
  ]) {
    const error = new Error('safe broker failure');
    error.terrainReason = reason;
    const message = terrainLoadErrorMessage({ tile: null, error });
    assert.match(message, expected);
    assert.doesNotMatch(message, /Terrain could not start/);
  }
});
