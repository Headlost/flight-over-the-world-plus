import test from 'node:test';
import assert from 'node:assert/strict';
import { blackHoleRumblePattern, BLACK_HOLE_ENTRY_RUMBLE } from '../src/game/blackHoleFeedback.js';

test('black-hole rumble is absent outside the gravity warning range', () => {
  assert.equal(blackHoleRumblePattern(0), null);
  assert.equal(blackHoleRumblePattern(0.025), null);
  assert.equal(blackHoleRumblePattern(Number.NaN), null);
});

test('black-hole rumble rises toward capture and peaks on entry', () => {
  const far = blackHoleRumblePattern(0.15);
  const near = blackHoleRumblePattern(0.75);
  const capture = blackHoleRumblePattern(0.75, 1);
  assert.ok(far.strongMagnitude < near.strongMagnitude);
  assert.ok(near.strongMagnitude < capture.strongMagnitude);
  assert.ok(far.weakMagnitude < near.weakMagnitude);
  assert.ok(far.intervalMs > near.intervalMs);
  assert.ok(near.intervalMs > capture.intervalMs);
  assert.ok(capture.duration <= capture.intervalMs);
  assert.equal(capture.strongMagnitude, 1);
  assert.equal(BLACK_HOLE_ENTRY_RUMBLE.strongMagnitude, 1);
  assert.ok(BLACK_HOLE_ENTRY_RUMBLE.duration > capture.duration);
});
