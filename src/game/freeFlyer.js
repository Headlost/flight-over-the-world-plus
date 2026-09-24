import {
  AnimationMixer,
  Box3,
  CylinderGeometry,
  Group,
  LoopOnce,
  LoopRepeat,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from "three";

const R_EARTH = 6378137;
const FREE_FLYER_HEIGHT = 1.82;
export const FREE_FLYER_GROUND_CLEARANCE = 0.3;
export const FREE_FLYER_WALK_SPEED = 2.6;
export const FREE_FLYER_RUN_SPEED = 5.2;

const FREE_FLYER_CLIPS = Object.freeze({
  idle: "Idle",
  walk: "Walk",
  run: "Run",
  flight: "Flight",
  launching: "Takeoff",
  landing: "Land",
});

function namedMaterialEntries(root, objectPattern, materialPattern = objectPattern) {
  const entries = [];
  const seen = new Set();
  root.traverse((object) => {
    if (!object?.isMesh || !objectPattern.test(object.name || "")) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material?.color || seen.has(material)) continue;
      if (materialPattern && !materialPattern.test(material.name || object.name || "")) continue;
      seen.add(material);
      entries.push({ surface: material, color: material.color.getHex() });
    }
  });
  return entries;
}

function normalizeCivilianModel(pilot) {
  pilot.updateMatrixWorld(true);
  const box = new Box3().setFromObject(pilot);
  const size = box.getSize(new Vector3());
  if (Number.isFinite(size.y) && size.y > 0.01) pilot.scale.multiplyScalar(FREE_FLYER_HEIGHT / size.y);
  pilot.updateMatrixWorld(true);
  box.setFromObject(pilot);
  const center = box.getCenter(new Vector3());
  pilot.position.x -= center.x;
  pilot.position.y -= box.min.y;
  pilot.position.z -= center.z;
  pilot.updateMatrixWorld(true);
}

function actionForState(rig, state, speed) {
  if (state === "launching") return FREE_FLYER_CLIPS.launching;
  if (state === "landing") return FREE_FLYER_CLIPS.landing;
  if (state !== "grounded") return FREE_FLYER_CLIPS.flight;
  const pace = Math.abs(Number(speed) || 0);
  if (pace < 0.12) return FREE_FLYER_CLIPS.idle;
  return pace >= 4.2 ? FREE_FLYER_CLIPS.run : FREE_FLYER_CLIPS.walk;
}

function playFreeFlyerAction(rig, name) {
  if (!rig?.actions || rig.activeName === name) return;
  const next = rig.actions.get(name) || rig.actions.get(name.toLowerCase());
  if (!next) return;
  const previous = rig.activeAction;
  const oneShot = name === FREE_FLYER_CLIPS.launching || name === FREE_FLYER_CLIPS.landing;
  next.enabled = true;
  next.setEffectiveTimeScale(1);
  next.setEffectiveWeight(1);
  next.setLoop(oneShot ? LoopOnce : LoopRepeat, oneShot ? 1 : Infinity);
  next.clampWhenFinished = oneShot;
  next.reset().fadeIn(previous ? 0.18 : 0).play();
  if (previous && previous !== next) previous.fadeOut(0.18);
  rig.activeAction = next;
  rig.activeName = name;
}

/**
 * Converts the authored Blender GLB into the same runtime contract as the
 * procedural fallback. The fallback remains available when loading fails.
 */
