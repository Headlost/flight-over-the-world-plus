import test from "node:test";
import assert from "node:assert/strict";
import { AMBIENT_VOLUME_KEY, clampAmbientVolume, loadAmbientVolume, saveAmbientVolume } from "../src/game/ambientVolume.js";
import { engineDebug, getAmbientVolume, setAmbientVolume } from "../src/game/engineSound.js";

test("ambient storage preserves a saved mute and fractional levels independently of music", () => {
  const entries = new Map([["fotw-music-muted", "1"]]);
  const storage = { getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value) };
  assert.equal(loadAmbientVolume(storage), 1);
  assert.equal(saveAmbientVolume(0, storage), 0);
  assert.equal(entries.get(AMBIENT_VOLUME_KEY), "0");
  assert.equal(loadAmbientVolume(storage), 0);
  saveAmbientVolume(0.37, storage);
  assert.equal(loadAmbientVolume(storage), 0.37);
  assert.equal(entries.get("fotw-music-muted"), "1");
});

test("missing and malformed ambient preferences retain existing loudness, while numeric volume remains bounded", () => {
  for (const value of [null, undefined, "", " ", "not a number", NaN, Infinity, {}, false])
    assert.equal(clampAmbientVolume(value), 1);
  assert.equal(clampAmbientVolume("0"), 0);
  assert.equal(clampAmbientVolume(-2), 0);
  assert.equal(clampAmbientVolume("2"), 1);
  assert.equal(clampAmbientVolume("0.63"), 0.63);
});

test("unavailable browser storage does not prevent live ambient control", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(loadAmbientVolume(blocked), 1);
  assert.equal(saveAmbientVolume(0, blocked), 0);
  assert.equal(saveAmbientVolume(0.54, blocked), 0.54);
});

test("setting ambient volume before an audio gesture neither creates an audio graph nor loses zero", () => {
  assert.equal(engineDebug().ctxState, null);
  assert.equal(engineDebug().built, false);
  assert.equal(getAmbientVolume(), 1);
  setAmbientVolume(0);
  assert.equal(getAmbientVolume(), 0);
  assert.equal(engineDebug().ambientVolume, 0);
  assert.equal(engineDebug().ctxState, null);
  assert.equal(engineDebug().built, false);
  setAmbientVolume(1);
});
