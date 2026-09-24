import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Scene, Vector3 } from 'three';
import { AirlinerContrails } from '../src/game/airlinerContrails.js';

function rig(t, engines = 4, mobile = false) {
  t.mock.method(Math, 'random', () => 0.5);
  const scene = new Scene();
  const model = new Group();
  model.position.set(6378137.12345, 1300000.789, 800000.456);
  scene.add(model);
  const exhaust = new Group();
  model.add(exhaust);
  model.userData.jetExhaust = exhaust;
  const nozzles = Array.from({ length: engines }, (_, index) => {
    const nozzle = new Group();
    nozzle.position.set((index - (engines - 1) / 2) * 4, -2, 12);
    exhaust.add(nozzle);
    return nozzle;
  });
  const trails = new AirlinerContrails(scene, { mobile });
  t.after(() => trails.dispose());
  return { scene, model, nozzles, trails };
}

function worldPuff(trails, index) {
  const positions = trails.geometry.attributes.position.array;
  return new Vector3(
    trails.points.position.x + positions[index * 3],
    trails.points.position.y + positions[index * 3 + 1],
    trails.points.position.z + positions[index * 3 + 2],
  );
}

for (const engines of [2, 4]) {
  test(`${engines} real nozzles create ${engines} independent white stripes in world space`, t => {
    const { model, nozzles, trails } = rig(t, engines);
    const sample = engines === 2 ? 1 / 100 : 1 / 70;
    trails.update(sample, model, { active: true, speed: 220, throttle: 1, viewportHeight: 1440 });
    assert.equal(trails.debug().count, engines);
    assert.equal(trails.debug().emitterCount, engines);
    assert.equal(trails.material.uniforms.uViewportHeight.value, 1440);
    const original = nozzles.map((nozzle, index) => {
      const puff = worldPuff(trails, index);
      assert.ok(puff.distanceTo(nozzle.getWorldPosition(new Vector3())) < 0.1,
        'the first puff starts at the real jet outlet');
      return puff;
    });

    model.position.add(new Vector3(800, 600, -1200));
    model.rotation.set(0.5, -0.8, 1.2);
    trails.update(0, model, { active: false });
    assert.equal(trails.debug().count, engines, 'released throttle leaves the old trail visible');
    assert.equal(trails.debug().emitterCount, 0);
    for (let index = 0; index < engines; index++) {
      assert.ok(worldPuff(trails, index).distanceTo(original[index]) < 0.0002,
        'existing contrails must not rotate or move with the aircraft');
    }

    trails.update(sample, model, { active: true, speed: 220, throttle: 1 });
    assert.equal(trails.debug().count, engines * 2);
    for (let index = 0; index < engines; index++) {
      assert.ok(worldPuff(trails, engines + index).distanceTo(nozzles[index].getWorldPosition(new Vector3())) < 0.1,
        'emission resumes at the new rotated nozzle position');
    }
  });
}

test('engine trails preserve submeter outlet spacing at Earth-scale coordinates', t => {
  const { model, nozzles, trails } = rig(t, 4);
  trails.update(1 / 70, model, { active: true, throttle: 0.8 });
  const positions = trails.geometry.attributes.position.array;
  assert.ok(positions instanceof Float32Array);
  assert.equal(trails.points.position.x, model.position.x);
  for (let index = 0; index < nozzles.length; index++) {
    const expected = nozzles[index].getWorldPosition(new Vector3());
    assert.ok(worldPuff(trails, index).distanceTo(expected) < 0.1);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(positions[index * 3 + axis]) < 20,
        'GPU coordinates stay relative to the plane rather than rounding ECEF meters');
    }
  }
});

for (const mobile of [false, true]) {
  for (const engines of [2, 4]) {
    test(`${mobile ? 'mobile' : 'desktop'} ${engines}-engine trails remain bounded with one reused draw call`, t => {
      const { model, trails } = rig(t, engines, mobile);
      const geometry = trails.geometry;
      const material = trails.material;
      const points = trails.points;
      const debug = trails.debug();
      const attributes = Object.values(geometry.attributes);
      const arrays = attributes.map(attribute => attribute.array);
      assert.equal(debug.cap, mobile ? 2048 : 3584);
      for (let frame = 0; frame < 840; frame++) {
        model.position.z -= 4;
        model.rotation.y = frame / 400;
        trails.update(1 / 60, model, { active: true, speed: 250, throttle: 1, viewportHeight: 1440 });
        assert.ok(debug.count <= debug.cap);
        assert.equal(debug.emitterCount, engines);
        assert.equal(trails.geometry, geometry);
        assert.equal(trails.material, material);
        assert.equal(trails.points, points);
        assert.equal(geometry.drawRange.count, debug.count);
        for (let index = 0; index < attributes.length; index++) {
          assert.equal(attributes[index].array, arrays[index]);
        }
        const positions = geometry.attributes.position.array;
        for (let index = 0; index < debug.count * 3; index++) {
          assert.ok(Number.isFinite(positions[index]));
          assert.ok(Math.abs(positions[index]) < 10000);
        }
      }
      const rate = engines === 2 ? (mobile ? 80 : 100) : (mobile ? 40 : 70);
      const expected = engines * rate * 12;
      assert.ok(Math.abs(debug.count - expected) <= 8);
      assert.equal(material.depthTest, true);
      assert.equal(material.depthWrite, false);
    });
  }
}

test('inactive trails age out; clearing, replacement and disposal release visibility cleanly', t => {
  const { scene, model, trails } = rig(t, 2);
  for (let frame = 0; frame < 60; frame++) {
    trails.update(1 / 60, model, { active: true, throttle: 1 });
  }
  const count = trails.debug().count;
  assert.ok(count > 100);
  trails.update(3, model, { active: false });
  assert.equal(trails.debug().count, count);
  trails.update(10, model, { active: false });
  assert.equal(trails.debug().count, 0);
  assert.equal(trails.geometry.drawRange.count, 0);
  assert.equal(trails.points.visible, false);

  trails.update(1 / 100, model, { active: true, throttle: 1 });
  assert.equal(trails.debug().count, 2);
  const replacement = new Group();
  scene.add(replacement);
  trails.update(0, replacement, { active: false });
  assert.equal(trails.debug().count, 0, 'a different aircraft must not inherit the old trail');
  trails.clear();
  assert.equal(trails.geometry.drawRange.count, 0);
  assert.equal(trails.points.visible, false);
  trails.dispose();
  assert.equal(trails.points.parent, null);
});

test('a resumed background tab emits no catch-up burst or teleport bridge', t => {
  const { model, trails } = rig(t, 4);
  trails.update(1 / 70, model, { active: true, throttle: 1 });
  model.position.x += 10000;
  trails.update(3600, model, { active: true, throttle: 1 });
  assert.equal(trails.debug().count, 0);
  trails.update(1 / 70, model, { active: true, throttle: 1 });
  assert.equal(trails.debug().count, 4);
  assert.ok(worldPuff(trails, 0).distanceTo(model.position) < 30);
});

test('a hidden aircraft cannot emit new trail while its existing trail keeps fading', t => {
  const { model, trails } = rig(t, 2);
  trails.update(1 / 100, model, { active: true, throttle: 1 });
  assert.equal(trails.debug().count, 2);
  model.visible = false;
  trails.update(1, model, { active: true, throttle: 1 });
  assert.equal(trails.debug().count, 2);
  assert.equal(trails.debug().emitterCount, 0);
  model.visible = true;
  trails.update(1 / 100, model, { active: true, throttle: 1 });
  assert.equal(trails.debug().count, 4);
});
