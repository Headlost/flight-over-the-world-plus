import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  TorusGeometry,
  Vector3,
} from "three";
import { createRelativisticBlackHole } from "./black-hole.js";

// Distances and radii are deliberately compressed into a playable scale. The
// names, order and appearance remain recognisable while a trip takes seconds,
// rather than months or years.
export const SPACE_BODIES = Object.freeze([
  { name: "Sun",     radius: 330, position: [0, 0, 0],           kind: "sun",       color: "#ffbd45", hazard: "heat" },
  { name: "Mercury", radius: 24,  position: [812, 18, 251],      kind: "rock",      color: "#aaa49a", landing: true },
  { name: "Venus",   radius: 51,  position: [-1162, -30, 871],   kind: "venus",     color: "#d6a55f", atmosphere: "#dca85f", landing: true },
  { name: "Earth",   radius: 60,  position: [2500, 0, 0],        kind: "earth",     color: "#246fc2", atmosphere: "#5fb9ff", landing: true },
  { name: "Moon",    radius: 17,  position: [2840, 34, -82],     kind: "moon",      color: "#aaa9a4", parent: "Earth", landing: true },
  { name: "Mars",    radius: 42,  position: [2754, 54, 2320],    kind: "mars",      color: "#b74d2c", atmosphere: "#d36a45", landing: true },
  { name: "Jupiter", radius: 142, position: [5880, -76, -1192],  kind: "jupiter",   color: "#d0a77c", atmosphere: "#d9ad7b", gasGiant: true },
  { name: "Saturn",  radius: 119, position: [7387, 92, 3567],    kind: "saturn",    color: "#d8bd7b", atmosphere: "#e3c986", rings: true, gasGiant: true },
  { name: "Uranus",  radius: 78,  position: [9671, -140, -4089], kind: "ice",       color: "#75d9df", atmosphere: "#91edf0", rings: true, gasGiant: true },
  { name: "Neptune", radius: 76,  position: [12593, 130, 2291],  kind: "ice",       color: "#2e65d2", atmosphere: "#4a87ff", gasGiant: true },
  {
    name: "Galactic Core",
    radius: 96,
    position: [26000, 1200, -19000],
    kind: "blackhole",
    color: "#000000",
    hazard: "blackhole",
    diskOuter: 690,
    gravityRange: 9000,
    musicRange: 14000,
  },
]);

const REAL_TEXTURES = Object.freeze({
  Sun: "sun.jpg",
  Mercury: "mercury.jpg",
  Venus: "venus.jpg",
  Earth: "earth.jpg",
  Moon: "moon.jpg",
  Mars: "mars.jpg",
  Jupiter: "jupiter.jpg",
  Saturn: "saturn.jpg",
  Uranus: "uranus.jpg",
  Neptune: "neptune.jpg",
});

