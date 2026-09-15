import { Euler, Matrix4, Quaternion, Vector3 } from "three";

const TAU = Math.PI * 2;
const FLOOR = -0.32;
const THIGH = 0.45;
const SHIN = 0.43;
const UPPER_ARM = 0.33;
const FOREARM = 0.388;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
const q = () => [0, 0, 0, 1];

// Reused math scratch; sampling is synchronous and independent of render time.
const euler = new Euler();
const rotation = new Quaternion();
const bodyRotation = new Quaternion();
const inverseBody = new Quaternion();
const parentRotation = new Quaternion();
const endRotation = new Quaternion();
const matrix = new Matrix4();
const point = new Vector3();
const direction = new Vector3();
const pole = new Vector3();
const middle = new Vector3();
const upperDirection = new Vector3();
const lowerDirection = new Vector3();
const axisX = new Vector3();
const axisY = new Vector3();
const axisZ = new Vector3();
const sampledGait = {};

function eulerQuaternion(target, x, y = 0, z = 0) {
  rotation.setFromEuler(euler.set(x, y, z, "XYZ")).toArray(target);
}

/** A reusable, JSON-serializable pose for runtime animation or Blender baking. */
export function createParachutistPose() {
  return {
    bodyPosition: [0, 0.92, 0], bodyQuaternion: q(), headQuaternion: q(),
    arms: [-1, 1].map(side => ({ side, upper: q(), lower: q(), wrist: q(), grip: 0, pull: 0 })),
    legs: [-1, 1].map(side => ({ side, upper: q(), lower: q(), ankle: q(),
      footPosition: [side * 0.125, -0.22, 0.004], footRoll: 0, contact: 1, kneeFlexion: 0 })),
    landingCompression: 0, groundWeight: 0, run: 0, cadence: 0,
  };
}

/** Same-foot cycles per second; stance travel equals ground speed / cadence. */
export function parachutistGait(speed = 0, result = {}) {
  const velocity = Math.abs(finite(speed));
  const run = smooth((velocity - 2.5) / 2.1);
  const stance = mix(0.62, 0.39, run);
  const travel = mix(0.62, 0.81, clamp(velocity / 2.5)) + run * 0.13;
  result.run = run;
  result.stance = stance;
  result.travel = travel;
  result.cadence = velocity > 0.05 ? velocity * stance / travel : 0;
  return result;
}

/** Impact is downward speed in metres/second, time is seconds since contact. */
export function parachutistLandingCompression(impact = 0, time = -1) {
  if (time < 0 || time > 1.1 || impact <= 0) return 0;
  const strength = clamp(finite(impact), 0, 12);
  const depth = clamp(0.035 + strength * 0.029, 0.045, 0.30);
  const attack = mix(0.16, 0.115, strength / 12);
  if (time < attack) return depth * smooth(time / attack);
  return depth * (1 - smooth((time - attack) / (0.64 + strength * 0.02)));
}

// Resolve a two-bone limb with an anatomical bend plane. A negative knee sign
// guarantees that calves fold backwards; elbows always flex forwards.
function solveLimb(target, poleX, poleY, poleZ, upperLength, lowerLength, bendSign, upper, lower) {
  const length = clamp(target.length(), Math.abs(upperLength - lowerLength) + 0.001,
    upperLength + lowerLength - 0.0001);
  direction.copy(target).normalize();
  const along = (upperLength * upperLength + length * length - lowerLength * lowerLength) / (2 * length);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  pole.set(poleX, poleY, poleZ).addScaledVector(direction, -direction.dot(pole));
  if (pole.lengthSq() < 0.000001) pole.set(0, 0, -1).addScaledVector(direction, direction.z);
  pole.normalize();
  middle.copy(direction).multiplyScalar(along).addScaledVector(pole, height);
  upperDirection.copy(middle).normalize();
  lowerDirection.copy(direction).multiplyScalar(length).sub(middle).normalize();
  axisX.crossVectors(upperDirection, lowerDirection).normalize().multiplyScalar(bendSign);
  axisY.copy(upperDirection).negate();
  axisZ.crossVectors(axisX, axisY).normalize();
  matrix.makeBasis(axisX, axisY, axisZ);
  rotation.setFromRotationMatrix(matrix).normalize().toArray(upper);
  const flexion = Math.acos(clamp(upperDirection.dot(lowerDirection), -1, 1));
  eulerQuaternion(lower, bendSign * flexion);
  return flexion;
}