export function buildFreeFlyerModel(gltf) {
  if (!gltf?.scene) throw new TypeError("Free-flight GLB has no scene");
  const root = new Group();
  root.name = "free-flyer-root";
  const pilot = gltf.scene;
  pilot.name ||= "civilian-free-flyer";
  normalizeCivilianModel(pilot);
  root.add(pilot);

  const mixer = new AnimationMixer(pilot);
  const actions = new Map();
  for (const clip of gltf.animations || []) {
    const action = mixer.clipAction(clip);
    actions.set(clip.name, action);
    actions.set(clip.name.toLowerCase(), action);
  }
  const roleSurfaces = namedMaterialEntries(pilot, /SHIRT_BLUE|shirt[_ -]?blue|overshirt/i, null);
  const rig = {
    pilot,
    mixer,
    actions,
    activeAction: null,
    activeName: "",
    animated: true,
    elapsed: 0,
    landingUntil: 0,
    lastLandingId: null,
    previousState: null,
    phase: 0,
    roleSurfaces,
  };
  root.userData.key = "freeflyer";
  root.userData.freeFlyer = rig;
  pilot.traverse((object) => {
    if (!object?.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  playFreeFlyerAction(rig, FREE_FLYER_CLIPS.flight);
  mixer.update(0);
  return root;
}

function segment(radiusTop, radiusBottom, length, material, radialSegments = 12) {
  const mesh = new Mesh(new CylinderGeometry(radiusTop, radiusBottom, length, radialSegments), material);
  mesh.castShadow = true;
  return mesh;
}

function joint(radius, material, detail = 12) {
  const mesh = new Mesh(new SphereGeometry(radius, detail, Math.max(8, Math.round(detail * 0.7))), material);
  mesh.castShadow = true;
  return mesh;
}

function buildArm(side, shirt, skin) {
  const upper = new Group();
  upper.position.set(side * 0.265, 1.36, 0);
  const sleeve = segment(0.072, 0.082, 0.31, shirt);
  sleeve.position.y = -0.155;
  upper.add(sleeve);
  const lower = new Group();
  lower.position.y = -0.31;
  const forearm = segment(0.052, 0.066, 0.34, skin);
  forearm.position.y = -0.17;
  const hand = joint(0.064, skin, 10);
  hand.scale.set(0.82, 1.12, 0.62);
  hand.position.y = -0.37;
  lower.add(forearm, hand);
  upper.add(lower);
  return { upper, lower, side };
}

function buildLeg(side, trousers, shoes) {
  const upper = new Group();
  upper.position.set(side * 0.105, 0.72, 0);
  const thigh = segment(0.086, 0.103, 0.48, trousers);
  thigh.position.y = -0.24;
  upper.add(thigh);
  const lower = new Group();
  lower.position.y = -0.48;
  const shin = segment(0.068, 0.082, 0.44, trousers);
  shin.position.y = -0.22;
  const shoe = joint(0.09, shoes, 10);
  shoe.scale.set(0.72, 0.48, 1.35);
  shoe.position.set(0, -0.46, -0.035);
  lower.add(shin, shoe);
  upper.add(lower);
  return { upper, lower, side };
}

/**
 * Lightweight articulated civilian used by the free-flight mode. The model is
 * intentionally code-native, so it is available in local and online builds
 * without an extra licensed character asset.
 */
export function createFreeFlyerModel() {
  const root = new Group();
  root.name = "free-flyer-root";
  const pilot = new Group();
  pilot.name = "civilian-free-flyer";

  const shirt = new MeshStandardMaterial({ color: 0x7fa9d8, roughness: 0.92 });
  shirt.name = "civilian-blue-overshirt";
  const shirtAccent = new MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.9 });
  shirtAccent.name = "civilian-white-tshirt";
  const trousers = new MeshStandardMaterial({ color: 0x704d35, roughness: 0.94 });
  const shoes = new MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.78 });
  const skin = new MeshStandardMaterial({ color: 0xb98263, roughness: 0.88 });
  const hair = new MeshStandardMaterial({ color: 0x33231b, roughness: 0.96 });

  const torso = segment(0.205, 0.16, 0.58, shirt, 18);
  torso.name = "civilian-shirt-torso";
  torso.position.y = 1.11;
  torso.scale.z = 0.68;
  const collar = segment(0.105, 0.145, 0.105, shirtAccent, 16);
  collar.position.set(0, 1.405, -0.01);
  collar.scale.z = 0.72;
  const hips = segment(0.145, 0.13, 0.24, trousers, 16);
  hips.position.y = 0.76;
  hips.scale.z = 0.72;
  const neck = segment(0.065, 0.069, 0.13, skin, 12);
  neck.position.y = 1.48;
  const head = joint(0.145, skin, 18);
  head.name = "civilian-head";
  head.position.set(0, 1.66, -0.012);
  head.scale.set(0.82, 1.08, 0.9);
  const hairCap = joint(0.147, hair, 16);
  hairCap.name = "civilian-hair";
  hairCap.position.set(0, 1.71, 0.012);
  hairCap.scale.set(0.84, 0.72, 0.92);
  const face = joint(0.112, skin, 16);
  face.name = "civilian-face";
  face.position.set(0, 1.64, -0.085);
  face.scale.set(0.72, 0.9, 0.35);

  const arms = [-1, 1].map(side => buildArm(side, shirt, skin));
  const legs = [-1, 1].map(side => buildLeg(side, trousers, shoes));
  pilot.add(torso, collar, hips, neck, head, hairCap, face);
  for (const arm of arms) pilot.add(arm.upper);
  for (const leg of legs) pilot.add(leg.upper);
  root.add(pilot);
  root.userData.key = "freeflyer";
  root.userData.freeFlyer = {
    pilot,
    torso,
    head,
    arms,
    legs,
    phase: 0,
    roleSurfaces: [{ surface: shirt, color: 0x7fa9d8 }],
  };
  updateFreeFlyerModel(root, "airborne", 0, 0, {});
  return root;
}

