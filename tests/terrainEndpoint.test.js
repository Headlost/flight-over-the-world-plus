import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_TERRAIN_POOL_PROXY_PATH,
  resolveTerrainPoolEndpoint,
} from '../src/game/terrainEndpoint.js';

const broker = 'https://box.zakai.eu/webhook/fotw-terrain-session-pool';

test('explicit local mode sends only the shared broker through the loopback proxy', () => {
  assert.equal(resolveTerrainPoolEndpoint(broker, {
    localProxy: true,
    pageURL: 'http://127.0.0.1:5173/flight/',
  }), 'http://127.0.0.1:5173' + LOCAL_TERRAIN_POOL_PROXY_PATH);
  assert.equal(resolveTerrainPoolEndpoint(broker, {
    localProxy: true,
    pageURL: 'http://localhost:5173/',
  }), 'http://localhost:5173' + LOCAL_TERRAIN_POOL_PROXY_PATH);
});

test('online pages, disabled local mode and fixture brokers keep the direct endpoint', () => {
  assert.equal(resolveTerrainPoolEndpoint(broker, {
    localProxy: false,
    pageURL: 'http://127.0.0.1:5173/',
  }), broker);
  assert.equal(resolveTerrainPoolEndpoint(broker, {
    localProxy: true,
    pageURL: 'https://headlost.github.io/flight-over-the-world-plus/',
  }), broker);
  const fixture = 'https://terrain-pool.fixture.invalid/session';
  assert.equal(resolveTerrainPoolEndpoint(fixture, {
    localProxy: true,
    pageURL: 'http://127.0.0.1:5187/',
  }), fixture);
});

test('lookalike targets and non-loopback pages can never opt into the proxy', () => {
  for (const endpoint of [
    'https://box.zakai.eu.evil.example/webhook/test',
    'http://box.zakai.eu/webhook/test',
    'https://user@box.zakai.eu/webhook/test',
  ]) {
    assert.equal(resolveTerrainPoolEndpoint(endpoint, {
      localProxy: true,
      pageURL: 'http://127.0.0.1:5173/',
    }), endpoint);
  }
  assert.equal(resolveTerrainPoolEndpoint(broker, {
    localProxy: true,
    pageURL: 'http://192.168.1.10:5173/',
  }), broker);
});