function ankleHeight(roll) {
  // Heel and toe support switch as the foot rolls; the tread extends 1 mm
  // below the outsole. Use the actual boot silhouette, not a floating point.
  const edgeZ = roll >= 0 ? 0.094 : -0.184;
  return FLOOR + 0.101 * Math.cos(roll) + edgeZ * Math.sin(roll);
}

function solveLeg(leg, pose) {
  point.set(leg.footPosition[0] - pose.bodyPosition[0], leg.footPosition[1] - pose.bodyPosition[1],
    leg.footPosition[2] - pose.bodyPosition[2]);
  point.applyQuaternion(inverseBody);
  point.x -= leg.side * 0.125;
  point.y += 0.26;
  point.z -= 0.004;
  leg.kneeFlexion = solveLimb(point, 0, 0, -1, THIGH, SHIN, -1, leg.upper, leg.lower);
  parentRotation.copy(bodyRotation).multiply(rotation.fromArray(leg.upper)).multiply(rotation.fromArray(leg.lower));
  endRotation.setFromEuler(euler.set(leg.footRoll, 0, 0));
  parentRotation.invert().multiply(endRotation).normalize().toArray(leg.ankle);
}

/**
 * Evaluate one deterministic human pose. Coordinates use the existing pilot
 * origin and -Z forward. Quaternions are [x,y,z,w], distances metres, phase
 * radians and time seconds. Pass the previous output to avoid pose allocations.
 */