export function setFreeFlyerRole(root, role = "player") {
  const rig = root?.userData?.freeFlyer;
  if (!rig) return;
  const color = role === "admin" ? 0xd8a24a : role === "leader" ? 0xd83b36 : null;
  for (const entry of rig.roleSurfaces) {
    entry.surface.color.setHex(color ?? entry.color);
    entry.surface.needsUpdate = true;
  }
  root.userData.playerRole = color == null ? "player" : role;
}

export function setFreeFlyerFirstPerson(root, enabled) {
  const pilot = root?.userData?.freeFlyer?.pilot;
  if (pilot) pilot.visible = !enabled;
}

export function updateFreeFlyerModel(root, state, speed, dt, input = {}) {
  const rig = root?.userData?.freeFlyer;
  if (!rig) return;
  if (rig.animated) {
    const delta = Math.min(0.05, Math.max(0, Number(dt) || 0));
    rig.elapsed += delta;
    const landedByState = rig.previousState !== null
      && rig.previousState !== "grounded" && state === "grounded";
    rig.previousState = state;
    const landingId = Number(input.landingId);
    if (Number.isFinite(landingId)) {
      if (rig.lastLandingId === null) rig.lastLandingId = landingId;
      else if (landingId > rig.lastLandingId) {
        rig.lastLandingId = landingId;
        rig.landingUntil = rig.elapsed + (rig.actions.get(FREE_FLYER_CLIPS.landing)?.getClip()?.duration || 1);
      }
    }
    if (landedByState) {
      rig.landingUntil = rig.elapsed + (rig.actions.get(FREE_FLYER_CLIPS.landing)?.getClip()?.duration || 1);
    }
    const actionName = state === "grounded" && rig.elapsed < rig.landingUntil
      ? FREE_FLYER_CLIPS.landing
      : actionForState(rig, state, speed);
    playFreeFlyerAction(rig, actionName);
    if (rig.activeAction) {
      const pace = Math.abs(Number(speed) || 0);
      const playback = actionName === FREE_FLYER_CLIPS.walk
        ? MathUtils.clamp(pace / FREE_FLYER_WALK_SPEED, 0.65, 1.45)
        : actionName === FREE_FLYER_CLIPS.run
          ? MathUtils.clamp(pace / FREE_FLYER_RUN_SPEED, 0.75, 1.4)
          : 1;
      rig.activeAction.setEffectiveTimeScale(playback);
    }
    rig.mixer.update(delta);
    return;
  }
  const grounded = state === "grounded";
  const running = grounded ? MathUtils.clamp((Math.abs(speed) - FREE_FLYER_WALK_SPEED) / 2.2, 0, 1) : 0;
  const moving = grounded && Math.abs(speed) > 0.12;
  if (moving) rig.phase += Math.min(0.05, Math.max(0, dt)) * (7.2 + running * 4.2) * Math.sign(speed || 1);
  const gait = moving ? Math.sin(rig.phase) : 0;
  const response = 1 - Math.exp(-10 * Math.max(0, dt));
  const lean = MathUtils.clamp(Number(input.pitch) || 0, -1.45, 1.45);
  rig.torso.rotation.x += ((grounded ? 0 : -0.08 - lean * 0.08) - rig.torso.rotation.x) * response;
  rig.head.rotation.x += ((grounded ? 0 : 0.08 + lean * 0.06) - rig.head.rotation.x) * response;
  rig.arms.forEach((arm, index) => {
    const opposite = index === 0 ? -1 : 1;
    const upperTarget = grounded ? gait * opposite * (0.48 + running * 0.2) : Math.PI * 0.5 - 0.12;
    const lowerTarget = grounded ? -Math.max(0, -gait * opposite) * 0.36 : -0.08;
    arm.upper.rotation.x += (upperTarget - arm.upper.rotation.x) * response;
    arm.upper.rotation.z += ((grounded ? 0 : -arm.side * 0.1) - arm.upper.rotation.z) * response;
    arm.lower.rotation.x += (lowerTarget - arm.lower.rotation.x) * response;
  });
  rig.legs.forEach((leg, index) => {
    const opposite = index === 0 ? -1 : 1;
    const upperTarget = grounded ? -gait * opposite * (0.58 + running * 0.18) : -0.34 + opposite * 0.035;
    const kneeTarget = grounded ? Math.max(0, gait * opposite) * (0.48 + running * 0.3) : 0.18;
    leg.upper.rotation.x += (upperTarget - leg.upper.rotation.x) * response;
    leg.lower.rotation.x += (kneeTarget - leg.lower.rotation.x) * response;
  });
}

