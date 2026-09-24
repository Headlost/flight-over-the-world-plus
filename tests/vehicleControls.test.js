import test from "node:test";
import assert from "node:assert/strict";
import {
  getVehicleControls,
  VEHICLE_CONTROL_PROFILES,
  vehicleControlProfileKey,
} from "../src/game/vehicleControls.js";

function profileText(profile) {
  const desktop = profile.desktopLines
    .flatMap((line) => line.map((token) => typeof token === "string" ? token : token.key))
    .join(" ");
  const help = profile.helpRows.map(({ term, description }) => `${term} ${description}`).join(" ");
  return `${desktop} ${profile.touchSummary} ${help} ${profile.stickLabel}`.toLowerCase();
}

function assertExcludes(profile, phrases) {
  const text = profileText(profile);
  for (const phrase of phrases) {
    assert.equal(text.includes(phrase.toLowerCase()), false, `profile must not mention ${phrase}`);
  }
}

test("ordinary aircraft ids share one focused control profile", () => {
  const expected = getVehicleControls("pa28");
  for (const vehicle of ["ordinary", "pa28", "q400", "citation", "jet", " Q400 "]) {
    assert.equal(vehicleControlProfileKey(vehicle), "ordinary");
    assert.equal(getVehicleControls(vehicle), expected);
  }

  assert.match(profileText(expected), /pitch/);
  assert.match(profileText(expected), /roll/);
  assertExcludes(expected, ["loop", "rapid turn", "smoke", "takeoff", "canopy", "orbit", "hyperdrive", "planet"]);
});

test("special vehicle aliases resolve to their own profiles", () => {
  for (const vehicle of ["boeing737", "a380"]) {
    assert.equal(vehicleControlProfileKey(vehicle), "airliner");
    assert.match(profileText(getVehicleControls(vehicle)), /z\s+contrails on\/off/);
  }
  for (const vehicle of ["dzikiDzik", "dziki-dzik", "dziki_dzik"]) {
    assert.equal(vehicleControlProfileKey(vehicle), "dzikiDzik");
  }
  for (const vehicle of ["parachutist", "paraglider"]) {
    assert.equal(vehicleControlProfileKey(vehicle), "parachutist");
  }
  for (const vehicle of ["freeflyer", "free-flight", "free_flight", "superman"]) {
    assert.equal(vehicleControlProfileKey(vehicle), "freeflyer");
  }
  assert.equal(vehicleControlProfileKey("rocket"), "rocketAtmosphere");
  assert.equal(vehicleControlProfileKey("rocket", { space: true }), "rocketSpace");
  assert.equal(vehicleControlProfileKey("rocket", { mode: "space" }), "rocketSpace");
  assert.equal(vehicleControlProfileKey("rocket", "space"), "rocketSpace");
});

test("each special profile contains its own controls and no controls from other vehicles", () => {
  const airliner = getVehicleControls("boeing737");
  assert.match(profileText(airliner), /contrails/);
  assert.match(profileText(airliner), /gamepad secondary/);
  assertExcludes(airliner, ["loop", "rapid turn", "canopy", "orbit", "hyperdrive", "planet"]);

  const aerobatic = getVehicleControls("dzikiDzik");
  assert.match(profileText(aerobatic), /loops/);
  assert.match(profileText(aerobatic), /rapid turns/);
  assert.match(profileText(aerobatic), /twin smoke/);
  assertExcludes(aerobatic, ["takeoff", "canopy", "orbit", "hyperdrive", "planet"]);

  const parachutist = getVehicleControls("parachutist");
  assert.match(profileText(parachutist), /walk/);
  assert.match(profileText(parachutist), /gentle takeoff/);
  assert.match(profileText(parachutist), /under canopy/);
  assertExcludes(parachutist, ["loop", "rapid turn", "smoke", "orbit", "hyperdrive", "planet"]);

  const freeflyer = getVehicleControls("freeflyer");
  assert.match(profileText(freeflyer), /independent 360/);
  assert.match(profileText(freeflyer), /direct yaw/);
  assert.match(profileText(freeflyer), /land/);
  assertExcludes(freeflyer, ["canopy", "smoke", "orbit", "hyperdrive", "planet"]);

  const atmosphericRocket = getVehicleControls("rocket");
  assert.match(profileText(atmosphericRocket), /launch to orbit/);
  assert.match(profileText(atmosphericRocket), /atmospheric/);
  assertExcludes(atmosphericRocket, ["loop", "rapid turn", "smoke", "walk", "canopy", "hyperdrive", "planet"]);

  const spaceRocket = getVehicleControls("rocket", { space: true });
  assert.match(profileText(spaceRocket), /hyperdrive/);
  assert.match(profileText(spaceRocket), /precision/);
  assert.match(profileText(spaceRocket), /planets/);
  assert.match(profileText(spaceRocket), /descend from orbit/);
  assertExcludes(spaceRocket, ["loop", "rapid turn", "smoke", "walk", "canopy", "takeoff"]);
});

test("profiles expose immutable plain DOM-safe tokens", () => {
  assert.equal(vehicleControlProfileKey(undefined), "ordinary");
  assert.equal(vehicleControlProfileKey({}), "ordinary");
  assert.equal(getVehicleControls("unknown"), VEHICLE_CONTROL_PROFILES.ordinary);

  for (const profile of Object.values(VEHICLE_CONTROL_PROFILES)) {
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(typeof profile.touchSummary, "string");
    assert.equal(typeof profile.stickLabel, "string");
    assert.ok(profile.desktopLines.length > 0);
    assert.ok(profile.helpRows.length > 0);

    for (const line of profile.desktopLines) {
      assert.ok(Array.isArray(line));
      assert.equal(Object.isFrozen(line), true);
      for (const token of line) {
        assert.ok(typeof token === "string" || (
          token && typeof token === "object" && Object.keys(token).length === 1 && typeof token.key === "string"
        ));
      }
    }
    for (const row of profile.helpRows) {
      assert.deepEqual(Object.keys(row).sort(), ["description", "term"]);
      assert.equal(typeof row.term, "string");
      assert.equal(typeof row.description, "string");
    }
    assert.doesNotMatch(profileText(profile), /<\/?[a-z][^>]*>/i);
  }
});
