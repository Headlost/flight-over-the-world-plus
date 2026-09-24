import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Box3, Group, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attachJetExhaust, updateJetExhaust } from '../src/game/jetExhaust.js';
import { disposeModel } from '../src/game/dispose.js';

async function importedExhaust(file = 'fighter', vehicle = 'jet', wingspan = 19) {
  // Geometry is the subject of this Node test. A minimal bitmap stand-in lets
  // GLTFLoader parse the supplied textured GLB without a browser image decoder.
  globalThis.self ||= globalThis;
  globalThis.createImageBitmap ||= async () => ({ width: 1, height: 1, close() {} });
  const source = process.env.JET_EXHAUST_MODEL_DIR
    ? join(process.env.JET_EXHAUST_MODEL_DIR, `${file}.glb`)
    : new URL(`../public/models/${file}.glb`, import.meta.url);
  const bytes = await readFile(source);
  const { scene: model } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  // The five replacement airframes are sized by their actual wingspan in
  // main.js; the Boeing fuselage is longer than its wingspan.
  model.scale.setScalar(wingspan / (['boeing737', 'a380', 'b2'].includes(vehicle)
    ? size.x : Math.max(size.x, size.y, size.z)));
  box.setFromObject(model);
  model.position.sub(box.getCenter(new Vector3()));
  const root = new Group();
  root.add(model);
  return { model, root, exhaust: attachJetExhaust(root, model, vehicle) };
}

const fighter = () => importedExhaust();

test('fighter flames attach near both rear outlets and follow the new aircraft rearward', async () => {
  const { model, root, exhaust } = await fighter();
  const mesh = model.getObjectByProperty('isMesh', true);
  assert.ok(mesh);
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  updateJetExhaust(root, true, 1, 0);
  root.updateMatrixWorld(true);
  assert.equal(exhaust.children.length, 2);
  assert.ok(exhaust.children[0].position.x < 0 && exhaust.children[1].position.x > 0);
  for (const nozzle of exhaust.children) {
    assert.ok(Math.abs(nozzle.position.x) < size.x * 0.2);
    assert.ok(nozzle.position.y > box.min.y && nozzle.position.y < box.max.y);
    assert.ok(nozzle.children[0].scale.x < exhaust.userData.radius,
      'flame base fits inside the inferred outlet');
    const origin = nozzle.getWorldPosition(new Vector3());
    const tip = nozzle.children[0].localToWorld(new Vector3(0, 0, -1));
    assert.ok(origin.z > box.max.z - size.z * 0.2 && origin.z < box.max.z);
    assert.ok(tip.z > origin.z + 1 && tip.z < origin.z + 1.3);
    assert.ok(Math.abs(origin.x - tip.x) < 0.00001 && Math.abs(origin.y - tip.y) < 0.00001);
  }
  root.position.set(6378137, 1243452, -835478);
  root.rotation.set(0.5, 1.1, 2.2);
  root.updateMatrixWorld(true);
  const backward = new Vector3(0, 0, 1).applyQuaternion(root.quaternion);
  const origin = exhaust.children[0].getWorldPosition(new Vector3());
  const tip = exhaust.children[0].children[0].localToWorld(new Vector3(0, 0, -1));
  assert.ok(tip.sub(origin).normalize().dot(backward) > 0.999999);
  disposeModel(root);
});

