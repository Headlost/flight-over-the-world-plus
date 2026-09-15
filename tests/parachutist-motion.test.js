import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { createParachutistCharacter } from "../src/game/parachutistCharacter.js";
import {
  applyParachutistPose, createParachutistPose, parachutistGait,
  parachutistLandingCompression, sampleParachutistPose, updateParachutistCharacter,
} from "../src/game/parachutistMotion.js";
import { disposeModel } from "../src/game/dispose.js";

const TAU = Math.PI * 2;

test("forward and backward walk/run keep supporting soles on the floor through weight transfer", () => {
  const character = createParachutistCharacter();
  const pose = createParachutistPose();
  const ankle = new Vector3();
  const target = new Vector3();
  const bounds = new Box3();
  try {
    for (const speed of [0, 0.4, 1.5, 2.5, -2.5, 4.8]) {
      let supportingFrames = 0;
      let liftedFrames = 0;
      for (let frame = 0; frame < 120; frame += 1) {
        sampleParachutistPose({ state: "grounded", speed, phase: frame / 120 * TAU, time: frame / 60 }, pose);
        applyParachutistPose(character, pose);
        character.pilot.updateMatrixWorld(true);
        for (let index = 0; index < 2; index += 1) {
          const leg = character.legs[index];
          const sampled = pose.legs[index];
          bounds.setFromObject(leg.boot);
          assert.ok(bounds.min.y >= -0.323, `speed ${speed}, frame ${frame}: boot penetrates floor`);
          assert.ok(leg.lower.rotation.x < 0, "knee must flex only backwards");
          assert.ok(Math.abs(leg.lower.rotation.x) < 2.35, "knee must stay within anatomical bend range");
          if (sampled.contact) {
            supportingFrames += 1;
            assert.ok(Math.abs(bounds.min.y + 0.32) < 0.004, "planted sole must support the body's weight");
            leg.boot.getWorldPosition(ankle);
            assert.ok(ankle.distanceTo(target.fromArray(sampled.footPosition)) < 1e-6,
              "IK must reach each foot target without stretching either bone");
          } else if (bounds.min.y > -0.27) liftedFrames += 1;
        }
      }
      assert.ok(supportingFrames > 0);
      if (Math.abs(speed) > 1) assert.ok(liftedFrames > 20, "swinging feet must clear the floor");
    }
  } finally { disposeModel(character.pilot); }
});

test("running increases knee recovery and arm drive; each arm counters its own advancing leg", () => {
  const character = createParachutistCharacter();
  try {
    const peaks = [];
    for (const speed of [1.5, 4.8]) {
      let knee = 0;
      let arm = 0;
      for (let frame = 0; frame < 100; frame += 1) {
        const pose = sampleParachutistPose({ state: "grounded", speed, phase: frame / 100 * TAU });
        applyParachutistPose(character, pose);
        knee = Math.max(knee, -character.legs[0].lower.rotation.x);
        arm = Math.max(arm, Math.abs(character.arms[0].upper.rotation.x));
      }
      peaks.push({ knee, arm });
    }
    assert.ok(peaks[1].knee > peaks[0].knee + 0.4, "running heel recovery needs deeper knee flexion");
    assert.ok(peaks[1].arm > peaks[0].arm + 0.2, "running should drive shoulders more strongly");
    const pose = sampleParachutistPose({ state: "grounded", speed: 2.5, phase: 0 });
    applyParachutistPose(character, pose);
    assert.ok(character.legs[0].upper.rotation.x > 0.2, "left leg advances at left heel strike");
    assert.ok(character.arms[0].upper.rotation.x < -0.2, "left arm moves back against left leg");
    assert.ok(character.arms[1].upper.rotation.x > 0.2, "right arm moves forward against left leg");
    assert.ok(character.arms.every(arm => arm.lower.rotation.x > 0), "elbows should flex forwards");

    const gait = parachutistGait(2.5);
    const before = sampleParachutistPose({ state: "grounded", speed: 2.5, phase: TAU * 0.20 });
    const dt = 0.01;
    const after = sampleParachutistPose({ state: "grounded", speed: 2.5,
      phase: TAU * (0.20 + gait.cadence * dt) });
    assert.ok(Math.abs(after.legs[0].footPosition[2] - before.legs[0].footPosition[2] - 2.5 * dt) < 1e-9,
      "the supporting foot must move backwards at the same speed as the root moves forwards");
  } finally { disposeModel(character.pilot); }
});

