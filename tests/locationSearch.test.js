import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocationSearch, geocodeCity, normalizePlaceQuery, parseCoordinates, rankLocationResults } from '../src/game/locationSearch.js';

test('hemisphere coordinates use west/south signs instead of place-name search', async () => {
  for (const text of ['29.0000° N, 79.0000° W  ', '29 N 79 W', 'N29, W79', '79 W, 29 N', '29 north, 79 west', '29 północ, 79 zachód']) {
    assert.deepEqual(parseCoordinates(text), { lat: 29, lon: -79 }, text);
  }
  assert.deepEqual(parseCoordinates('33.86 S, 151.21 E'), { lat: -33.86, lon: 151.21 });
  assert.deepEqual(await geocodeCity('29.0000° N, 79.0000° W'), { lat: 29, lon: -79 });
});

test('decimal pairs, Polish decimal commas, unicode minus and DMS are supported', () => {
  for (const text of ['29, -79', '29 -79', '29°, −79°', '29,0; -79,0', '29,0 N, 79,0 W', '29°0′0″N 79°0′0″W', '29 0 0 N, 79 0 0 W']) {
    assert.deepEqual(parseCoordinates(text), { lat: 29, lon: -79 }, text);
  }
  assert.deepEqual(parseCoordinates('52,23; 21,01'), { lat: 52.23, lon: 21.01 });
  const dms = parseCoordinates('29°30′15″N 79°10′30″W');
  assert.ok(Math.abs(dms.lat - 29.5041666667) < 1e-8);
  assert.ok(Math.abs(dms.lon + 79.175) < 1e-8);
  assert.deepEqual(parseCoordinates('90 N, 180 W'), { lat: 90, lon: -180 });
});

test('invalid or contradictory coordinates fail locally and never become a name query', async () => {
  let requests = 0;
  const search = createLocationSearch({ fetchImpl: () => { requests++; throw new Error('unexpected fetch'); } });
  for (const text of ['91, 0', '0, 181', '91 N 0 E', '29 N, 79 N', '-29 N, 79 W', '29°60′N 79°W', '29°0′60″N 79°W', '90°0′1″N 79°W', '29°N', '29°N, 79°X', '29,0,79,0']) {
    await assert.rejects(search(text), /Coordinates/, text);
  }
  assert.deepEqual(await search('29 N, 79 W'), [{ lat: 29, lon: -79, label: 'Coordinates' }]);
  assert.equal(requests, 0);
});

test('place names, addresses and postcodes are not mistaken for coordinates', () => {
  for (const text of ['Waszyngton', 'Warszawa', 'Essen', 'Sewen', '10 Downing Street, London', '123 N Main St', '90210', '00-001', 'SW1A 1AA']) {
    assert.equal(parseCoordinates(text), null, text);
  }
  assert.equal(normalizePlaceQuery(' WASZYNGTON '), 'Washington DC');
  assert.equal(normalizePlaceQuery('Nowy   Jork'), 'New York City');
  assert.equal(normalizePlaceQuery('PARYŻ'), 'Paris');
  assert.equal(normalizePlaceQuery('Paryz'), 'Paris');
  assert.equal(normalizePlaceQuery('Londyn'), 'London');
  assert.equal(normalizePlaceQuery('Waszyngton, Polska'), 'Waszyngton, Polska');
  assert.equal(normalizePlaceQuery('Nowy Jork, Polska'), 'Nowy Jork, Polska');
  assert.equal(normalizePlaceQuery('10 Downing Street, London'), '10 Downing Street, London');
});

const feature = (name, type, lat, lon, country = 'United States') => ({
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { name, osm_value: type, country },
});
const washington = [
  feature('Washington', 'cafe', 52.24, 21.07, 'Poland'),
  feature('Washington', 'state', 47.28, -120.21),
  feature('Washington', 'city', 38.895, -77.036),
];

test('city outranks a cafe or a state for an unqualified city search; alternatives retain country labels', () => {
  const ranked = rankLocationResults(washington, 'Washington');
  assert.deepEqual(ranked[0], { lat: 38.895, lon: -77.036, label: 'Washington, United States' });
  assert.equal(ranked.length, 3);
  assert.match(ranked[2].label, /Poland/);
  assert.equal(rankLocationResults(washington, 'Washington, Polska')[0].lat, 52.24, 'explicit qualifiers retain provider order');
  assert.equal(rankLocationResults([feature('Eiffel Tower', 'attraction', 48.85, 2.29), feature('Paris', 'city', 48.8, 2.3)], 'Eiffel Tower')[0].label, 'Eiffel Tower, United States');
});

test('malformed provider positions are ignored, duplicate coordinates collapse and HTML is plain label data', () => {
  const valid = feature('<img src=x onerror=alert(1)>', 'city', 10, 20);
  assert.deepEqual(rankLocationResults([null, {}, feature('Invalid', 'city', 91, 0), feature('Invalid', 'city', 0, '12'), valid, valid], 'test'), [
    { lat: 10, lon: 20, label: '<img src=x onerror=alert(1)>, United States' },
  ]);
});

test('search asks for alternatives, normalizes Polish names and coalesces cached queries', async () => {
  const urls = [];
  const search = createLocationSearch({ minIntervalMs: 0, fetchImpl: async url => {
    urls.push(new URL(url));
    return { ok: true, json: async () => ({ features: washington }) };
  } });
  const [a, b] = await Promise.all([search('Waszyngton'), search('Washington DC')]);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].searchParams.get('q'), 'Washington DC');
  assert.equal(urls[0].searchParams.get('limit'), '8');
  assert.equal(urls[0].searchParams.has('lat'), false);
  assert.equal(urls[0].searchParams.has('countrycode'), false);
  assert.equal(a[0].lat, 38.895);
  a[0].lat = 0;
  assert.equal(b[0].lat, 38.895);
  assert.equal((await search('waszyngton'))[0].lat, 38.895);
});

test('provider errors do not poison the request queue or cache', async () => {
  let requests = 0;
  const search = createLocationSearch({ minIntervalMs: 0, fetchImpl: async () => {
    requests++;
    return requests === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => ({ features: washington }) };
  } });
  await assert.rejects(search('Washington'), /Search is busy/);
  assert.equal((await search('Washington'))[0].lat, 38.895);
  assert.equal(requests, 2);
});