function advance(controller, distance) {
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-9) return;
  const arc = distance / R_EARTH;
  const oldLat = controller.lat;
  const nextLat = Math.asin(MathUtils.clamp(
    Math.sin(oldLat) * Math.cos(arc) + Math.cos(oldLat) * Math.sin(arc) * Math.cos(controller.heading),
    -1,
    1,
  ));
  const dLon = Math.atan2(
    Math.sin(controller.heading) * Math.sin(arc) * Math.cos(oldLat),
    Math.cos(arc) - Math.sin(oldLat) * Math.sin(nextLat),
  );
  controller.lat = nextLat;
  controller.lon = MathUtils.euclideanModulo(controller.lon + dLon + Math.PI, Math.PI * 2) - Math.PI;
}

export class FreeFlyerController {
  constructor(latDeg, lonDeg, height, headingDeg = 0) {
    this.lat = latDeg * MathUtils.DEG2RAD;
    this.lon = lonDeg * MathUtils.DEG2RAD;
    this.height = height;
    this.heading = headingDeg * MathUtils.DEG2RAD;
    this.pitch = 0;
    this.roll = 0;
    this.cruise = 34;
    this.boost = 78;
    this.brake = 5;
    this.speed = this.cruise;
    this.throttle = (this.cruise - this.brake) / (this.boost - this.brake);
    this.verticalSpeed = 0;
    this.state = "airborne";
    this.groundHeight = null;
    this.groundClearance = Infinity;
    this.launchTarget = null;
    this.launchMode = null;
    this.previousGroundPose = null;
    this.landingId = 0;
    this.landingImpact = 0;
    this.crashed = false;
  }