test("flight grips curl onto toggles and steering or braking lowers the appropriate physical hand", () => {
  const character = createParachutistCharacter();
  const grip = new Vector3();
  function heights(steering = 0, brake = 0, time = 0) {
    const pose = sampleParachutistPose({ state: "airborne", steering, brake, time });
    applyParachutistPose(character, pose);
    character.pilot.updateMatrixWorld(true);
    return character.arms.map(arm => arm.grip.getWorldPosition(grip).y);
  }
  try {
    const neutral = heights();
    const right = heights(1);
    const left = heights(-1);
    const both = heights(0, 1);
    assert.ok(right[1] < neutral[1] - 0.20 && Math.abs(right[0] - neutral[0]) < 0.03);
    assert.ok(left[0] < neutral[0] - 0.20 && Math.abs(left[1] - neutral[1]) < 0.03);
    assert.ok(both.every((height, index) => height < neutral[index] - 0.23));
    for (const arm of character.arms) {
      assert.equal(arm.grip.parent, arm.wrist);
      assert.ok(arm.gripSurfaces.length >= 2);
      assert.ok(arm.gripSurfaces.every(mesh => mesh.morphTargetInfluences[0] === 1));
      const surface = arm.gripSurfaces[0].geometry;
      assert.ok(surface.morphAttributes.position[0].array.some((value, index) =>
        Math.abs(value - surface.attributes.position.array[index]) > 0.025), "flight must visibly curl fingers");
    }
    heights(0, 0, 0);
    const kneeBefore = character.legs[0].lower.rotation.x;
    heights(0, 0, 1);
    assert.ok(Math.abs(character.legs[0].lower.rotation.x - kneeBefore) > 0.015,
      "suspended legs need subtle independent motion");
    const airborne = sampleParachutistPose({ state: "airborne", groundClearance: 20, verticalSpeed: -2 });
    const approaching = sampleParachutistPose({ state: "airborne", groundClearance: 0.4, verticalSpeed: -2 });
    assert.ok(approaching.legs[0].kneeFlexion < airborne.legs[0].kneeFlexion * 0.5,
      "feet must reach towards the ground before touchdown");
  } finally { disposeModel(character.pilot); }
});

test("landing absorbs actual impact with a deeper knee bend and returns to planted standing posture", () => {
  const character = createParachutistCharacter();
  try {
    const light = parachutistLandingCompression(1.35, 0.15);
    const hard = parachutistLandingCompression(7, 0.15);
    assert.ok(hard > light * 2);
    assert.equal(parachutistLandingCompression(7, 0), 0);
    assert.equal(parachutistLandingCompression(7, 1.1), 0);
    const standing = sampleParachutistPose({ state: "grounded", speed: 0 });
    let peakKnee = 0;
    for (let frame = 0; frame < 80; frame += 1) {
      const pose = sampleParachutistPose({ state: "grounded", speed: 0, landingImpact: 7, landingTime: frame / 60 });
      applyParachutistPose(character, pose);
      character.pilot.updateMatrixWorld(true);
      peakKnee = Math.max(peakKnee, -character.legs[0].lower.rotation.x);
      for (const leg of character.legs) {
        const bounds = new Box3().setFromObject(leg.boot);
        assert.ok(Math.abs(bounds.min.y + 0.32) < 0.004, "crouching must not pull the feet through the ground");
      }
    }
    assert.ok(peakKnee > 1.3, "hard landing requires a visible deep knee bend");
    assert.ok(Math.abs(character.body.position.y - standing.bodyPosition[1]) < 0.001);

    updateParachutistCharacter(character, { state: "airborne", speed: 10, dt: 1 / 60, verticalSpeed: -5, landingId: 2 });
    updateParachutistCharacter(character, { state: "grounded", speed: 0, dt: 1 / 60, landingId: 3, landingImpact: 5 });
    for (let frame = 0; frame < 10; frame += 1) {
      updateParachutistCharacter(character, { state: "grounded", speed: 0, dt: 1 / 60, landingId: 3, landingImpact: 5 });
    }
    assert.ok(character.motion.pose.landingCompression > 0.15, "a persistent event id must not restart compression every frame");
    for (let frame = 0; frame < 80; frame += 1) {
      updateParachutistCharacter(character, { state: "grounded", speed: 0, dt: 1 / 60, landingId: 3, landingImpact: 5 });
    }
    assert.equal(character.motion.pose.landingCompression, 0);
  } finally { disposeModel(character.pilot); }
});

test("the same explicit sample bakes identically regardless of prior poses or output reuse", () => {
  const input = { state: "grounded", speed: 4.8, time: 0.75, phase: 1.75,
    steering: 0.2, brake: 0, landingImpact: 3, landingTime: 0.65 };
  const expected = sampleParachutistPose(input);
  const reused = sampleParachutistPose({ state: "airborne", steering: -1, time: 3 });
  assert.equal(sampleParachutistPose(input, reused), reused);
  assert.deepEqual(reused, expected);
  const invalid = sampleParachutistPose({ state: "grounded", speed: NaN, time: Infinity, phase: NaN });
  assert.ok(!JSON.stringify(invalid).includes("null"), "invalid network values must not produce NaN transforms");
});