const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);
const scratchQ = new Quaternion();
const scratchV = new Vector3();
const scratchGravity = new Vector3();
const scratchVelocity = new Vector3();
const surfaceUp = new Vector3();
const surfaceRight = new Vector3();
const surfaceTangent = new Vector3();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class SpaceFlightController {
  constructor(bodies = SPACE_BODIES) {
    this.bodies = new Map(bodies.map((body) => [body.name, {
      ...body,
      position: new Vector3(...body.position),
    }]));
    this.position = new Vector3();
    this.forward = new Vector3(0, 0, -1);
    this.speed = 0;
    // Orbital flight is intentionally calmer than the atmospheric launch.
    // Keep every manual space-flight speed at 80% of the previous profile.
    this.cruiseSpeed = 73.6;
    this.precisionSpeed = 22.4;
    this.hyperSpeed = 1160;
    this.targetName = "Moon";
    this.autopilot = false;
    this.orbitBody = null;
    this.orbitRadius = 0;
    this.orbitAngle = 0;
    this.surfaceBody = null;
    this.surfaceClearance = 0;
    this.hyperdrive = false;
    this.gravityIntensity = 0;
    this.gravityTrapped = false;
  }

  reset() {
    this.position.set(0, 0, 0);
    this.forward.set(0, 0, -1);
    this.speed = 0;
    this.targetName = "Moon";
    this.autopilot = false;
    this.orbitBody = null;
    this.orbitRadius = 0;
    this.orbitAngle = 0;
    this.surfaceBody = null;
    this.surfaceClearance = 0;
    this.hyperdrive = false;
    this.gravityIntensity = 0;
    this.gravityTrapped = false;
  }

  enterOrbit(name = "Earth", clearance = 34) {
    const body = this.bodies.get(name);
    if (!body) return false;
    this.orbitBody = name;
    this.surfaceBody = null;
    this.orbitRadius = body.radius + Math.max(8, clearance);
    this.orbitAngle = 0;
    this.position.copy(body.position).add(new Vector3(this.orbitRadius, 0, 0));
    this.forward.set(0, 0, -1);
    this.speed = Math.max(46, this.orbitRadius * 0.42);
    this.autopilot = false;
    return true;
  }

  setTarget(name, engageCourse = true) {
    if (!this.bodies.has(name)) return false;
    this.targetName = name;
    this.autopilot = engageCourse;
    this.orbitBody = null;
    this.surfaceBody = null;
    if (engageCourse) {
      this.forward.copy(this.bodies.get(name).position).sub(this.position);
      if (this.forward.lengthSq() < 1e-5) this.forward.set(0, 0, -1);
      else this.forward.normalize();
    }
    return true;
  }

  targetDistance() {
    const body = this.bodies.get(this.targetName);
    return body ? Math.max(0, this.position.distanceTo(body.position) - body.radius) : Infinity;
  }

  nearestBody() {
    let nearest = null;
    let distance = Infinity;
    for (const body of this.bodies.values()) {
      const surfaceDistance = Math.max(0, this.position.distanceTo(body.position) - body.radius);
      if (surfaceDistance < distance) {
        nearest = body;
        distance = surfaceDistance;
      }
    }
    return nearest ? { body: nearest, distance } : null;
  }

  applyGravity(name, dt) {
    const body = this.bodies.get(name);
    if (!body || !Number.isFinite(dt) || dt <= 0) {
      this.gravityIntensity = 0;
      this.gravityTrapped = false;
      return null;
    }
    dt = Math.min(dt, 0.05);
    const toCenter = scratchGravity.copy(body.position).sub(this.position);
    const centerDistance = Math.max(1e-5, toCenter.length());
    const surfaceDistance = centerDistance - body.radius;
    const range = body.gravityRange || 7200;
    const intensity = clamp(1 - Math.max(0, surfaceDistance) / range, 0, 1);
    const relativeY = this.position.y - body.position.y;
    const planarDistance = Math.hypot(
      this.position.x - body.position.x,
      this.position.z - body.position.z,
    );
    const trapped = planarDistance <= (body.diskOuter || body.radius * 7.2)
      && Math.abs(relativeY) <= body.radius * 2.25;
    this.gravityIntensity = intensity;
    this.gravityTrapped = trapped;
    if (intensity <= 0) return { centerDistance, surfaceDistance, intensity, trapped };

    toCenter.multiplyScalar(1 / centerDistance);
    const acceleration = (12 + Math.pow(intensity, 1.72) * 500) * (trapped ? 2.5 : 1);
    scratchVelocity.copy(this.forward).multiplyScalar(this.speed).addScaledVector(toCenter, acceleration * dt);
    this.speed = clamp(scratchVelocity.length(), 0, this.hyperSpeed * 1.35);
    if (this.speed > 1e-4) this.forward.copy(scratchVelocity).multiplyScalar(1 / this.speed);
    else this.forward.copy(toCenter);
    if (trapped) this.hyperdrive = false;
    return { centerDistance, surfaceDistance, intensity, trapped };
  }

  toggleNearestOrbit(maxSurfaceDistance = 260) {
    if (this.surfaceBody) {
      const body = this.surfaceBody;
      this.surfaceBody = null;
      return this.enterOrbit(body, 20);
    }
    if (this.orbitBody) {
      this.orbitBody = null;
      return false;
    }
    const nearest = this.nearestBody();
    if (!nearest || nearest.body.hazard || nearest.distance > maxSurfaceDistance) return false;
    const radial = scratchV.copy(this.position).sub(nearest.body.position);
    if (radial.lengthSq() < 1e-5) radial.set(1, 0, 0);
    this.orbitRadius = Math.max(nearest.body.radius + 15, radial.length());
    radial.y = 0;
    if (radial.lengthSq() < 1e-5) radial.set(this.orbitRadius, 0, 0);
    this.orbitAngle = Math.atan2(-radial.z, radial.x);
    this.orbitBody = nearest.body.name;
    this.autopilot = false;
    return true;
  }

  enterSurfaceFlight(name, clearance = 3.2) {
    const body = this.bodies.get(name);
    if (!body || body.hazard || body.gasGiant || !body.landing || name === "Earth") return false;
    const radial = surfaceUp.copy(this.position).sub(body.position);
    if (radial.lengthSq() < 1e-5) radial.set(1, 0, 0);
    radial.normalize();
    this.surfaceClearance = Math.max(1.8, clearance);
    this.position.copy(body.position).addScaledVector(radial, body.radius + this.surfaceClearance);
    surfaceTangent.copy(this.forward).addScaledVector(radial, -this.forward.dot(radial));
    if (surfaceTangent.lengthSq() < 1e-5) {
      surfaceTangent.crossVectors(radial, Math.abs(radial.y) < 0.9 ? UP : RIGHT);
    }
    this.forward.copy(surfaceTangent).normalize();
    this.surfaceBody = name;
    this.orbitBody = null;
    this.autopilot = false;
    this.hyperdrive = false;
    this.speed = 8;
    return true;
  }

  updateSurfaceFlight(dt, controls) {
    const body = this.bodies.get(this.surfaceBody);
    if (!body) {
      this.surfaceBody = null;
      return;
    }
    surfaceUp.copy(this.position).sub(body.position);
    if (surfaceUp.lengthSq() < 1e-5) surfaceUp.set(1, 0, 0);
    surfaceUp.normalize();

    const yaw = -(controls.roll || 0) * 1.35 * dt;
    if (Math.abs(yaw) > 1e-5) {
      scratchQ.setFromAxisAngle(surfaceUp, yaw);
      this.forward.applyQuaternion(scratchQ).normalize();
    }
    surfaceRight.crossVectors(this.forward, surfaceUp);
    if (surfaceRight.lengthSq() < 1e-5) surfaceRight.copy(RIGHT);
    else surfaceRight.normalize();
    const pitch = -(controls.pitch || 0) * 0.78 * dt;
    if (Math.abs(pitch) > 1e-5) {
      scratchQ.setFromAxisAngle(surfaceRight, pitch);
      this.forward.applyQuaternion(scratchQ).normalize();
    } else {
      const vertical = this.forward.dot(surfaceUp);
      this.forward.addScaledVector(surfaceUp, -vertical * Math.min(1, 1.8 * dt)).normalize();
    }

    const targetSpeed = controls.throttle > 0 ? 16 : controls.throttle < 0 ? 4.5 : 8.5;
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-2.7 * dt));
    this.position.addScaledVector(this.forward, this.speed * dt);

    surfaceUp.copy(this.position).sub(body.position);
    const radius = Math.max(1e-5, surfaceUp.length());
    const altitude = radius - body.radius;
    surfaceUp.multiplyScalar(1 / radius);
    const minAltitude = this.surfaceClearance;
    const maxAltitude = this.surfaceClearance + Math.max(8, body.radius * 0.22);
    if (altitude < minAltitude || altitude > maxAltitude) {
      const clampedAltitude = clamp(altitude, minAltitude, maxAltitude);
      this.position.copy(body.position).addScaledVector(surfaceUp, body.radius + clampedAltitude);
      const vertical = this.forward.dot(surfaceUp);
      if ((altitude < minAltitude && vertical < 0) || (altitude > maxAltitude && vertical > 0)) {
        this.forward.addScaledVector(surfaceUp, -vertical).normalize();
      }
    }
  }

  update(dt, controls = { roll: 0, pitch: 0, throttle: 0 }) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    if (this.surfaceBody) {
      this.hyperdrive = false;
      this.updateSurfaceFlight(dt, controls);
      return;
    }
    const manual = Math.abs(controls.roll || 0) + Math.abs(controls.pitch || 0) > 0.08;
    this.hyperdrive = controls.throttle > 0;
    if (manual || this.hyperdrive) {
      this.orbitBody = null;
      if (manual) this.autopilot = false;
    }

    if (this.orbitBody) {
      const body = this.bodies.get(this.orbitBody);
      if (body) {
        const angularSpeed = clamp(25 / this.orbitRadius, 0.055, 0.28);
        this.orbitAngle += angularSpeed * dt;
        this.position.set(
          body.position.x + Math.cos(this.orbitAngle) * this.orbitRadius,
          body.position.y,
          body.position.z - Math.sin(this.orbitAngle) * this.orbitRadius,
        );
        this.forward.set(-Math.sin(this.orbitAngle), 0, -Math.cos(this.orbitAngle)).normalize();
        this.speed = angularSpeed * this.orbitRadius;
        return;
      }
      this.orbitBody = null;
    }

    if (this.autopilot) {
      const target = this.bodies.get(this.targetName);
      if (target) {
        const desired = scratchV.copy(target.position).sub(this.position).normalize();
        this.forward.lerp(desired, 1 - Math.exp(-2.3 * dt)).normalize();
      }
    }

    if (manual) {
      // At interplanetary speeds even a small angular change produces a very
      // large sideways jump. Keep cruise steering deliberate and make
      // hyperdrive substantially calmer without taking control away.
      const turnScale = this.hyperdrive ? 0.34 : controls.throttle < 0 ? 0.55 : 0.72;
      scratchQ.setFromAxisAngle(UP, -(controls.roll || 0) * 1.28 * turnScale * dt);
      this.forward.applyQuaternion(scratchQ);
      const right = scratchV.crossVectors(this.forward, UP);
      if (right.lengthSq() < 1e-5) right.copy(RIGHT);
      else right.normalize();
      scratchQ.setFromAxisAngle(right, -(controls.pitch || 0) * 1.05 * turnScale * dt);
      this.forward.applyQuaternion(scratchQ).normalize();
      this.forward.y = clamp(this.forward.y, -0.985, 0.985);
      this.forward.normalize();
    }

    const targetSpeed = this.hyperdrive
      ? this.hyperSpeed
      : controls.throttle < 0 ? this.precisionSpeed : this.cruiseSpeed;
    const response = this.hyperdrive ? 2.8 : 1.7;
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-response * dt));
    let travel = this.speed * dt;
    let captureDistance = 0;
    if (this.autopilot) {
      const target = this.bodies.get(this.targetName);
      if (target && !target.hazard) {
        const surfaceDistance = Math.max(0, this.position.distanceTo(target.position) - target.radius);
        captureDistance = Math.max(24, target.radius * 0.38);
        if (surfaceDistance <= captureDistance + travel) {
          travel = Math.max(0, surfaceDistance - captureDistance * 0.75);
        }
      }
    }
    this.position.addScaledVector(this.forward, travel);
    if (this.autopilot && captureDistance > 0 && this.targetDistance() <= captureDistance) {
      this.toggleNearestOrbit(captureDistance + 2);
    }
  }
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function planetTexture(body, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = Math.max(256, size / 2);
  const ctx = canvas.getContext("2d", { alpha: false });
  const random = seededRandom(body.name.split("").reduce((n, c) => n + c.charCodeAt(0), 0) * 7919);
  const h = canvas.height;
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  const palettes = {
    earth: ["#163b79", "#267bc2", "#184a89"],
    moon: ["#6f716f", "#bbb9af", "#777872"],
    rock: ["#665f57", "#b8aea0", "#756d64"],
    venus: ["#85592f", "#dfb86e", "#96643a"],
    mars: ["#642514", "#c55d31", "#7c2f1b"],
    jupiter: ["#765442", "#e1c2a0", "#8f6650"],
    saturn: ["#8f7952", "#e1cb91", "#9b8258"],
    ice: [body.name === "Neptune" ? "#183d9b" : "#3f959f", body.color, body.name === "Neptune" ? "#214fb1" : "#75c8cc"],
  };
  const colors = palettes[body.kind] || [body.color, body.color, body.color];
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.5, colors[1]);
  gradient.addColorStop(1, colors[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, h);

  if (["jupiter", "saturn", "venus", "ice"].includes(body.kind)) {
    for (let y = 0; y < h; y += Math.max(3, Math.floor(h / 34))) {
      const alpha = 0.05 + random() * 0.18;
      ctx.fillStyle = random() > 0.5 ? `rgba(255,245,210,${alpha})` : `rgba(70,35,25,${alpha})`;
      ctx.fillRect(0, y + random() * 5, canvas.width, 2 + random() * 8);
    }
    if (body.kind === "jupiter") {
      ctx.fillStyle = "rgba(150,52,35,.72)";
      ctx.beginPath();
      ctx.ellipse(canvas.width * 0.69, h * 0.62, canvas.width * 0.075, h * 0.045, -0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const marks = body.kind === "earth" ? 115 : 210;
    for (let i = 0; i < marks; i++) {
      const x = random() * canvas.width;
      const y = random() * h;
      const rx = (4 + random() * 38) * (body.kind === "earth" ? 2.4 : 1);
      const ry = 3 + random() * 18;
      if (body.kind === "earth") {
        ctx.fillStyle = random() > 0.48 ? `rgba(69,125,58,${0.35 + random() * 0.5})` : `rgba(150,117,63,${0.25 + random() * 0.45})`;
      } else {
        ctx.fillStyle = random() > 0.5 ? `rgba(30,15,10,${0.08 + random() * 0.32})` : `rgba(255,220,180,${0.04 + random() * 0.2})`;
      }
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function orbitLine(body) {
  if (body.parent || body.name === "Sun" || body.hazard === "blackhole") return null;
  const radius = Math.hypot(body.position[0], body.position[2]);
  const points = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    points.push(new Vector3(Math.cos(a) * radius, body.position[1], Math.sin(a) * radius));
  }
  return new Line(
    new BufferGeometry().setFromPoints(points),
    new LineBasicMaterial({ color: 0x31506f, transparent: true, opacity: 0.12 }),
  );
}

function createStarSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.16, "rgba(224,238,255,.96)");
  glow.addColorStop(0.48, "rgba(120,175,255,.28)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

function spaceAsset(file) {
  const base = import.meta.env?.BASE_URL || "/";
  return `${base}textures/space/${file}`;
}

function configureTexture(texture, anisotropy = 8) {
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

function loadMaterialMap(loader, material, file, stats, { alphaOnly = false, bumpScale = 0 } = {}) {
  stats.total += 1;
  loader.load(spaceAsset(file), (texture) => {
    configureTexture(texture);
    if (alphaOnly) material.alphaMap = texture;
    else {
      material.map?.dispose?.();
      material.map = texture;
      if (bumpScale > 0) {
        material.bumpMap = texture;
        material.bumpScale = bumpScale;
      }
    }
    material.needsUpdate = true;
    stats.loaded += 1;
  }, undefined, () => { stats.failed += 1; });
}

function createGalaxy(core, count) {
  const random = seededRandom(8675309);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const warm = new Color(0xffd7a2);
  const cool = new Color(0x7aa7ff);
  const mixed = new Color();
  const arms = 5;
  for (let i = 0; i < count; i++) {
    const radius = Math.pow(random(), 0.64) * 6400;
    const arm = i % arms;
    const angle = arm * Math.PI * 2 / arms + radius * 0.00225 + (random() - 0.5) * (0.28 + radius / 13000);
    positions[i * 3] = core[0] + Math.cos(angle) * radius;
    positions[i * 3 + 1] = core[1] + (random() - 0.5) * (120 + radius * 0.09);
    positions[i * 3 + 2] = core[2] + Math.sin(angle) * radius;
    mixed.copy(cool).lerp(warm, Math.max(0, 1 - radius / 4200) * (0.5 + random() * 0.5));
    colors[i * 3] = mixed.r;
    colors[i * 3 + 1] = mixed.g;
    colors[i * 3 + 2] = mixed.b;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const galaxy = new Points(geometry, new PointsMaterial({
    vertexColors: true,
    size: 3.4,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: AdditiveBlending,
  }));
  galaxy.name = "Milky Way spiral";
  return galaxy;
}

function remapRingUvs(geometry, inner, outer) {
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    const radius = Math.hypot(positions.getX(i), positions.getY(i));
    uvs.setXY(i, clamp((radius - inner) / (outer - inner), 0, 1), 0.5);
  }
  uvs.needsUpdate = true;
}

export function createSolarSystem({ textureSize = 1024, starCount = 6500 } = {}) {
  const group = new Group();
  group.name = "playable-solar-system";
  group.visible = false;
  const bodies = new Map();
  const textures = { loaded: 0, failed: 0, total: 0 };
  const textureLoader = new TextureLoader();
  const starSprite = createStarSprite();
  const random = seededRandom(20260908);
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const radius = 9000 + random() * 19000;
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radial = Math.sqrt(1 - z * z);
    starPositions[i * 3] = Math.cos(angle) * radial * radius + 4500;
    starPositions[i * 3 + 1] = z * radius;
    starPositions[i * 3 + 2] = Math.sin(angle) * radial * radius;
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute("position", new Float32BufferAttribute(starPositions, 3));
  const stars = new Points(starGeometry, new PointsMaterial({
    color: 0xe7f1ff,
    map: starSprite,
    alphaTest: 0.02,
    size: 4.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  }));
  stars.name = "stars";
  group.add(stars, new AmbientLight(0x37516f, 0.3));

  const milkyWayMaterial = new MeshBasicMaterial({ color: 0xffffff, side: BackSide, transparent: true, opacity: 0.42, depthWrite: false });
  const milkyWayBackdrop = new Mesh(new SphereGeometry(42000, 64, 32), milkyWayMaterial);
  milkyWayBackdrop.position.set(7000, 0, -3000);
  milkyWayBackdrop.rotation.y = -0.72;
  milkyWayBackdrop.name = "Milky Way panorama";
  milkyWayBackdrop.visible = false;
  group.add(milkyWayBackdrop);
  textures.total += 1;
  textureLoader.load(spaceAsset("milky-way.jpg"), (texture) => {
    milkyWayMaterial.map = configureTexture(texture);
    milkyWayMaterial.needsUpdate = true;
    milkyWayBackdrop.visible = true;
    textures.loaded += 1;
  }, undefined, () => { textures.failed += 1; });

  const galacticCore = SPACE_BODIES.find((body) => body.kind === "blackhole");
  const galaxy = createGalaxy(galacticCore.position, Math.round(starCount * 1.1));
  galaxy.material.map = starSprite;
  galaxy.material.alphaTest = 0.02;
  galaxy.material.needsUpdate = true;
  group.add(galaxy);

  const solarLight = new PointLight(0xffe0aa, 5.2, 30000, 0.25);
  solarLight.position.set(0, 0, 0);
  group.add(solarLight);

  for (const body of SPACE_BODIES) {
    const line = orbitLine(body);
    if (line) group.add(line);
    if (body.kind === "blackhole") {
      const blackHole = createRelativisticBlackHole(body, {
        raySteps: textureSize <= 512 ? 40 : 64,
      });
      bodies.set(body.name, blackHole);
      group.add(blackHole);
      continue;
    }
    const segments = body.landing && body.name !== "Earth"
      ? (textureSize >= 1024 ? 104 : 72)
      : body.radius >= 100 ? 96 : body.radius >= 50 ? 72 : 56;
    const geometry = new SphereGeometry(body.radius, segments, Math.max(32, segments / 2));
    const fallbackTexture = planetTexture(body, textureSize);
    const material = body.kind === "sun"
      ? new MeshBasicMaterial({ map: fallbackTexture, color: 0xffffff })
      : new MeshPhongMaterial({ map: fallbackTexture, shininess: body.kind === "earth" ? 32 : 4 });
    loadMaterialMap(textureLoader, material, REAL_TEXTURES[body.name], textures, {
      bumpScale: body.landing && body.kind !== "earth" ? body.radius * 0.009 : 0,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = body.name;
    mesh.position.set(...body.position);
    mesh.rotation.z = body.name === "Uranus" ? Math.PI * 0.46 : (random() - 0.5) * 0.35;
    mesh.userData.body = body;
    bodies.set(body.name, mesh);
    group.add(mesh);

    if (body.kind === "sun") {
      const glow = new Mesh(
        new SphereGeometry(body.radius * 1.2, 64, 32),
        new MeshBasicMaterial({ color: 0xff9c29, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false }),
      );
      glow.position.copy(mesh.position);
      group.add(glow);
    }
    if (body.kind === "earth") {
      const cloudMaterial = new MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, shininess: 20, depthWrite: false });
      loadMaterialMap(textureLoader, cloudMaterial, "earth-clouds.jpg", textures, { alphaOnly: true });
      const clouds = new Mesh(
        new SphereGeometry(body.radius * 1.012, 72, 36),
        cloudMaterial,
      );
      clouds.name = "Earth clouds";
      clouds.position.copy(mesh.position);
      mesh.userData.clouds = clouds;
      group.add(clouds);
    }
    if (body.kind === "venus") {
      const venusCloudMaterial = new MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.68, shininess: 8, depthWrite: false });
      loadMaterialMap(textureLoader, venusCloudMaterial, "venus-atmosphere.jpg", textures);
      const venusClouds = new Mesh(new SphereGeometry(body.radius * 1.018, 72, 36), venusCloudMaterial);
      venusClouds.name = "Venus atmosphere texture";
      venusClouds.position.copy(mesh.position);
      mesh.userData.clouds = venusClouds;
      group.add(venusClouds);
    }
    if (body.atmosphere) {
      const shell = new Mesh(
        new SphereGeometry(body.radius * (body.gasGiant ? 1.025 : 1.045), 64, 32),
        new MeshBasicMaterial({ color: body.atmosphere, side: BackSide, transparent: true, opacity: body.gasGiant ? 0.07 : 0.12, blending: AdditiveBlending, depthWrite: false }),
      );
      shell.name = `${body.name} atmospheric glow`;
      shell.position.copy(mesh.position);
      group.add(shell);
    }
    if (body.rings) {
      const inner = body.radius * 1.28;
      const outer = body.radius * (body.name === "Saturn" ? 2.15 : 1.72);
      const ringGeometry = new RingGeometry(inner, outer, 192);
      remapRingUvs(ringGeometry, inner, outer);
      const ringMaterial = new MeshBasicMaterial({ color: body.name === "Saturn" ? 0xffffff : 0x89b9b7, side: DoubleSide, transparent: true, opacity: body.name === "Saturn" ? 0.88 : 0.35, depthWrite: false });
      if (body.name === "Saturn") loadMaterialMap(textureLoader, ringMaterial, "saturn-ring.png", textures);
      const ring = new Mesh(
        ringGeometry,
        ringMaterial,
      );
      ring.position.copy(mesh.position);
      ring.rotation.x = Math.PI / 2 + mesh.rotation.z;
      group.add(ring);
    }
  }

  const targetMarker = new Mesh(
    new TorusGeometry(1, 0.055, 10, 96),
    new MeshBasicMaterial({ color: 0x6fe7ff, transparent: true, opacity: 0.9, depthTest: false }),
  );
  targetMarker.renderOrder = 20;
  group.add(targetMarker);

  function update(dt, targetName, elapsed = 0, cameraPosition = null, blackHoleProximity = 0, surfaceBody = null) {
    for (const [name, mesh] of bodies) {
      if (mesh.userData.body?.kind === "blackhole") {
        mesh.userData.update?.(elapsed, cameraPosition, blackHoleProximity);
        continue;
      }
      if (name !== surfaceBody) {
        mesh.rotation.y += dt * (name === "Jupiter" ? 0.12 : name === "Earth" ? 0.075 : 0.035);
        if (mesh.userData.clouds) mesh.userData.clouds.rotation.y -= dt * 0.025;
      }
    }
    const target = bodies.get(targetName);
    targetMarker.visible = !!target && !target.userData.body?.hazard && !surfaceBody;
    if (target) {
      const radius = target.userData.body.radius * (1.3 + Math.sin(elapsed * 2.4) * 0.035);
      targetMarker.position.copy(target.position);
      targetMarker.scale.setScalar(radius);
      targetMarker.rotation.y = elapsed * 0.32;
    }
  }

  return { group, bodies, stars, targetMarker, textures, update };
}
