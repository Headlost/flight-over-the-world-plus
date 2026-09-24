import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import browserConfig from '../playwright.config.js';
import brokerConfig from '../playwright.broker-only.config.js';

const cwd = fileURLToPath(new URL('..', import.meta.url));

function resolvedBrowserOpen(overrides = {}) {
  const env = { ...process.env };
  delete env.VITE_OPEN_BROWSER;
  Object.assign(env, overrides);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { resolveConfig } from 'vite';
    const config = await resolveConfig({ envFile: false, logLevel: 'silent' }, 'serve');
    process.stdout.write(JSON.stringify({ open: config.server.open }));
  `], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).open;
}

function resolvedTerrainProxy(overrides = {}) {
  const env = { ...process.env, VITE_TERRAIN_POOL_LOCAL_PROXY: 'false', ...overrides };
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { resolveConfig } from 'vite';
    const config = await resolveConfig({ envFile: false, logLevel: 'silent' }, 'serve');
    const proxy = config.server.proxy?.['/__fotw-terrain-session'];
    process.stdout.write(JSON.stringify({
      strictPort: config.server.strictPort,
      proxy: proxy ? {
        target: proxy.target,
        origin: proxy.headers?.Origin,
        rewritten: proxy.rewrite('/__fotw-terrain-session'),
      } : null,
    }));
  `], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('normal local startup opens the game and an explicit background setting resolves to boolean false', () => {
  assert.equal(resolvedBrowserOpen(), true);
  assert.equal(resolvedBrowserOpen({ VITE_OPEN_BROWSER: 'false' }), false);
});

test('both Playwright servers disable browser opening without passing false as a URL path', () => {
  for (const config of [browserConfig, brokerConfig]) {
    assert.doesNotMatch(config.webServer.command, /--open(?:\s|=)/);
    assert.equal(config.webServer.env.VITE_OPEN_BROWSER, 'false');
    assert.equal(resolvedBrowserOpen(config.webServer.env), false);
  }
});

test('the local launch flag enables only the admission proxy on the fixed Vite port', () => {
  const disabled = resolvedTerrainProxy({
    VITE_TERRAIN_POOL_ENDPOINT: 'https://box.zakai.eu/webhook/test',
  });
  assert.equal(disabled.strictPort, true);
  assert.equal(disabled.proxy, null);

  const enabled = resolvedTerrainProxy({
    VITE_TERRAIN_POOL_LOCAL_PROXY: 'true',
    VITE_TERRAIN_POOL_ENDPOINT: 'https://box.zakai.eu/webhook/test?source=local',
  });
  assert.deepEqual(enabled, {
    strictPort: true,
    proxy: {
      target: 'https://box.zakai.eu',
      origin: 'https://headlost.github.io',
      rewritten: '/webhook/test?source=local',
    },
  });
});