test("pelvis and limbs remain continuous across heel strike, toe-off and the cycle seam", () => {
  const epsilon = 0.000001;
  const quaternionDistance = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, value, index) => sum + value * b[index], 0))));
  for (const speed of [1.5, 2.5, -2.5, 4.8]) {
    const gait = parachutistGait(speed);
    for (const boundary of [0, 0.5, gait.stance, gait.stance + 0.5]) {
      const before = sampleParachutistPose({ state: "grounded", speed, phase: TAU * (boundary - epsilon) });
      const after = sampleParachutistPose({ state: "grounded", speed, phase: TAU * (boundary + epsilon) });
      assert.ok(Math.abs(after.bodyPosition[1] - before.bodyPosition[1]) < 0.00001,
        `speed ${speed}, phase ${boundary}: changing the support leg must not snap the pelvis`);
      for (let index = 0; index < 2; index += 1) {
        for (const joint of ["upper", "lower", "ankle"]) {
          assert.ok(quaternionDistance(before.legs[index][joint], after.legs[index][joint]) < 0.001,
            `speed ${speed}, phase ${boundary}: ${joint} must not snap at contact`);
        }
      }
    }
    // Match first derivatives too: the boot cannot reverse velocity suddenly
    // at either endpoint of its swing while the supporting ankle is planted.
    for (const boundary of [0, gait.stance]) {
      const at = sampleParachutistPose({ state: "grounded", speed, phase: TAU * boundary }).legs[0].footPosition[2];
      const before = sampleParachutistPose({ state: "grounded", speed, phase: TAU * (boundary - epsilon) }).legs[0].footPosition[2];
      const after = sampleParachutistPose({ state: "grounded", speed, phase: TAU * (boundary + epsilon) }).legs[0].footPosition[2];
      assert.ok(Math.abs((at - before) / epsilon - (after - at) / epsilon) < 0.0001,
        "swing endpoint horizontal velocity must match the grounded stance velocity");
    }
  }
});

test("touchdown blends the arms without importing airborne speed or disturbing planted feet", () => {
  const character = createParachutistCharacter();
  try {
    const flight = updateParachutistCharacter(character, { state: "airborne", speed: 10.5, dt: 1 / 60,
      verticalSpeed: -4, landingId: 0 });
    const previousArm = [...flight.arms[0].upper];
    const contact = updateParachutistCharacter(character, { state: "grounded", speed: 0, dt: 1 / 60,
      landingId: 1, landingImpact: 4 });
    assert.equal(character.motion.speed, 0);
    assert.equal(contact.run, 0);
    assert.deepEqual(contact.arms[0].upper, previousArm, "arms start touchdown at the actual flight pose");
    character.pilot.updateMatrixWorld(true);
    for (const leg of character.legs) {
      assert.ok(Math.abs(new Box3().setFromObject(leg.boot).min.y + 0.32) < 0.004);
    }
    for (let frame = 0; frame < 70; frame += 1) {
      updateParachutistCharacter(character, { state: "grounded", speed: 0, dt: 1 / 60, landingId: 1 });
    }
    const beforeLaunch = character.body.position.toArray();
    const beforeKnee = character.legs[0].lower.quaternion.toArray();
    updateParachutistCharacter(character, { state: "launching", speed: 8, dt: 1 / 60, landingId: 1 });
    assert.ok(character.body.position.distanceTo(new Vector3(...beforeLaunch)) < 1e-12,
      "liftoff starts from the standing body position");
    assert.deepEqual(character.legs[0].lower.quaternion.toArray(), beforeKnee, "liftoff starts from the existing knee bend");
    for (let frame = 0; frame < 20; frame += 1) {
      updateParachutistCharacter(character, { state: "airborne", speed: 10.5, dt: 1 / 60, landingId: 1 });
    }
    assert.ok(character.legs[0].lower.rotation.x < -0.85, "liftoff settles smoothly into the suspended pose");
  } finally { disposeModel(character.pilot); }
});

test("unknown terrain clearance does not prepare landing and absent remote samples preserve descent impact", () => {
  const knownHigh = sampleParachutistPose({ state: "airborne", groundClearance: 100, verticalSpeed: -5 });
  const unknown = sampleParachutistPose({ state: "airborne", groundClearance: Infinity, verticalSpeed: -5 });
  assert.deepEqual(unknown, knownHigh, "unknown provider height must not be treated as contact with the floor");
  const character = createParachutistCharacter();
  try {
    updateParachutistCharacter(character, { state: "airborne", speed: 10.5, verticalSpeed: -5, dt: 1 / 60 });
    updateParachutistCharacter(character, { state: "airborne", speed: 10.5, dt: 1 / 60 });
    updateParachutistCharacter(character, { state: "grounded", speed: 0, dt: 1 / 60 });
    assert.equal(character.motion.landingImpact, 5,
      "a remote interpolation frame without velocity must preserve the last measured descent");
  } finally { disposeModel(character.pilot); }
});
