import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Vector3 } from "three";
import {
  createParachutistCharacter,
  PARACHUTIST_SUIT_PALETTE,
} from "../src/game/parachutistCharacter.js";
import { disposeModel } from "../src/game/dispose.js";
import { setParachutistRole, PARACHUTIST_ROLE_COLORS } from "../src/game/paraglider.js";

function resources(character) {
  const geometries = new Set();
  const materials = new Set();
  let meshes = 0;
  let triangles = 0;
  character.pilot.traverse(object => {
    if (!object.isMesh) return;
    meshes += 1;
    geometries.add(object.geometry);
    materials.add(object.material);
    triangles += object.geometry.index
      ? object.geometry.index.count / 3
      : object.geometry.attributes.position.count / 3;
  });
  return { geometries, materials, meshes, triangles };
}

test("adult parachutist retains boot ground contact and fits a bounded articulated GPU budget", () => {
  const character = createParachutistCharacter();
  try {
    const bounds = new Box3().setFromObject(character.pilot);
    assert.ok(Math.abs(bounds.min.y + 0.32) < 1e-6, "standing boot sole must contact the existing ground clearance");
    assert.ok(bounds.max.y - bounds.min.y > 1.85 && bounds.max.y - bounds.min.y < 1.98);
    assert.ok(bounds.max.x - bounds.min.x > 0.48 && bounds.max.x - bounds.min.x < 0.75);
    const budget = resources(character);
    assert.ok(budget.meshes <= 70, `${budget.meshes} character draw meshes`);
    assert.ok(budget.triangles < 45000, `${budget.triangles} character triangles`);
    for (const geometry of budget.geometries) {
      assert.ok(Array.from(geometry.attributes.position.array).every(Number.isFinite));
      assert.ok(Array.from(geometry.attributes.normal.array).every(Number.isFinite));
    }
    const shoulder = character.riserAnchors[0].getWorldPosition(new Vector3());
    const boot = character.legs[0].boot.getWorldPosition(new Vector3());
    character.headGroup.rotation.y = 0.35;
    character.legs[0].lower.rotation.x = -0.75;
    character.pilot.updateMatrixWorld(true);
    assert.ok(character.riserAnchors[0].getWorldPosition(new Vector3()).distanceTo(shoulder) < 1e-9,
      "looking and bending a knee must not move the harness suspension point");
    assert.ok(character.legs[0].boot.getWorldPosition(new Vector3()).distanceTo(boot) > 0.1,
      "boot must follow its articulated knee, rather than stay fixed in model space");
  } finally {
    disposeModel(character.pilot);
  }
});

test("parachutist uses a lightly emissive teal and blue suit palette", () => {
  const character = createParachutistCharacter();
  try {
    const materials = resources(character).materials;
    const base = [...materials].find(material => material.name === "parachutist-suit-base-teal");
    const accent = [...materials].find(material => material.name === "parachutist-suit-accent-blue");
    assert.ok(base, "teal base material must be present on the character");
    assert.ok(accent, "blue accent material must be present on the character");
    assert.equal(base.color.getHex(), PARACHUTIST_SUIT_PALETTE.base);
    assert.equal(base.emissive.getHex(), PARACHUTIST_SUIT_PALETTE.base);
    assert.equal(base.emissiveIntensity, PARACHUTIST_SUIT_PALETTE.baseEmissiveIntensity);
    assert.equal(accent.color.getHex(), PARACHUTIST_SUIT_PALETTE.accent);
    assert.equal(accent.emissive.getHex(), PARACHUTIST_SUIT_PALETTE.accent);
    assert.equal(accent.emissiveIntensity, PARACHUTIST_SUIT_PALETTE.accentEmissiveIntensity);
    assert.ok(base.emissiveIntensity > 0 && base.emissiveIntensity <= 0.12);
    assert.ok(accent.emissiveIntensity > 0 && accent.emissiveIntensity <= 0.12);
    assert.equal(character.roleSurfaces.length, 1);
    assert.equal(character.roleSurfaces[0].surface, accent);
  } finally {
    disposeModel(character.pilot);
  }
});

test("parachutist role tint and disposal stay local to one rig and leave teal cloth and face intact", () => {
  const first = createParachutistCharacter();
  const second = createParachutistCharacter();
  const firstResources = resources(first);
  const secondResources = resources(second);
  let secondDisposals = 0;
  for (const geometry of firstResources.geometries) assert.equal(secondResources.geometries.has(geometry), false);
  for (const material of firstResources.materials) assert.equal(secondResources.materials.has(material), false);
  for (const resource of [...secondResources.materials, ...secondResources.geometries]) {
    resource.addEventListener("dispose", () => { secondDisposals += 1; });
  }
  const nonRoleColors = new Map([...firstResources.materials]
    .filter(material => !first.roleSurfaces.some(entry => entry.surface === material))
    .map(material => [material, material.color.getHex()]));
  const wrapper = new Group();
  wrapper.add(first.pilot);
  wrapper.userData.parachutist = { character: first };
  try {
    assert.equal(setParachutistRole(wrapper, "admin"), PARACHUTIST_ROLE_COLORS.admin);
    assert.ok(first.roleSurfaces.length > 0);
    assert.ok(first.roleSurfaces.every(entry => entry.surface.color.getHex() === PARACHUTIST_ROLE_COLORS.admin));
    assert.ok(first.roleSurfaces.every(entry => entry.surface.emissive.getHex() === PARACHUTIST_ROLE_COLORS.admin));
    assert.ok(first.roleSurfaces.every(entry => entry.surface.emissiveIntensity === 0.08));
    assert.ok(second.roleSurfaces.every(entry => entry.surface.color.getHex() === entry.color));
    for (const [material, color] of nonRoleColors) assert.equal(material.color.getHex(), color);
    setParachutistRole(wrapper, "player");
    assert.ok(first.roleSurfaces.every(entry => entry.surface.color.getHex() === entry.color));
    assert.ok(first.roleSurfaces.every(entry => entry.surface.emissive.getHex() === entry.emissive));
    assert.ok(first.roleSurfaces.every(entry => entry.surface.emissiveIntensity === entry.emissiveIntensity));
    disposeModel(wrapper);
    assert.equal(secondDisposals, 0, "removing another player must not dispose this rig's material or geometry");
  } finally {
    disposeModel(second.pilot);
  }
});