export function sampleParachutistPose(input = {}, pose = createParachutistPose()) {
  const speed = finite(input.speed);
  const time = finite(input.time);
  const phase = finite(input.phase);
  const grounded = input.state === "grounded";
  const steering = clamp(finite(input.steering), -1, 1);
  const brake = clamp(finite(input.brake));
  const gait = parachutistGait(speed, sampledGait);
  const activity = smooth(Math.abs(speed) / 0.45);
  const landing = grounded ? parachutistLandingCompression(finite(input.landingImpact), finite(input.landingTime, -1)) : 0;
  const settle = 1 - smooth(landing / 0.09);
  const moving = activity * settle;
  const sign = speed < 0 ? -1 : 1;
  pose.landingCompression = landing;
  pose.groundWeight = grounded ? 1 : 0;
  pose.run = grounded ? gait.run : 0;
  pose.cadence = grounded ? gait.cadence : 0;

  if (grounded) {
    let ceiling = 0.915;
    let sharedFootLift = Infinity;
    for (let index = 0; index < 2; index += 1) {
      const leg = pose.legs[index];
      const cycle = ((phase / TAU + index * 0.5) % 1 + 1) % 1;
      const inStance = cycle < gait.stance;
      let footZ;
      let lift = 0;
      let roll = 0;
      if (inStance) {
        const progress = cycle / gait.stance;
        footZ = gait.travel * (progress - 0.5);
        roll = 0.16 * (1 - smooth(progress / 0.20)) - 0.38 * smooth((progress - 0.70) / 0.30);
      } else {
        const progress = (cycle - gait.stance) / (1 - gait.stance);
        // Hermite endpoints preserve the same horizontal foot velocity as
        // stance. The foot briefly trails after toe-off before knee recovery
        // brings it forward, rather than reversing direction in one frame.
        const tangent = gait.travel * (1 - gait.stance) / gait.stance;
        footZ = gait.travel * (0.5 - smooth(progress))
          + tangent * (2 * progress ** 3 - 3 * progress ** 2 + progress);
        lift = Math.sin(Math.PI * progress) ** 1.35 * mix(0.13, 0.34, gait.run);
        roll = mix(-0.38, 0.16, smooth(progress));
      }
      leg.contact = moving < 0.05 ? 1 : inStance ? 1 : 0;
      leg.footRoll = roll * moving * sign;
      leg.footPosition[0] = leg.side * (0.125 + landing * 0.055);
      leg.footPosition[1] = ankleHeight(leg.footRoll) + lift * moving;
      leg.footPosition[2] = footZ * moving * sign + 0.004;
      sharedFootLift = Math.min(sharedFootLift, lift * moving);
      // Both legs constrain reach throughout the cycle. An approaching heel
      // gradually lowers the pelvis; switching the support label itself must
      // never cause a sudden height change. Swing lift naturally frees reach.
      const reach = 0.868 - gait.run * 0.025;
      const legZ = leg.footPosition[2] - 0.004;
      ceiling = Math.min(ceiling, leg.footPosition[1] + 0.26 + Math.sqrt(Math.max(0.1, reach * reach - legZ * legZ)));
    }
    const airborneBob = sharedFootLift * 0.15 * gait.run;
    pose.bodyPosition[0] = -Math.sin(phase) * 0.018 * moving;
    pose.bodyPosition[1] = mix(0.911, ceiling, moving) + airborneBob - landing;
    pose.bodyPosition[2] = landing * 0.18;
    const lean = -0.035 * moving - gait.run * 0.13 * moving - landing * 0.72;
    const twist = Math.sin(phase) * 0.065 * moving;
    const sway = Math.sin(phase) * 0.014 * moving;
    eulerQuaternion(pose.bodyQuaternion, lean, twist, sway);
    bodyRotation.fromArray(pose.bodyQuaternion);
    inverseBody.copy(bodyRotation).invert();
    for (const leg of pose.legs) solveLeg(leg, pose);
    eulerQuaternion(pose.headQuaternion, -lean * 0.6 + Math.sin(time * 1.5) * 0.01,
      -twist * 0.65, -sway * 0.8);

    for (let index = 0; index < 2; index += 1) {
      const arm = pose.arms[index];
      const swing = Math.cos(phase + index * Math.PI) * moving * sign;
      eulerQuaternion(arm.upper, 0.07 - swing * mix(0.43, 0.76, gait.run) + landing * 1.0,
        -arm.side * gait.run * 0.07, arm.side * (0.075 + landing * 0.18));
      eulerQuaternion(arm.lower, 0.19 + gait.run * 0.96 + (1 + swing) * 0.08 + landing * 0.5);
      eulerQuaternion(arm.wrist, -0.08 - gait.run * 0.08, arm.side * 0.04);
      arm.grip = mix(0.16, 0.38, gait.run);
      arm.pull = 0;
    }
  } else {
    const preparation = !Number.isFinite(input.groundClearance) || finite(input.verticalSpeed) >= 0 ? 0
      : 1 - smooth((finite(input.groundClearance) - 0.3) / 3.2);
    const breathe = Math.sin(time * 1.7);
    pose.bodyPosition[0] = steering * 0.016;
    pose.bodyPosition[1] = 0.835 + breathe * 0.004 + preparation * 0.063;
    pose.bodyPosition[2] = 0;
    eulerQuaternion(pose.bodyQuaternion, -0.10 + brake * 0.035, steering * 0.035, -steering * 0.032);
    bodyRotation.fromArray(pose.bodyQuaternion);
    eulerQuaternion(pose.headQuaternion, -0.035, steering * 0.14 + Math.sin(time * 0.6) * 0.025,
      steering * 0.018);
    for (let index = 0; index < 2; index += 1) {
      const leg = pose.legs[index];
      const drift = Math.sin(time * 1.35 + index * 1.1) * 0.026;
      const hip = mix(0.63 + drift + steering * leg.side * 0.065, 0.17, preparation);
      const knee = mix(-0.94 - drift * 1.2, -0.28, preparation);
      eulerQuaternion(leg.upper, hip, leg.side * 0.018, leg.side * 0.045 + steering * 0.018);
      eulerQuaternion(leg.lower, knee);
      eulerQuaternion(leg.ankle, 0.11 - drift * 0.7 - brake * 0.03);
      leg.kneeFlexion = -knee;
      leg.contact = 0;
      leg.footRoll = 0;
      leg.footPosition.fill(0);
    }
    for (const arm of pose.arms) {
      const pull = clamp(brake * 0.83 + Math.max(0, steering * arm.side) * 0.77 + preparation * 0.16);
      arm.pull = pull;
      arm.grip = 1;
      // Toggle targets travel down beside the shoulder. The elbow points
      // outwards/down, and both arm segments reach the same physical grip.
      point.set(arm.side * (0.085 + pull * 0.015), 0.31 - pull * 0.37,
        -0.17 + pull * 0.025 + breathe * 0.003);
      solveLimb(point, arm.side, -0.40, 0.04, UPPER_ARM, FOREARM, 1, arm.upper, arm.lower);
      eulerQuaternion(arm.wrist, -0.12 - pull * 0.14, arm.side * 0.10, arm.side * 0.06);
    }
  }
  return pose;
}

