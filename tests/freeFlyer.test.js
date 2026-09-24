import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { AnimationClip, Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  buildFreeFlyerModel,
  createFreeFlyerModel,
  FREE_FLYER_GROUND_CLEARANCE,
  FreeFlyerController,
  setFreeFlyerFirstPerson,
  setFreeFlyerRole,
  updateFreeFlyerModel,
} from "../src/game/freeFlyer.js";
import { interactionProfile } from "../src/game/playerInteraction.js";
import { validMessage } from "../src/game/protocol.js";

function step(controller, controls, seconds, fps = 60) {
  for (let frame = 0; frame < seconds * fps; frame += 1) controller.update(1 / fps, controls);
}

globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
};

test("free flyer has a separate civilian shirt model and a body-free first-person view", () => {
  const root = createFreeFlyerModel();
  const rig = root.userData.freeFlyer;
  assert.equal(root.userData.key, "freeflyer");
  assert.equal(rig.pilot.name, "civilian-free-flyer");
  assert.equal(rig.arms.length, 2);
  assert.equal(rig.legs.length, 2);
  assert.equal(rig.torso.material.name, "civilian-blue-overshirt");
  setFreeFlyerFirstPerson(root, true);
  assert.equal(rig.pilot.visible, false);
  setFreeFlyerFirstPerson(root, false);
  assert.equal(rig.pilot.visible, true);
  updateFreeFlyerModel(root, "airborne", 40, 1 / 60, { pitch: 0.8, roll: 0.4 });
  root.updateMatrixWorld(true);
  root.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite)));
});

test("authored free flyer keeps its animation rig, normalized height and role surface", () => {
  const scene = new Group();
  scene.name = "Civilian";
  const shirtMaterial = new MeshStandardMaterial({ color: 0x7fa9d8 });
  shirtMaterial.name = "SHIRT_BLUE";
  const shirt = new Mesh(new BoxGeometry(0.55, 1.8, 0.3), shirtMaterial);
  shirt.name = "SHIRT_BLUE";
  shirt.position.y = 0.9;
  scene.add(shirt);
  const animations = ["Idle", "Walk", "Run", "Flight", "Takeoff", "Land"]
    .map((name) => new AnimationClip(name, 1, []));
  const root = buildFreeFlyerModel({ scene, animations });
  const size = new Box3().setFromObject(root).getSize(new Vector3());

  assert.ok(Math.abs(size.y - 1.82) < 1e-6);
  assert.equal(root.userData.freeFlyer.animated, true);
  assert.equal(root.userData.freeFlyer.actions.has("Flight"), true);
  updateFreeFlyerModel(root, "grounded", 5, 1 / 60);
  assert.equal(root.userData.freeFlyer.activeName, "Run");
  updateFreeFlyerModel(root, "grounded", 0, 1 / 60, { landingId: 0 });
  updateFreeFlyerModel(root, "grounded", 0, 1 / 60, { landingId: 1 });
  assert.equal(root.userData.freeFlyer.activeName, "Land");
  for (let frame = 0; frame < 70; frame += 1) {
    updateFreeFlyerModel(root, "grounded", 0, 1 / 60, { landingId: 1 });
  }
  assert.equal(root.userData.freeFlyer.activeName, "Idle");
  setFreeFlyerRole(root, "leader");
  assert.equal(shirtMaterial.color.getHex(), 0xd83b36);
  setFreeFlyerRole(root, "player");
  assert.equal(shirtMaterial.color.getHex(), 0x7fa9d8);
  setFreeFlyerFirstPerson(root, true);
  assert.equal(scene.visible, false);
});

test("shipped free-flight GLB contains the civilian parts, skin and complete motion set", async () => {
  const bytes = await fs.readFile(new URL("../public/models/free-flyer.glb", import.meta.url));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(data, "", resolve, reject));
  const meshes = [];
  let skinnedMeshes = 0;
  let bones = 0;
  gltf.scene.traverse((object) => {
    if (object.isMesh) meshes.push(object.name);
    if (object.isSkinnedMesh) skinnedMeshes += 1;
    if (object.isBone) bones += 1;
  });
  const names = meshes.join(" ");
  for (const part of ["BODY", "EYES", "TSHIRT_WHITE", "SHIRT_BLUE", "PANTS_BROWN", "SHOES_WHITE", "HAIR"]) {
    assert.match(names, new RegExp(part));
  }
  assert.ok(skinnedMeshes >= 7);
  assert.ok(bones >= 30);
  assert.deepEqual(
    gltf.animations.map(({ name }) => name).sort(),
    ["Flight", "Idle", "Land", "Run", "Takeoff", "Walk"],
  );
  const root = buildFreeFlyerModel(gltf);
  const height = new Box3().setFromObject(root).getSize(new Vector3()).y;
  assert.ok(Math.abs(height - 1.82) < 0.02);
});

test("free flyer supports steep powered flight, banking and independent direct yaw", () => {
  const flyer = new FreeFlyerController(52.25, 20.98, 1200, 0);
  const initialHeight = flyer.height;
  step(flyer, { pitch: 1, roll: 0, yaw: 0, throttle: 1 }, 4);
  assert.ok(flyer.pitch > 1.2, "full climb input should approach near-vertical flight");
  assert.ok(flyer.height > initialHeight + 80);
  assert.ok(flyer.speed > flyer.cruise);
  const headingBefore = flyer.heading;
  step(flyer, { pitch: 0, roll: 0.7, yaw: 1, throttle: 0 }, 2);
  assert.notEqual(flyer.heading, headingBefore);
  assert.ok([flyer.lat, flyer.lon, flyer.height, flyer.heading, flyer.pitch, flyer.roll].every(Number.isFinite));
});

test("free flyer lands, walks, runs and takes off again", () => {
  const flyer = new FreeFlyerController(52.25, 20.98, 300, 0);
  assert.equal(flyer.land(120), true);
  assert.equal(flyer.state, "grounded");
  assert.equal(flyer.height, 120 + FREE_FLYER_GROUND_CLEARANCE);
  const startLat = flyer.lat;
  step(flyer, { pitch: -1, roll: 0, yaw: 0, throttle: 1 }, 2);
  assert.ok(flyer.speed > 4.5);
  assert.notEqual(flyer.lat, startLat);
  assert.equal(flyer.takeOff(120), true);
  step(flyer, { pitch: 0, roll: 0.2, yaw: 0, throttle: 0 }, 3);
  assert.equal(flyer.state, "airborne");
  assert.ok(flyer.height >= 132);
});

test("archived free flyer keeps its contact profile but cannot start a multiplayer session", () => {
  assert.equal(interactionProfile("freeflyer", "grounded", 1.85).kind, "person");
  assert.equal(interactionProfile("freeflyer", "airborne", 1.85).kind, "person");
  assert.equal(validMessage({ t: "hello", plane: "freeflyer", name: "Civilian" }, true), false);
  assert.equal(validMessage({
    t: "pose", plane: "freeflyer", space: false, lat: 52.25, lon: 20.98,
    h: 400, heading: 0.4, pitch: 1.2, roll: -0.3, seq: 1, at: 10,
    state: "airborne", motion: 44,
  }, true), false);
});
