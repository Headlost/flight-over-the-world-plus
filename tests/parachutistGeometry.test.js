import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

globalThis.self ||= globalThis;
globalThis.createImageBitmap ||= async () => ({ width: 1, height: 1, close() {} });

test('the corrected parachutist brings boots together without making them thin', async () => {
  const bytes = await readFile(new URL('../public/models/parachutist-body.glb', import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  scene.updateMatrixWorld(true);
  const mesh = scene.getObjectByProperty('isMesh', true);
  assert.ok(mesh, 'the replacement body mesh must load');
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  const positions = geometry.attributes.position;
  const bootOffsets = [];
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const y = positions.getY(vertex);
    if (y > -0.35 && y < -0.15) bootOffsets.push(Math.abs(positions.getX(vertex)));
  }
  assert.ok(bootOffsets.length > 500);
  bootOffsets.sort((a, b) => a - b);
  const at = fraction => bootOffsets[Math.floor(bootOffsets.length * fraction)];
  assert.ok(at(0.50) > 0.16 && at(0.50) < 0.20,
    `boot centre is ${at(0.50)} m from the midline`);
  assert.ok(at(0.95) - at(0.05) > 0.19,
    `boot cross-section was compressed to ${at(0.95) - at(0.05)} m`);
  geometry.dispose();
});