/** Apply a sampled pose without changing terrain, physics, or player root. */
export function applyParachutistPose(character, pose) {
  character.body.position.fromArray(pose.bodyPosition);
  character.body.quaternion.fromArray(pose.bodyQuaternion);
  character.headGroup?.quaternion.fromArray(pose.headQuaternion);
  for (let index = 0; index < 2; index += 1) {
    const arm = character.arms[index];
    const target = pose.arms[index];
    arm.upper.quaternion.fromArray(target.upper);
    arm.lower.quaternion.fromArray(target.lower);
    arm.wrist?.quaternion.fromArray(target.wrist);
    for (const mesh of arm.gripSurfaces || []) mesh.morphTargetInfluences[0] = target.grip;
    const leg = character.legs[index];
    leg.upper.quaternion.fromArray(pose.legs[index].upper);
    leg.lower.quaternion.fromArray(pose.legs[index].lower);
    leg.boot.quaternion.fromArray(pose.legs[index].ankle);
  }
  return pose;
}

function copyPose(source, target) {
  for (const key of ["bodyPosition", "bodyQuaternion", "headQuaternion"]) {
    for (let component = 0; component < source[key].length; component += 1) target[key][component] = source[key][component];
  }
  for (let index = 0; index < 2; index += 1) {
    for (const key of ["upper", "lower", "wrist"]) {
      for (let component = 0; component < 4; component += 1) target.arms[index][key][component] = source.arms[index][key][component];
    }
    target.arms[index].grip = source.arms[index].grip;
    target.arms[index].pull = source.arms[index].pull;
    for (const key of ["upper", "lower", "ankle"]) {
      for (let component = 0; component < 4; component += 1) target.legs[index][key][component] = source.legs[index][key][component];
    }
  }
}

function blendQuaternion(from, target, amount) {
  rotation.fromArray(from).slerp(endRotation.fromArray(target), amount).toArray(target);
}

