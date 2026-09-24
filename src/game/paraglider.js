import { Group, MathUtils } from 'three';
import { createParachutistCharacter } from './parachutistCharacter.js';
import { createParachutistCanopy, updateParachutistSuspension } from './parachutistCanopy.js';
import { updateParachutistCharacter } from './parachutistMotion.js';
import { attachParachutistSkin, syncParachutistSkin } from './parachutistSkin.js';

const R_EARTH = 6378137;
export const PARACHUTIST_WALK_SPEED = 2.5;
export const PARACHUTIST_RUN_SPEED = 6.2;
export const PARACHUTIST_GROUND_CLEARANCE = 0.32;
const GROUND_CLEARANCE = PARACHUTIST_GROUND_CLEARANCE;
const GENTLE_LAUNCH_HEIGHT = 12;
const ROCKET_LAUNCH_HEIGHT = 80;
const GENTLE_CLIMB_SPEED = 1.7;
const NORMAL_DESCENT_BELOW = 60;
const FAST_DESCENT_ABOVE = 120;
export const PARACHUTIST_ROLE_COLORS = Object.freeze({
  admin: 0xd8a24a,
  leader: 0xd83b36,
});

export function parachutistDescentScale(groundClearance) {
  if (!Number.isFinite(groundClearance)) return 1.5;
  const t = MathUtils.clamp(
    (groundClearance - NORMAL_DESCENT_BELOW) / (FAST_DESCENT_ABOVE - NORMAL_DESCENT_BELOW),
    0,
    1,
  );
  const smooth = t * t * (3 - 2 * t);
  return 1 + smooth * 0.5;
}

export function createParachutistModel() {
  const root = new Group();
  const character = createParachutistCharacter();
  const canopy = createParachutistCanopy(character);
  root.add(character.pilot, canopy);
  root.userData.parachutist = { canopy, character, active: "airborne" };
  root.userData.key = "parachutist";
  setParachutistState(root, "airborne", 0, true);
  return root;
}

export function buildParachutistModel(gltf) {
  const root = createParachutistModel();
  attachParachutistSkin(root.userData.parachutist.character, gltf.scene);
  syncParachutistSkin(root.userData.parachutist.character);
  return root;
}

export function setParachutistRole(root, role = "player") {
  const character = root?.userData?.parachutist?.character;
  if (!character?.roleSurfaces) return null;
  const roleColor = PARACHUTIST_ROLE_COLORS[role] ?? null;
  for (const entry of character.roleSurfaces) {
    if (roleColor == null) {
      entry.surface.color.setHex(entry.color);
      entry.surface.emissive.setHex(entry.emissive);
      entry.surface.emissiveIntensity = entry.emissiveIntensity;
    } else {
      entry.surface.color.setHex(roleColor);
      entry.surface.emissive.setHex(roleColor);
      entry.surface.emissiveIntensity = 0.08;
    }
    entry.surface.needsUpdate = true;
  }
  root.userData.playerRole = roleColor == null ? "player" : role;
  return roleColor;
}

export function setParachutistState(root, state, speed = 0) {
  const rig = root?.userData?.parachutist;
  if (!rig) return;
  rig.canopy.visible = state !== "grounded";
  rig.active = state === "grounded"
    ? Math.abs(speed) > 3.2 ? "run" : Math.abs(speed) > 0.15 ? "walk" : "idle"
    : "airborne";
}

export function updateParachutistModel(root, state, speed, dt, input = {}) {
  const rig = root?.userData?.parachutist;
  if (!rig) return;
  setParachutistState(root, state, speed);
  rig.pose = updateParachutistCharacter(rig.character, { ...input, state, speed, dt });
  syncParachutistSkin(rig.character);
  if (rig.canopy.visible) updateParachutistSuspension(rig.canopy);
}

export function setParachutistFirstPerson(root, enabled) {
  const rig = root?.userData?.parachutist;
  if (rig?.character?.pilot) rig.character.pilot.visible = !enabled;
}

