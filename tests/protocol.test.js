import test from "node:test";
import assert from "node:assert/strict";
import { validMessage } from "../src/game/protocol.js";

const attitude = { qx: 0.5, qy: -0.5, qz: 0.5, qw: -0.5 };
const pose = {
  t: "pose", plane: "dzikiDzik", space: false, lat: 52.25, lon: 20.985,
  h: 850, heading: 2.4, pitch: Math.PI / 2, roll: Math.PI,
  seq: 42, at: 1250, state: "airborne", motion: 85, ...attitude,
};
const resume = incomingPose => ({ t: "resume", plane: "dzikiDzik", pose: incomingPose, seats: { host: 0 } });

test("Dziki Dzik is selectable and assignable throughout multiplayer lobby and round configuration", () => {
  for (const [message, guest] of [
    [{ t: "hello", plane: "dzikiDzik", name: "Acro pilot" }, true],
    [{ t: "plane", plane: "dzikiDzik" }, true],
    [{ t: "roster", lockedPlane: "dzikiDzik", players: [{ id: "acro-1", name: "Acro pilot", plane: "dzikiDzik" }] }, false],
    [{ t: "start", lat: 52.25, lon: 20.985, mode: "free", vehicles: { host: "dzikiDzik" }, seats: { host: 0 } }, false],
  ]) assert.equal(validMessage(message, guest), true);
});

test("vertical and inverted Dziki Dzik quaternion poses and host resumes are accepted", () => {
  assert.equal(validMessage(pose, true), true);
  assert.equal(validMessage(pose), true);
  assert.equal(validMessage(resume(pose)), true);
  assert.equal(validMessage(resume(pose), true), false, "a guest cannot send a host resume");
  const almostUnit = { ...pose, ...attitude, qw: -0.50001 };
  assert.equal(validMessage(almostUnit, true), true, "finite transport rounding may be normalised by the renderer");
  assert.equal(validMessage(resume(almostUnit)), true);
});

test("Dziki Dzik rejects partial quaternion poses and resumes while accepting completely absent legacy attitude", () => {
  const legacy = { ...pose };
  for (const field of ["qx", "qy", "qz", "qw"]) delete legacy[field];
  assert.equal(validMessage(legacy, true), true);
  assert.equal(validMessage(resume(legacy)), true);
  for (const field of ["qx", "qy", "qz", "qw"]) {
    const partial = { ...pose };
    delete partial[field];
    assert.equal(validMessage(partial, true), false, `pose is missing ${field}`);
    assert.equal(validMessage(resume(partial)), false, `resume is missing ${field}`);
    assert.equal(validMessage({ ...legacy, [field]: attitude[field] }, true), false, `pose contains only ${field}`);
  }
});

test("Dziki Dzik rejects non-finite, non-numeric, zero and non-unit quaternion poses and resumes", () => {
  const malformed = [
    { qx: 0, qy: 0, qz: 0, qw: 0 },
    { qx: 0.2, qy: 0.2, qz: 0.2, qw: 0.2 },
    { qx: 1, qy: 1, qz: 1, qw: 1 },
  ];
  for (const field of ["qx", "qy", "qz", "qw"])
    for (const value of [NaN, Infinity, -Infinity, null, "0.5", 1.1])
      malformed.push({ ...attitude, [field]: value });
  for (const rotation of malformed) {
    assert.equal(validMessage({ ...pose, ...rotation }, true), false);
    assert.equal(validMessage(resume({ ...pose, ...rotation })), false);
  }
});

test("adding acro attitude leaves existing rocket space message rules unchanged", () => {
  const space = {
    t: "pose", plane: "rocket", space: true, x: 2500, y: 0, z: 0,
    fx: 0, fy: 0, fz: -1, qx: 0, qy: 0, qz: 0, qw: 1,
    seq: 8, at: 800, motion: 72,
  };
  assert.equal(validMessage(space, true), true);
  assert.equal(validMessage({ t: "resume", plane: "rocket", pose: space }), true);
  assert.equal(validMessage({ ...space, plane: "dzikiDzik" }, true), false, "the new aircraft cannot enter rocket space mode");
  assert.equal(validMessage({ t: "resume", plane: "dzikiDzik", pose: space }), false);
  assert.equal(validMessage({ ...space, qw: 2 }, true), false);
  const missing = { ...space };
  delete missing.qw;
  assert.equal(validMessage(missing, true), false, "rocket space attitude remains mandatory");
});
