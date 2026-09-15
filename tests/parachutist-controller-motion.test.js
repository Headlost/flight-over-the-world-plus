import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import {
  createParachutistModel,
  updateParachutistModel,
  ParachutistController,
  PARACHUTIST_GROUND_CLEARANCE,
  PARACHUTIST_WALK_SPEED,
  PARACHUTIST_RUN_SPEED,
} from '../src/game/paraglider.js';
import { disposeModel } from '../src/game/dispose.js';

function step(pilot, controls, seconds = 2) {
  for (let frame = 0; frame < seconds * 60; frame++) pilot.update(1 / 60, controls);
}

test('landing keeps impact speed until animation consumes it and ignores repeated surface corrections', () => {
  const pilot = new ParachutistController(52, 21, 103);
  pilot.verticalSpeed = -4.25;
  pilot.land(100);
  assert.equal(pilot.landingId, 1);
  assert.equal(pilot.landingImpact, 4.25);
  assert.equal(pilot.verticalSpeed, 0);
  assert.equal(pilot.height, 100 + PARACHUTIST_GROUND_CLEARANCE);
  step(pilot, { pitch: 0, roll: 0, throttle: 0 }, 0.5);
  pilot.land(100.04);
  pilot.settleOnSurface(100.08);
  assert.equal(pilot.landingId, 1, 'ground-height updates must not replay the knee compression');
  assert.equal(pilot.landingImpact, 4.25);
  assert.equal(pilot.takeOff(100.08), true);
  pilot.verticalSpeed = -0.65;
  pilot.land(100.08);
  assert.equal(pilot.landingId, 2);
  assert.equal(pilot.landingImpact, 0.65, 'a new touchdown must use its own impact speed');
});

test('grounded run accelerates with Shift and smoothly returns to walk; reverse remains controllable', () => {
  const pilot = new ParachutistController(52, 21, 100);
  pilot.land(100);
  const initialLat = pilot.lat;
  step(pilot, { pitch: -1, roll: 0, throttle: 0 });
  assert.ok(Math.abs(pilot.speed - PARACHUTIST_WALK_SPEED) < 1e-6);
  const walkingSpeed = pilot.speed;
  pilot.update(1 / 60, { pitch: -1, roll: 0, throttle: 1 });
  assert.ok(pilot.speed > walkingSpeed && pilot.speed < PARACHUTIST_RUN_SPEED);
  step(pilot, { pitch: -1, roll: 0, throttle: 1 });
  assert.ok(Math.abs(pilot.speed - PARACHUTIST_RUN_SPEED) < 1e-6);
  assert.ok(pilot.lat > initialLat);
  step(pilot, { pitch: -1, roll: 0, throttle: 0 });
  assert.ok(Math.abs(pilot.speed - PARACHUTIST_WALK_SPEED) < 1e-6);
  step(pilot, { pitch: 1, roll: 0, throttle: 1 });
  assert.ok(Math.abs(pilot.speed + PARACHUTIST_WALK_SPEED) < 1e-6);
  step(pilot, { pitch: 0, roll: 0, throttle: 1 });
  assert.ok(Math.abs(pilot.speed) < 1e-6, 'Shift alone must not propel a stationary character');
  assert.equal(pilot.height, 100 + PARACHUTIST_GROUND_CLEARANCE);
});

test('landing from a roof captures descent and a blocked step does not fake an impact', () => {
  const pilot = new ParachutistController(52, 21, 120);
  pilot.land(120);
  step(pilot, { pitch: -1, roll: 0, throttle: 1 }, 0.5);
  pilot.settleOnSurface(121.2);
  assert.equal(pilot.state, 'grounded');
  assert.equal(pilot.speed, 0);
  assert.equal(pilot.landingId, 1);
  step(pilot, { pitch: -1, roll: 0, throttle: 1 }, 0.5);
  pilot.settleOnSurface(115);
  assert.equal(pilot.state, 'airborne');
  pilot.verticalSpeed = -2.4;
  pilot.land(115);
  assert.equal(pilot.landingImpact, 2.4);
  assert.equal(pilot.landingId, 2);
});

test('real canopy brake lines track wrist grips through the pilot offset and steering pose', () => {
  const root = createParachutistModel();
  try {
    root.position.set(25, 100, -8);
    root.rotation.set(0.12, 0.8, -0.14);
    root.scale.setScalar(2);
    const rig = root.userData.parachutist;
    const buffer = rig.canopy.userData.suspension.suspensionPositions;
    const originalArray = buffer.array;
    for (const controls of [{ steering: 0, brake: 0 }, { steering: 1, brake: 0 }, { steering: 0, brake: 1 }]) {
      for (let frame = 0; frame < 100; frame++) updateParachutistModel(root, 'airborne', 10.5, 1 / 60, controls);
      root.updateMatrixWorld(true);
      for (const bank of rig.canopy.userData.suspension.banks) {
        const index = bank.side < 0 ? 0 : 1;
        const grip = rig.character.arms[index].grip.getWorldPosition(new Vector3());
        const rope = new Vector3().fromBufferAttribute(buffer, bank.brakeStart).applyMatrix4(rig.canopy.matrixWorld);
        const toggle = rig.canopy.userData.suspension.toggles[index].getWorldPosition(new Vector3());
        assert.ok(grip.distanceTo(rope) < 1e-5, 'rendered rope must reach the moving fingers in world space');
        assert.ok(grip.distanceTo(toggle) < 1e-8, 'toggle must remain inside the actual hand');
      }
    }
    assert.equal(buffer.array, originalArray, 'steering must update the small existing GPU buffer');
  } finally { disposeModel(root); }
});

test('controller impact reaches model knees once, then both body and knees recover', () => {
  const pilot = new ParachutistController(52, 21, 103);
  const root = createParachutistModel();
  const rig = root.userData.parachutist;
  function animate() {
    updateParachutistModel(root, pilot.state, pilot.speed, 1 / 60, {
      landingId: pilot.landingId, landingImpact: pilot.landingImpact, verticalSpeed: pilot.verticalSpeed,
    });
  }
  try {
    for (let frame = 0; frame < 30; frame++) animate();
    pilot.verticalSpeed = -5;
    pilot.land(100);
    let lowestBody = Infinity, largestKneeBend = 0;
    for (let frame = 0; frame < 90; frame++) {
      animate();
      lowestBody = Math.min(lowestBody, rig.character.body.position.y);
      largestKneeBend = Math.max(largestKneeBend, -rig.character.legs[0].lower.rotation.x);
      if (frame === 20) pilot.land(100.03);
    }
    assert.ok(rig.character.body.position.y - lowestBody > .1);
    assert.ok(largestKneeBend > .7);
    assert.ok(rig.pose.landingCompression < .001);
    assert.ok(-rig.character.legs[0].lower.rotation.x < largestKneeBend - .3);
    assert.equal(pilot.landingId, 1);
    assert.equal(rig.canopy.visible, false);
  } finally { disposeModel(root); }
});