function blendTransition(pose, transition) {
  const amount = smooth(transition.time / transition.duration);
  const from = transition.from;
  blendQuaternion(from.headQuaternion, pose.headQuaternion, amount);
  for (let index = 0; index < 2; index += 1) {
    const arm = pose.arms[index];
    blendQuaternion(from.arms[index].upper, arm.upper, amount);
    blendQuaternion(from.arms[index].lower, arm.lower, amount);
    blendQuaternion(from.arms[index].wrist, arm.wrist, amount);
    arm.grip = mix(from.arms[index].grip, arm.grip, amount);
    arm.pull = mix(from.arms[index].pull, arm.pull, amount);
  }
  // Grounded legs always use the exact IK solution. Only liftoff can blend
  // lower-body transforms; knee recovery leads the drop into the harness.
  if (transition.kind === "liftoff") {
    for (let component = 0; component < 3; component += 1) {
      pose.bodyPosition[component] = mix(from.bodyPosition[component], pose.bodyPosition[component],
        component === 1 ? amount * amount : amount);
    }
    blendQuaternion(from.bodyQuaternion, pose.bodyQuaternion, amount);
    for (let index = 0; index < 2; index += 1) {
      blendQuaternion(from.legs[index].upper, pose.legs[index].upper, amount);
      blendQuaternion(from.legs[index].lower, pose.legs[index].lower, amount);
      blendQuaternion(from.legs[index].ankle, pose.legs[index].ankle, amount);
    }
  }
}

/** Runtime clock and impact event handling, shared by local and remote rigs. */
export function updateParachutistCharacter(character, input = {}) {
  const dt = clamp(finite(input.dt), 0, 0.1);
  const motion = character.motion ||= {
    time: 0, speed: finite(input.speed), steering: finite(input.steering), brake: finite(input.brake),
    state: input.state, landingId: input.landingId, landingImpact: 0, landingTime: -1,
    lastVerticalSpeed: finite(input.verticalSpeed), pose: createParachutistPose(), sample: {}, gait: {},
    transition: { time: -1, duration: 0.24, kind: "landing", from: createParachutistPose() },
  };
  const touchedDown = motion.state !== "grounded" && input.state === "grounded";
  const liftedOff = motion.state === "grounded" && input.state !== "grounded";
  const newImpact = input.landingId != null && input.landingId !== motion.landingId;
  if (touchedDown || liftedOff) {
    copyPose(motion.pose, motion.transition.from);
    motion.transition.time = 0;
    motion.transition.kind = touchedDown ? "landing" : "liftoff";
    motion.transition.duration = touchedDown ? 0.24 : 0.30;
    if (touchedDown) motion.speed = finite(input.speed);
  } else if (motion.transition.time >= 0) motion.transition.time += dt;
  if ((touchedDown || newImpact) && input.state === "grounded") {
    motion.landingTime = 0;
    motion.landingImpact = Math.max(0.5, finite(input.landingImpact,
      motion.lastVerticalSpeed < 0 ? -motion.lastVerticalSpeed : 1.35));
    character.phase = 0;
  } else if (motion.landingTime >= 0) motion.landingTime += dt;
  if (input.state !== "grounded") motion.landingTime = -1;
  motion.state = input.state;
  motion.landingId = input.landingId;
  if (Number.isFinite(input.verticalSpeed)) motion.lastVerticalSpeed = input.verticalSpeed;
  motion.time += dt;
  const follow = 1 - Math.exp(-dt * 13);
  motion.speed = mix(motion.speed, finite(input.speed), follow);
  motion.steering = mix(motion.steering, finite(input.steering), follow);
  motion.brake = mix(motion.brake, finite(input.brake), follow);
  if (input.state === "grounded" && (motion.landingTime < 0 || motion.landingTime > 0.40)) {
    character.phase = finite(character.phase) + dt * TAU * parachutistGait(motion.speed, motion.gait).cadence;
  }
  const sample = motion.sample;
  sample.state = input.state;
  sample.groundClearance = input.groundClearance;
  sample.verticalSpeed = input.verticalSpeed;
  sample.speed = motion.speed;
  sample.steering = motion.steering;
  sample.brake = motion.brake;
  sample.time = motion.time;
  sample.phase = finite(character.phase);
  sample.landingTime = motion.landingTime;
  sample.landingImpact = motion.landingImpact;
  sampleParachutistPose(motion.sample, motion.pose);
  if (motion.transition.time >= 0 && motion.transition.time < motion.transition.duration) {
    blendTransition(motion.pose, motion.transition);
  }
  applyParachutistPose(character, motion.pose);
  return motion.pose;
}
