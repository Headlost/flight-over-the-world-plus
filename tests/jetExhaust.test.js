import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Group, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attachJetExhaust, updateJetExhaust } from '../src/game/jetExhaust.js';
import { disposeModel } from '../src/game/dispose.js';

async function fighter() {
  const bytes = await readFile(new URL('../public/models/jet.glb', import.meta.url));
  const { scene: model } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  model.rotation.y = Math.PI;
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  model.scale.setScalar(10 / Math.max(size.x, size.y, size.z));
  box.setFromObject(model);
  model.position.sub(box.getCenter(new Vector3()));
  const root = new Group();
  root.add(model);
  return { model, root, exhaust: attachJetExhaust(root, model) };
}

test('fighter flames start inside both real GLB nozzle rims and follow the normalized aircraft rearward', async () => {
  const { model, root, exhaust } = await fighter();
  const mesh = model.getObjectByProperty('isMesh', true);
  assert.ok(mesh);
  const rimPoints = [];
  model.traverse(object => {
    if (!object.isMesh || object.name.startsWith('exhaust-')) return;
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(positions.getZ(i) + 4.953342) < 0.00001) {
        rimPoints.push(new Vector3().fromBufferAttribute(positions, i));
      }
    }
  });
  assert.ok(rimPoints.length > 16);
  updateJetExhaust(root, true, 1, 0);
  root.updateMatrixWorld(true);
  for (const nozzle of exhaust.children) {
    const points = rimPoints.filter(point => Math.sign(point.x) === Math.sign(nozzle.position.x));
    const radius = Math.min(...points.map(point => Math.hypot(
      point.x - nozzle.position.x, point.y - nozzle.position.y)));
    assert.ok(Math.abs(radius - 0.15033) < 0.000002, 'measured inner ring aligns with flame axis');
    assert.ok(nozzle.children[0].scale.x < radius, 'flame base fits inside the opening');
    const origin = nozzle.getWorldPosition(new Vector3());
    const tip = nozzle.children[0].localToWorld(new Vector3(0, 0, -1));
    assert.ok(origin.z > 4.9 && origin.z < 5.1);
    assert.ok(tip.z > origin.z + 1 && tip.z < origin.z + 1.2);
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