function advance(controller, distance) {
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

export class ParachutistController {
  constructor(latDeg, lonDeg, height, headingDeg = 0) {
    this.lat = latDeg * MathUtils.DEG2RAD;
    this.lon = lonDeg * MathUtils.DEG2RAD;
    this.height = height;
    this.heading = headingDeg * MathUtils.DEG2RAD;
    this.pitch = -0.08;
    this.roll = 0;
    this.cruise = 10.5;
    this.boost = 15.3;
    this.brake = 6.7;
    this.speed = this.cruise;
    this.throttle = 0.5;
    this.verticalSpeed = -1.35;
    this.landingId = 0;
    this.landingImpact = 0;
    this.state = "airborne";
    this.groundHeight = null;
    this.groundClearance = Infinity;
    this.launchTarget = null;
    this.launchMode = null;
    this.previousGroundPose = null;
    this.crashed = false;
  }

  update(dt, ctrl) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    if (this.state === "grounded") {
      this.previousGroundPose = { lat: this.lat, lon: this.lon, height: this.height };
      this.heading = MathUtils.euclideanModulo(this.heading + ctrl.roll * 1.9 * dt, Math.PI * 2);
      const direction = MathUtils.clamp(-ctrl.pitch, -1, 1);
      // Shift (the touch Faster button) runs forward. Backward movement keeps
      // the precise walking pace used on roofs and narrow ledges.
      const gaitSpeed = direction > 0 && ctrl.throttle > 0.5
        ? PARACHUTIST_RUN_SPEED : PARACHUTIST_WALK_SPEED;
      const target = direction * gaitSpeed;
      const groundSpeedResponse = target > this.speed ? 12 * 1.5 : 12;
      this.speed += (target - this.speed) * (1 - Math.exp(-groundSpeedResponse * dt));
      if (Math.abs(direction) < 0.02) this.speed *= Math.exp(-14 * dt);
      advance(this, this.speed * dt);
      this.pitch = 0;
      this.roll = 0;
      this.verticalSpeed = 0;
      return;
    }

    if (this.state === "launching") {
      this.heading = MathUtils.euclideanModulo(this.heading + ctrl.roll * 0.65 * dt, Math.PI * 2);
      const rocket = this.launchMode === "rocket";
      const descend = Math.max(0, MathUtils.clamp(ctrl.pitch, -1, 1));
      const climb = Math.max(0, -MathUtils.clamp(ctrl.pitch, -1, 1));
      const cameraClimb = MathUtils.clamp(ctrl.cameraClimb || 0, 0, 1);
      const targetSpeed = rocket ? 8.5 : 6.2;
      // Space gives a low, controllable hop. S can cancel it immediately and
      // hand control back to normal canopy flight for a nearby landing.
      const targetVertical = rocket ? 7 : 2.25 + climb * 0.9 + cameraClimb * 1.35 - descend * 4.2;
      this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-2.5 * dt));
      this.verticalSpeed += (targetVertical - this.verticalSpeed) * (1 - Math.exp(-(rocket ? 2 : 4) * dt));
      this.height += this.verticalSpeed * dt;
      advance(this, this.speed * dt);
      this.pitch = Math.atan2(this.verticalSpeed, Math.max(0.1, this.speed));
      this.roll += (-ctrl.roll * 0.3 - this.roll) * (1 - Math.exp(-4 * dt));
      if (!rocket && descend > 0.2) {
        this.state = "airborne";
        this.launchMode = null;
        return;
      }
      if (this.launchTarget != null && this.height >= this.launchTarget) {
        this.state = "airborne";
        this.verticalSpeed = -1.2;
        this.pitch = -0.08;
        this.launchMode = null;
      }
      return;
    }

    const pitchInput = MathUtils.clamp(ctrl.pitch, -1, 1);
    const descend = Math.max(0, pitchInput);
    const climb = Math.max(0, -pitchInput);
    const cameraClimb = MathUtils.clamp(ctrl.cameraClimb || 0, 0, 1);
    // Preserve the smooth horizontal speed curve. S brakes while adding sink,
    // and W uses the faster trim response during a gentle powered climb.
    const speedInput = ctrl.throttle !== 0 ? ctrl.throttle : -pitchInput;
    const targetSpeed = speedInput > 0.05 ? this.cruise + (this.boost - this.cruise) * speedInput
      : speedInput < -0.05 ? this.cruise + (this.cruise - this.brake) * speedInput
      : this.cruise;
    const airSpeedResponse = targetSpeed > this.speed ? 2.4 * 1.5 : 2.4;
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-airSpeedResponse * dt));
    this.speed = MathUtils.clamp(this.speed, this.brake, this.boost);
    const targetRoll = -ctrl.roll * 0.68;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-3.8 * dt));
    this.heading = MathUtils.euclideanModulo(this.heading - Math.tan(this.roll) * 0.58 * dt, Math.PI * 2);
    const fast = Math.max(0, (this.speed - this.cruise) / (this.boost - this.cruise));
    const flare = Math.max(0, (this.cruise - this.speed) / (this.cruise - this.brake));
    const descentScale = parachutistDescentScale(this.groundClearance);
    let targetVertical = -(1.2 + fast * fast * 2.25 - flare * 0.18 + Math.abs(this.roll) * 0.35 + descend * 2.25) * descentScale;
    // W provides a restrained climb for as long as it is held. Releasing it
    // smoothly restores the natural canopy sink instead of launching upward.
    const climbCommand = Math.max(climb, cameraClimb);
    if (climbCommand > 0) {
      const assistedClimbSpeed = GENTLE_CLIMB_SPEED + cameraClimb * 1.1;
      targetVertical += (assistedClimbSpeed - targetVertical) * climbCommand;
    }
    if (this.groundClearance < 6) targetVertical = Math.max(targetVertical, -0.45 - this.groundClearance * 0.12);
    const verticalResponse = descend > 0 ? 3.3 : climbCommand > 0 ? 2.8 : 2.5;
    this.verticalSpeed += (targetVertical - this.verticalSpeed) * (1 - Math.exp(-verticalResponse * dt));
    this.height += this.verticalSpeed * dt;
    this.pitch += (Math.atan2(this.verticalSpeed, this.speed) - this.pitch) * (1 - Math.exp(-3 * dt));
    advance(this, this.speed * dt);
  }

  land(surfaceHeight) {
    if (!Number.isFinite(surfaceHeight)) return;
    // Capture the collision before stopping the controller. Surface/LOD
    // corrections while already grounded must not replay the impact.
    if (this.state !== "grounded") {
      this.landingId += 1;
      this.landingImpact = MathUtils.clamp(Number.isFinite(this.verticalSpeed) ? -this.verticalSpeed : 0, 0, 20);
    }
    this.state = "grounded";
    this.height = surfaceHeight + GROUND_CLEARANCE;
    this.groundHeight = surfaceHeight;
    this.groundClearance = 0;
    this.launchTarget = null;
    this.launchMode = null;
    this.speed = 0;
    this.verticalSpeed = 0;
    this.pitch = 0;
    this.roll = 0;
  }

  takeOff(surfaceHeight = this.groundHeight ?? this.height, mode = "gentle") {
    if (this.state !== "grounded") return false;
    this.state = "launching";
    this.groundHeight = surfaceHeight;
    this.launchMode = mode === "rocket" ? "rocket" : "gentle";
    this.launchTarget = surfaceHeight + (this.launchMode === "rocket" ? ROCKET_LAUNCH_HEIGHT : GENTLE_LAUNCH_HEIGHT);
    this.groundClearance = Infinity;
    this.speed = this.launchMode === "rocket" ? 4 : 3.2;
    this.verticalSpeed = this.launchMode === "rocket" ? 2.5 : 1.2;
    return true;
  }

  settleOnSurface(surfaceHeight) {
    if (this.state !== "grounded" || !Number.isFinite(surfaceHeight)) return;
    const targetHeight = surfaceHeight + GROUND_CLEARANCE;
    const delta = targetHeight - this.height;
    const moving = Math.abs(this.speed) > 0.2;
    if (delta < -1.5 && moving) {
      this.state = "airborne";
      this.verticalSpeed = -0.8;
      this.speed = Math.max(this.speed, this.brake);
      return;
    }
    if (delta > 0.9 && moving) {
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
