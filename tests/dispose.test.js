import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture } from "three";
import { disposeModel } from "../src/game/dispose.js";

function watch(resource) {
  const count = { disposed: 0 };
  resource.addEventListener("dispose", () => count.disposed++);
  return count;
}

test("disposing either aircraft preserves its shared page-lifetime texture and frees each private resource once", () => {
  const scene = new Group();
  const shared = new Texture();
  shared.userData.sharedModelTexture = true;
  const sharedEvents = watch(shared);
  const models = [0, 1].map(() => {
    const root = new Group(), geometry = new BoxGeometry(), privateTexture = new Texture();
    const material = new MeshBasicMaterial({ map: shared, alphaMap: privateTexture });
    const events = [geometry, privateTexture, material].map(watch);
    root.add(new Mesh(geometry, material), new Mesh(geometry, material));
    scene.add(root);
    return { root, events, material };
  });
  disposeModel(models[0].root);
  assert.equal(models[0].root.parent, null);
  assert.deepEqual(models[0].events.map(event => event.disposed), [1, 1, 1]);
  assert.deepEqual(models[1].events.map(event => event.disposed), [0, 0, 0]);
  assert.equal(scene.children.length, 1);
  assert.equal(models[1].material.map, shared);
  assert.equal(sharedEvents.disposed, 0, "the remaining aircraft keeps its texture without a GPU-cache invalidation");

  disposeModel(models[1].root);
  assert.deepEqual(models[1].events.map(event => event.disposed), [1, 1, 1]);
  assert.equal(scene.children.length, 0);
  assert.equal(sharedEvents.disposed, 0, "an explicitly cached texture lives until page teardown");
});

test("ordinary textures still dispose once; only the exact sharedModelTexture boolean opts out", () => {
  for (const marker of [undefined, false, "true", 1]) {
    const parent = new Group(), root = new Group(), geometry = new BoxGeometry();
    const texture = new Texture();
    if (marker !== undefined) texture.userData.sharedModelTexture = marker;
    const material = new MeshBasicMaterial({ map: texture, alphaMap: texture });
    const events = [geometry, texture, material].map(watch);
    root.add(new Mesh(geometry, material), new Mesh(geometry, material));
    parent.add(root);
    disposeModel(root);
    assert.deepEqual(events.map(event => event.disposed), [1, 1, 1]);
    assert.equal(root.parent, null);
    assert.equal(parent.children.length, 0);
  }
  assert.doesNotThrow(() => disposeModel(null));
});
