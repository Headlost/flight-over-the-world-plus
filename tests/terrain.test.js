import test from 'node:test';
import assert from 'node:assert/strict';
import { FAILED, LOADED, LOADING, QUEUED, UNLOADED } from '3d-tiles-renderer';
import { UpdateOnChangePlugin } from '3d-tiles-renderer/plugins';
import { TerrainRenderer } from '../src/game/terrainRenderer.js';

function tile(children = []) {
  return { boundingVolume: { sphere: [0, 0, 0, 500] }, geometricError: 100, children };
}

test('terrain retry tolerates partially preprocessed hierarchies and preserves active downloads', () => {
  const renderer = new TerrainRenderer();
  const untouched = tile([tile()]);
  const children = [tile(), tile(), tile(), tile(), untouched];
  const root = tile(children);
  renderer.preprocessNode(root, 'https://terrain.example');
  renderer.rootTileset = { asset: { version: '1.0' }, root };
  for (const child of children.slice(0, 4)) renderer.preprocessNode(child, 'https://terrain.example', root);
  const states = [FAILED, LOADED, LOADING, QUEUED];
  children.slice(0, 4).forEach((child, index) => { child.internal.loadingState = states[index]; });
  renderer.stats.failed = 1;
  const processed = renderer.processedTiles.size;
  let updates = 0;
  renderer.addEventListener('needs-update', () => { updates += 1; });

  assert.doesNotThrow(() => renderer.resetFailedTiles());
  assert.deepEqual(children.slice(0, 4).map(child => child.internal.loadingState), [UNLOADED, LOADED, LOADING, QUEUED]);
  assert.equal(renderer.stats.failed, 0);
  assert.equal(untouched.internal, undefined);
  assert.equal(untouched.children[0].internal, undefined);
  assert.equal(renderer.processedTiles.size, processed);
  assert.equal(updates, 1);

  // A retry remains safe if another download fails before preprocessing ends.
  children[2].internal.loadingState = FAILED;
  renderer.stats.failed = 1;
  renderer.resetFailedTiles();
  assert.equal(children[2].internal.loadingState, UNLOADED);
  assert.equal(updates, 2);
});

test('a failed terrain root retries even with an unchanged camera and no failed children', () => {
  const renderer = new TerrainRenderer();
  const plugin = new UpdateOnChangePlugin();
  renderer.registerPlugin(plugin);
  renderer.rootLoadingState = FAILED;
  assert.equal(renderer.stats.failed, 0);
  assert.equal(plugin.doTilesNeedUpdate(), false);
  renderer.resetFailedTiles();
  assert.equal(renderer.rootLoadingState, UNLOADED);
  assert.equal(plugin.doTilesNeedUpdate(), true);
  renderer.resetFailedTiles();
  assert.equal(plugin.doTilesNeedUpdate(), false);
  renderer.unregisterPlugin(plugin);
});

test('cancelled terrain downloads wake an unchanged view exactly once', () => {
  const renderer = new TerrainRenderer();
  const plugin = new UpdateOnChangePlugin();
  renderer.registerPlugin(plugin);
  const queued = tile();
  const loading = tile();
  const loaded = tile();
  for (const item of [queued, loading, loaded]) {
    renderer.preprocessNode(item, 'https://terrain.example');
    renderer.loadingTiles.add(item);
    renderer.lruCache.add(item, removed => {
      removed.internal.loadingState = UNLOADED;
      renderer.loadingTiles.delete(removed);
    });
  }
  queued.internal.loadingState = QUEUED;
  loading.internal.loadingState = LOADING;
  loaded.internal.loadingState = LOADED;
  let updates = 0;
  renderer.addEventListener('needs-update', () => { updates += 1; });
  assert.equal(plugin.doTilesNeedUpdate(), true);
  assert.equal(plugin.doTilesNeedUpdate(), false);

  renderer.stopPendingDownloads();

  assert.equal(queued.internal.loadingState, UNLOADED);
  assert.equal(loading.internal.loadingState, UNLOADED);
  assert.equal(loaded.internal.loadingState, LOADED);
  assert.equal(updates, 1);
  assert.equal(plugin.doTilesNeedUpdate(), true);

  renderer.stopPendingDownloads();
  assert.equal(updates, 1);
  assert.equal(plugin.doTilesNeedUpdate(), false);
  renderer.unregisterPlugin(plugin);
});