test('airliners have subtle fire at every engine and B-2 has flat blue outlet marks', async () => {
  for (const [file, vehicle, wingspan, count] of [
    ['boeing-737-800', 'boeing737', 40, 2],
    ['airbus-a380', 'a380', 80, 4],
    ['northrop-grumman-b-2-spirit', 'b2', 52.4, 2],
  ]) {
    const { model, root, exhaust } = await importedExhaust(file, vehicle, wingspan);
    updateJetExhaust(root, true, 0.75, 1);
    const box = new Box3().setFromObject(model);
    const dimensions = box.getSize(new Vector3());
    const halfSpan = dimensions.x / 2;
    const halfHeight = dimensions.y / 2;
    const halfLength = dimensions.z / 2;
    assert.equal(exhaust.children.length, count, vehicle);
    assert.equal(exhaust.userData.flames.length, count * 2);
    assert.ok(exhaust.userData.flameNozzles.every(outlet =>
      outlet.shell.scale.z > 0 && Number.isFinite(outlet.x + outlet.y + outlet.z)));
    if (vehicle === 'a380') {
      const inner = exhaust.children.filter(nozzle => Math.abs(nozzle.position.x) / halfSpan < 0.55);
      const outer = exhaust.children.filter(nozzle => Math.abs(nozzle.position.x) / halfSpan >= 0.55);
      assert.equal(inner.length, 2);
      assert.equal(outer.length, 2);
      assert.ok(inner.every(nozzle => Math.abs(nozzle.position.x) / halfSpan > 0.36
        && nozzle.position.y / halfHeight < -0.62
        && nozzle.position.y / halfHeight > -0.9
        && nozzle.position.z / halfLength < -0.13
        && nozzle.position.z / halfLength > -0.27),
      'A380 inner flames originate at the aft lips of the inboard engines');
      assert.ok(outer.every(nozzle => Math.abs(nozzle.position.x) / halfSpan > 0.59
        && Math.abs(nozzle.position.x) / halfSpan < 0.74
        && nozzle.position.y / halfHeight < -0.62
        && nozzle.position.y / halfHeight > -0.9
        && nozzle.position.z / halfLength > -0.02
        && nozzle.position.z / halfLength < 0.10),
      'A380 outer flames originate at the aft lips of the outboard engines');
    } else if (vehicle === 'boeing737') {
      assert.ok(exhaust.children.every(nozzle => Math.abs(nozzle.position.x) / halfSpan > 0.29
        && Math.abs(nozzle.position.x) / halfSpan < 0.42
        && nozzle.position.y / halfHeight < -0.70
        && nozzle.position.y / halfHeight > -0.94
        && nozzle.position.z / halfLength < -0.06
        && nozzle.position.z / halfLength > -0.14),
      'Boeing flames originate at both engine outlets, not behind the wing');
    }
    if (vehicle === 'b2') {
      assert.equal(exhaust.userData.layout.blueOnly, true);
      assert.equal(exhaust.children[0].children[2].material.uniforms.uBlueOnly.value, 1,
        'B-2 nozzle glow is blue instead of the pale airliner color');
      assert.ok(exhaust.userData.flameNozzles.every(outlet => outlet.shell.scale.y < 0.3),
        'B-2 outlet marks are slim blue slots, not round afterburners');
      assert.ok(exhaust.children.every(nozzle => nozzle.position.z / halfLength > 0.66
        && nozzle.position.z / halfLength < 0.79
        && nozzle.position.y / halfHeight > 0.05
        && nozzle.position.y / halfHeight < 0.3),
      'B-2 blue marks begin inside the recessed exhaust slots');
      assert.ok(exhaust.children.every(nozzle => {
        const tip = nozzle.children[0].localToWorld(new Vector3(0, 0, -1));
        return tip.z < box.max.z - 1;
      }), 'B-2 blue plume ends before the wing trailing edge');
    } else {
      assert.ok(exhaust.userData.layout.opacity < 0.5, 'passenger-jet flames stay subtle');
    }
    root.position.set(3875, 628, -904);
    root.rotation.set(0.33, -0.52, 0.17);
    root.updateMatrixWorld(true);
    for (let index = 0; index < count; index++) {
      const marker = model.getObjectByName(`EXHAUST_NOZZLE_${index + 1}`);
      assert.ok(marker, `${vehicle} must carry a real nozzle marker`);
      const actual = exhaust.children[index].getWorldPosition(new Vector3());
      const expected = marker.getWorldPosition(new Vector3());
      assert.ok(actual.distanceTo(expected) < 0.00001,
        `${vehicle} fire remains anchored to the nozzle while the aircraft moves`);
    }
    disposeModel(root);
  }
});

test('throttle changes bounded flames; inactive and hidden aircraft extinguish immediately', async () => {
  const { root, exhaust } = await fighter();
  assert.equal(exhaust.visible, false);
  updateJetExhaust(root, true, 0, 0);
  const idleLength = exhaust.userData.flames[0].scale.z;
  updateJetExhaust(root, true, 1, 0);
  assert.ok(exhaust.userData.flames[0].scale.z > idleLength * 2);
  for (const invalid of [NaN, Infinity, -Infinity, undefined, -5, 500]) {
    updateJetExhaust(root, true, invalid, invalid);
    assert.ok(exhaust.userData.power.value >= 0 && exhaust.userData.power.value <= 1);
    assert.ok(exhaust.userData.flames.every(flame =>
      Number.isFinite(flame.scale.z) && flame.scale.z >= 0.3 && flame.scale.z < 1.31));
  }
  updateJetExhaust(root, false, 1, 100);
  assert.equal(exhaust.visible, false);
  root.visible = false;
  updateJetExhaust(root, true, 1, 100);
  assert.equal(exhaust.visible, false);
  root.visible = true;
  updateJetExhaust(root, true, 0.25, 100);
  assert.equal(exhaust.visible, true);
  disposeModel(root);
});

test('600 updates reuse six draws and private shared resources dispose once independently per aircraft', async () => {
  const a = await fighter(), b = await fighter();
  assert.equal(attachJetExhaust(a.root, a.model), a.exhaust, 'attachment is idempotent');
  const meshes = [], geometries = new Set(), materials = new Set();
  a.exhaust.traverse(object => {
    if (!object.isMesh) return;
    meshes.push(object); geometries.add(object.geometry); materials.add(object.material);
  });
  assert.equal(meshes.length, 6);
  assert.equal(geometries.size, 2);
  assert.equal(materials.size, 3);
  const references = meshes.map(mesh => [mesh.geometry, mesh.material]);
  for (let frame = 0; frame < 600; frame++) {
    updateJetExhaust(a.root, true, frame / 600, frame / 60);
    for (let i = 0; i < meshes.length; i++) {
      assert.equal(meshes[i].geometry, references[i][0]);
      assert.equal(meshes[i].material, references[i][1]);
      assert.equal(meshes[i].material.depthWrite, false);
      assert.equal(meshes[i].material.depthTest, true);
      assert.equal(meshes[i].material.forceSinglePass, true);
    }
  }
  const disposalCounts = new Map([...geometries, ...materials].map(resource => [resource, 0]));
  for (const resource of disposalCounts.keys()) resource.addEventListener('dispose', () =>
    disposalCounts.set(resource, disposalCounts.get(resource) + 1));
  let otherDisposed = false;
  b.exhaust.children[0].children[0].material.addEventListener('dispose', () => { otherDisposed = true; });
  disposeModel(a.root);
  assert.deepEqual([...disposalCounts.values()], [1, 1, 1, 1, 1]);
  assert.equal(otherDisposed, false);
  disposeModel(b.root);
});