  update(dt, ctrl = {}) {
    if (!Number.isFinite(dt) || dt <= 0 || this.crashed) return;
    dt = Math.min(dt, 0.05);
    const rollInput = MathUtils.clamp(Number(ctrl.roll) || 0, -1, 1);
    const pitchInput = MathUtils.clamp(Number(ctrl.pitch) || 0, -1, 1);
    const yawInput = MathUtils.clamp(Number(ctrl.yaw) || 0, -1, 1);
    const throttleInput = MathUtils.clamp(Number(ctrl.throttle) || 0, -1, 1);
    if (this.state === "grounded") {
      this.previousGroundPose = { lat: this.lat, lon: this.lon, height: this.height };
      this.heading = MathUtils.euclideanModulo(this.heading + rollInput * 1.95 * dt, Math.PI * 2);
      const direction = -pitchInput;
      const pace = direction > 0 && throttleInput > 0.5 ? FREE_FLYER_RUN_SPEED : FREE_FLYER_WALK_SPEED;
      const target = direction * pace;
      this.speed += (target - this.speed) * (1 - Math.exp(-12 * dt));
      if (Math.abs(direction) < 0.02) this.speed *= Math.exp(-14 * dt);
      advance(this, this.speed * dt);
      this.pitch = 0;
      this.roll = 0;
      this.verticalSpeed = 0;
      return;
    }
    if (this.state === "launching") {
      this.heading = MathUtils.euclideanModulo(this.heading + (rollInput * 0.55 + yawInput * 0.8) * dt, Math.PI * 2);
      this.speed += (12 - this.speed) * (1 - Math.exp(-3.5 * dt));
      this.verticalSpeed += (8.5 - this.verticalSpeed) * (1 - Math.exp(-4.2 * dt));
      this.height += this.verticalSpeed * dt;
      advance(this, this.speed * 0.32 * dt);
      this.pitch += (0.82 - this.pitch) * (1 - Math.exp(-3.6 * dt));
      if (this.launchTarget != null && this.height >= this.launchTarget) {
        this.state = "airborne";
        this.launchTarget = null;
        this.launchMode = null;
      }
      return;
    }

    const targetRoll = -rollInput * 0.92;
    const targetPitch = pitchInput * 1.42;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-5.5 * dt));
    this.pitch += (targetPitch - this.pitch) * (1 - Math.exp(-3.2 * dt));
    const cruiseT = (this.cruise - this.brake) / (this.boost - this.brake);
    const heldThrottle = throttleInput > 0 ? 1 : throttleInput < 0 ? 0 : cruiseT;
    this.throttle += (heldThrottle - this.throttle) * (1 - Math.exp(-(throttleInput ? 1.3 : 2.1) * dt));
    const targetSpeed = this.brake + this.throttle * (this.boost - this.brake);
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-2.4 * dt));
    this.speed = MathUtils.clamp(this.speed, this.brake, this.boost);
    const bankTurn = -Math.sign(this.roll) * Math.abs(Math.sin(this.roll)) * (0.72 + this.speed / this.boost * 0.4);
    this.heading = MathUtils.euclideanModulo(this.heading + (bankTurn + yawInput * 1.35) * dt, Math.PI * 2);
    const horizontalSpeed = Math.cos(this.pitch) * this.speed;
    this.verticalSpeed = Math.sin(this.pitch) * this.speed;
    this.height += this.verticalSpeed * dt;
    advance(this, horizontalSpeed * dt);
  }

  land(surfaceHeight) {
    if (!Number.isFinite(surfaceHeight)) return false;
    if (this.state !== "grounded") {
      this.landingId += 1;
      this.landingImpact = MathUtils.clamp(-this.verticalSpeed, 0, 30);
    }
    this.state = "grounded";
    this.height = surfaceHeight + FREE_FLYER_GROUND_CLEARANCE;
    this.groundHeight = surfaceHeight;
    this.groundClearance = 0;
    this.launchTarget = null;
    this.launchMode = null;
    this.speed = 0;
    this.verticalSpeed = 0;
    this.pitch = 0;
    this.roll = 0;
    return true;
  }

  takeOff(surfaceHeight = this.groundHeight ?? this.height) {
    if (this.state !== "grounded") return false;
    this.state = "launching";
    this.groundHeight = surfaceHeight;
    this.groundClearance = Infinity;
    this.launchMode = "free";
    this.launchTarget = surfaceHeight + 12;
    this.speed = 4;
    this.verticalSpeed = 2.5;
    return true;
  }

  settleOnSurface(surfaceHeight) {
    if (this.state !== "grounded" || !Number.isFinite(surfaceHeight)) return;
    const targetHeight = surfaceHeight + FREE_FLYER_GROUND_CLEARANCE;
    const delta = targetHeight - this.height;
    if (delta < -1.5 && Math.abs(this.speed) > 0.2) {
      this.state = "airborne";
      this.verticalSpeed = -0.7;
      this.groundHeight = null;
      this.groundClearance = Infinity;
      return;
    }
    if (delta > 0.9 && Math.abs(this.speed) > 0.2) {
      if (this.previousGroundPose) {
        this.lat = this.previousGroundPose.lat;
        this.lon = this.previousGroundPose.lon;
      }
      this.speed = 0;
      return;
    }
    this.height = targetHeight;
    this.groundHeight = surfaceHeight;
  }

  setGroundClearance(clearance) {
    if (Number.isFinite(clearance)) this.groundClearance = Math.max(0, clearance);
  }

  get latDeg() { return this.lat * MathUtils.RAD2DEG; }
  get lonDeg() { return this.lon * MathUtils.RAD2DEG; }
  get headingDeg() { return MathUtils.euclideanModulo(this.heading * MathUtils.RAD2DEG, 360); }
  get kmh() { return Math.abs(this.speed) * 3.6; }
}
