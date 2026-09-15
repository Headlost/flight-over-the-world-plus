import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Object3D, Scene, Vector3 } from 'three';
import { AerobaticSmoke } from '../src/game/aerobaticSmoke.js';

function rig(t, mobile = false) {
  t.mock.method(Math, 'random', () => 0.5);
  const scene = new Scene();
  const model = new Group();
  model.position.set(6378137.12345, 1300000.789, 800000.456);
  scene.add(model);
  const emitters = [-1, 1].map(side => {
    const emitter = new Object3D();
    emitter.position.set(side * 0.61, -0.39, -0.265);
    model.add(emitter);
    return emitter;
  });
  model.userData.smokeEmitters = emitters;
  const smoke = new AerobaticSmoke(scene, { mobile });
  t.after(() => smoke.dispose());
  return { scene, model, emitters, smoke };
}

function worldPuff(smoke, index) {
  const positions = smoke.geometry.attributes.position.array;
  return new Vector3(
    smoke.points.position.x + positions[index * 3],
    smoke.points.position.y + positions[index * 3 + 1],
    smoke.points.position.z + positions[index * 3 + 2],
  );
}

test('both nozzles emit, and existing smoke stays in the world through aircraft translation and inversion', t => {
  const { model, emitters, smoke } = rig(t);
  smoke.update(1 / 90, model, { active: true, speed: 120, viewportHeight: 1440 });
  assert.equal(smoke.debug().count, 2);
  assert.equal(smoke.debug().emitterCount, 2);
  const original = [worldPuff(smoke, 0), worldPuff(smoke, 1)];
  assert.ok(Math.abs(original[0].distanceTo(original[1]) - 1.22) < 0.00001);
  for (let index = 0; index < 2; index++) {
    const nozzle = emitters[index].getWorldPosition(new Vector3());
    assert.ok(original[index].distanceTo(nozzle) < 0.1);
  }

  model.position.add(new Vector3(600, 1000, -700));
  model.rotation.set(0.8, -1.3, Math.PI);
  smoke.update(0, model, { active: false });
  assert.equal(smoke.debug().count, 2);
  for (let index = 0; index < 2; index++) {
    assert.ok(worldPuff(smoke, index).distanceTo(original[index]) < 0.0002,
      'previous trail must not turn or travel with the aircraft');
  }

  smoke.update(1 / 90, model, { active: true, speed: 120 });
  assert.equal(smoke.debug().count, 4);
  for (let index = 0; index < 2; index++) {
    const nozzle = emitters[index].getWorldPosition(new Vector3());
    assert.ok(worldPuff(smoke, index + 2).distanceTo(nozzle) < 0.1,
      'new smoke follows the inverted nozzles');
  }
});

test('submeter nozzle details survive huge ECEF positions through relative GPU coordinates', t => {
  const { model, emitters, smoke } = rig(t);
  smoke.update(1 / 90, model, { active: true });
  const positions = smoke.geometry.attributes.position.array;
  assert.ok(positions instanceof Float32Array);
  assert.equal(smoke.points.position.x, model.position.x);
  const up = model.position.clone().normalize();
  for (let index = 0; index < 2; index++) {
    const expected = emitters[index].getWorldPosition(new Vector3()).addScaledVector(up, -0.055);
    assert.ok(worldPuff(smoke, index).distanceTo(expected) < 0.000002,
      'GPU coordinates preserve the nozzle position rather than rounding ECEF meters');
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(positions[index * 3 + axis]) < 2);
    }
  }
});

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} smoke remains bounded and reuses GPU buffers through 600 maneuvering frames`, t => {
    const { model, smoke } = rig(t, mobile);
    const geometry = smoke.geometry;
    const material = smoke.material;
    const points = smoke.points;
    const debug = smoke.debug();
    const attributes = Object.values(geometry.attributes);
    const arrays = attributes.map(attribute => attribute.array);
    const buffers = arrays.map(array => array.buffer);
    assert.equal(debug.cap, mobile ? 384 : 640);
    for (let frame = 0; frame < 600; frame++) {
      model.position.z -= 2;
      model.rotation.set(Math.sin(frame / 30), frame / 50, frame / 12);
      smoke.update(1 / 60, model, { active: true, speed: 120, viewportHeight: 1440 });
      assert.ok(debug.count <= debug.cap);
      assert.equal(debug.emitterCount, 2);
      assert.equal(smoke.geometry, geometry);
      assert.equal(smoke.material, material);
      assert.equal(smoke.points, points);
      assert.equal(smoke.debug(), debug);
      assert.equal(geometry.drawRange.count, debug.count);
      for (let attribute = 0; attribute < attributes.length; attribute++) {
        assert.equal(attributes[attribute].array, arrays[attribute]);
        assert.equal(attributes[attribute].array.buffer, buffers[attribute]);
      }
      const positions = geometry.attributes.position.array;
      for (let index = 0; index < debug.count * 3; index++) {
        assert.ok(Number.isFinite(positions[index]));
        assert.ok(Math.abs(positions[index]) < 1000);
      }
    }
    const steadyCount = 2 * (mobile ? 60 : 90) * 3;
    assert.ok(Math.abs(debug.count - steadyCount) <= 6);
    assert.equal(material.depthTest, true);
    assert.equal(material.depthWrite, false);
  });
}

test('inactive smoke ages out, explicit clearing empties the draw, and resumption has no catch-up burst', t => {
  const { model, smoke } = rig(t);
  for (let frame = 0; frame < 60; frame++) {
    smoke.update(1 / 60, model, { active: true, speed: 60 });
  }
  const count = smoke.debug().count;
  assert.ok(count > 50);
  smoke.update(0.5, model, { active: false });
  assert.equal(smoke.debug().count, count);
  assert.equal(smoke.debug().emitterCount, 0);
  smoke.update(3, model, { active: false });
  assert.equal(smoke.debug().count, 0);
  assert.equal(smoke.geometry.drawRange.count, 0);
  assert.equal(smoke.points.visible, false);

  smoke.update(3600, model, { active: true, speed: 60 });
  assert.ok(smoke.debug().count > 0 && smoke.debug().count <= 20,
    'a background-tab pause must not emit an hour of smoke on resumption');
  smoke.clear();
  assert.equal(smoke.debug().count, 0);
  assert.equal(smoke.debug().emitterCount, 0);
  assert.equal(smoke.geometry.drawRange.count, 0);
  assert.equal(smoke.points.visible, false);
});
