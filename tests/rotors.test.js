import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Group, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyRotorState, spinRotors } from '../src/game/rotors.js';
import { disposeModel } from '../src/game/dispose.js';

async function importedVehicle(file, key, wingspan) {
  globalThis.self ||= globalThis;
  globalThis.createImageBitmap ||= async () => ({ width: 1, height: 1, close() {} });
  const bytes = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const { scene: model } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  model.scale.setScalar(wingspan / size.x);
  box.setFromObject(model);
  model.position.sub(box.getCenter(new Vector3()));
  const root = new Group();
  root.userData.key = key;
  root.add(model);
  return root;
}

test('new Hercules spins every rotor locator without moving the airframe', async () => {
  const root = await importedVehicle('lockheed-ac-130-hercules', 'ac130', 40.4);
  const airframe = root.getObjectByName('lockheed-ac-130-hercules-airframe');
  assert.ok(airframe);
  const before = new Box3().setFromObject(airframe).getCenter(new Vector3());
  applyRotorState(root, true);
  const holders = root.userData.spinRotors;
  assert.equal(holders.length, 4);
  assert.deepEqual(holders.map(holder => holder.userData.parts.length), [5, 5, 5, 5]);
  assert.ok(holders.every(holder => holder.userData.radius > 1));
  const blade = holders[0].userData.parts[0];
  const beforeBlade = new Box3().setFromObject(blade).getCenter(new Vector3());
  spinRotors(root, 1 / 60, 180);
  assert.ok(holders.every(holder => holder.rotation.z > 0));
  root.updateMatrixWorld(true);
  const afterSpin = new Box3().setFromObject(blade).getCenter(new Vector3());
  assert.ok(beforeBlade.distanceTo(afterSpin) > 0.01);
  const afterAirframe = new Box3().setFromObject(airframe).getCenter(new Vector3());
  assert.ok(before.distanceTo(afterAirframe) < 0.001,
    `airframe moved: before=${before.toArray()} after=${afterAirframe.toArray()}`);
  disposeModel(root);
});

test('Mooney spins its single nose propeller without moving the aircraft', async () => {
  const root = await importedVehicle('mooney-m20m', 'mooney', 11);
  applyRotorState(root, true);
  assert.equal(root.userData.spinRotors.length, 1);
  assert.equal(root.userData.spinRotors[0].userData.parts.length, 4);
  spinRotors(root, 1 / 60, 96);
  assert.ok(root.userData.spinRotors[0].rotation.z > 0);
  applyRotorState(root, false);
  assert.equal(root.userData.spinRotors[0].rotation.z, 0);
  disposeModel(root);
});
