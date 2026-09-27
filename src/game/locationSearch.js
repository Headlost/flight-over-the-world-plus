const COORDINATE_ERROR = 'Coordinates: use latitude, longitude (e.g. 29.0000 N, 79.0000 W). Latitude must be −90…90, longitude −180…180; minutes and seconds below 60.';
const fold = value => String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();

function coordinateAngle(text, direction = '') {
  const value = text.trim();
  const decimal = value.match(/^([+-]?(?:\d+(?:[.,]\d+)?|\.\d+))\s*°?$/);
  const dms = decimal ? null : value.match(/^([+-]?\d+)(?:\s*°\s*|\s+)(\d+(?:[.,]\d+)?)(?:(?:\s*'\s*|\s+)(\d+(?:[.,]\d+)?)\s*"?|\s*'?)$/);
  if (!decimal && !dms) throw new Error(COORDINATE_ERROR);
  const degrees = Number((decimal || dms)[1].replace(',', '.'));
  const minutes = Number(dms?.[2]?.replace(',', '.') || 0);
  const seconds = Number(dms?.[3]?.replace(',', '.') || 0);
  if (minutes >= 60 || seconds >= 60 || (seconds && !Number.isInteger(minutes))) throw new Error(COORDINATE_ERROR);
  const negative = value.startsWith('-');
  if ((negative && /[NE]/.test(direction)) || (value.startsWith('+') && /[SW]/.test(direction))) throw new Error(COORDINATE_ERROR);
  const sign = direction ? (/[SW]/.test(direction) ? -1 : 1) : (negative ? -1 : 1);
  return sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
}

export function parseCoordinates(text) {
  const value = fold(text).trim().replace(/[−–]/g, '-').replace(/º/g, '°')
    .replace(/[′’‘`]/g, "'").replace(/[″“”]/g, '"')
    .replace(/\b(?:north|polnoc|polnocna|pln)\b\.?/g, 'n')
    .replace(/\b(?:south|poludnie|poludniowa|pld)\b\.?/g, 's')
    .replace(/\b(?:east|wschod|wschodnia|wsch)\b\.?/g, 'e')
    .replace(/\b(?:west|zachod|zachodnia|zach)\b\.?/g, 'w').toUpperCase();
  if (!value) return null;
  let lat, lon;
  const angle = '([+\\-\\d\\s.,°\'\"]+?)';
  const suffix = value.match(new RegExp(`^${angle}\\s*([NSEW])\\s*[,;]?\\s*${angle}\\s*([NSEW])$`));
  const prefix = suffix ? null : value.match(new RegExp(`^([NSEW])\\s*${angle}\\s*[,;]?\\s*([NSEW])\\s*${angle}$`));
  if (suffix || prefix) {
    const parts = suffix ? [[suffix[1], suffix[2]], [suffix[3], suffix[4]]]
      : [[prefix[2], prefix[1]], [prefix[4], prefix[3]]];
    if (parts.filter(([, d]) => /[NS]/.test(d)).length !== 1) throw new Error(COORDINATE_ERROR);
    for (const [part, direction] of parts) {
      const number = coordinateAngle(part, direction);
      if (/[NS]/.test(direction)) lat = number;
      else lon = number;
    }
  } else {
    // A semicolon disambiguates Polish decimal commas. Plain whitespace is
    // also accepted for decimal pairs, but unlabelled order stays lat, lon.
    const decimalPair = value.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/);
    const parts = value.includes(';') ? value.split(';') : value.split(',');
    if (parts.length === 2 && parts.every(part => /^[+\-\d\s.,°'"]+$/.test(part))) {
      lat = coordinateAngle(parts[0]); lon = coordinateAngle(parts[1]);
    } else if (decimalPair) {
      lat = coordinateAngle(decimalPair[1]); lon = coordinateAngle(decimalPair[2]);
    } else {
      // Never send malformed coordinate notation to the place-name service.
      const numericPair = /\d/.test(value) && /^[+\-\d\s.,;°'"NSEW]+$/.test(value)
        && (/[°,;'"NSEW]/.test(value) || /\d\s+[+-]?\d/.test(value));
      if (numericPair || /\d\s*°/.test(value)) throw new Error(COORDINATE_ERROR);
      return null;
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error(COORDINATE_ERROR);
  return { lat, lon };
}

// The public Photon index does not contain every Polish exonym. Expand only
// standalone city names: an explicit address/country must keep its meaning
// (e.g. "Paryż, Polska" is not silently redirected to France).
const CITY_ALIASES = new Map(Object.entries({
  waszyngton: 'Washington DC', 'waszyngton dc': 'Washington DC',
  'nowy jork': 'New York City', londyn: 'London', paryz: 'Paris', rzym: 'Rome',
  wieden: 'Vienna', praga: 'Prague', monachium: 'Munich', kolonia: 'Cologne',
  wenecja: 'Venice', mediolan: 'Milan', florencja: 'Florence', neapol: 'Naples',
  lizbona: 'Lisbon', madryt: 'Madrid', ateny: 'Athens', bruksela: 'Brussels',
  kopenhaga: 'Copenhagen', sztokholm: 'Stockholm', bukareszt: 'Bucharest',
  budapeszt: 'Budapest', kijow: 'Kyiv', lwow: 'Lviv', moskwa: 'Moscow',
  pekin: 'Beijing', tokio: 'Tokyo', szanghaj: 'Shanghai', seul: 'Seoul',
  kair: 'Cairo', jerozolima: 'Jerusalem', stambul: 'Istanbul', bombaj: 'Mumbai',
  kalkuta: 'Kolkata', 'nowe delhi': 'New Delhi', hawana: 'Havana', kapsztad: 'Cape Town',
}));

export function normalizePlaceQuery(text) {
  const query = String(text).trim().replace(/\s+/g, ' ').slice(0, 240);
  return CITY_ALIASES.get(fold(query)) || query;
}

export function rankLocationResults(features, query) {
  const plainQuery = fold(query);
  const generalName = !/[\d,;]/.test(query);
  const seen = new Set();
  return (Array.isArray(features) ? features : []).slice(0, 20).flatMap((feature, index) => {
    const point = feature?.geometry?.coordinates;
    if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(Number.isFinite)
      || Math.abs(point[1]) > 90 || Math.abs(point[0]) > 180) return [];
    const properties = feature.properties || {};
    const name = typeof properties.name === 'string' ? properties.name : '';
    const label = [...new Set([name, [properties.street, properties.housenumber].filter(value => typeof value === 'string' && value.trim()).join(' '),
      properties.city, properties.state, properties.country].filter(value => typeof value === 'string' && value.trim()))].join(', ')
      || `${point[1].toFixed(6)}, ${point[0].toFixed(6)}`;
    const key = `${point[1].toFixed(5)},${point[0].toFixed(5)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const matchesName = name && (plainQuery === fold(name) || plainQuery.startsWith(`${fold(name)} `));
    const type = properties.osm_value || properties.type;
    const priority = generalName && matchesName ? ({ city: 100, town: 70, village: 40, state: 20, country: 10 }[type] || 0) : 0;
    return [{ lat: point[1], lon: point[0], label, priority, index }];
  }).sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, 8).map(({ lat, lon, label }) => ({ lat, lon, label }));
}

export function createLocationSearch({
  endpoint = import.meta.env?.VITE_GEOCODING_URL || 'https://photon.komoot.io/api/',
  fetchImpl = (...args) => fetch(...args),
  minIntervalMs = 1100,
} = {}) {
  const cache = new Map();
  let lastRequest = 0;
  let pending = Promise.resolve();
  return async text => {
    const coordinates = parseCoordinates(text);
    if (coordinates) return [{ ...coordinates, label: 'Coordinates' }];
    const name = normalizePlaceQuery(text);
    if (!name) return [];
    const key = fold(name);
    if (cache.has(key)) return cache.get(key).map(result => ({ ...result }));
    // Explicit submit only; keep requests serialized and cached, never send
    // autocomplete traffic or coordinate queries to the public service.
    const request = pending.then(async () => {
      if (cache.has(key)) return cache.get(key);
      const delay = Math.max(0, minIntervalMs - (Date.now() - lastRequest));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      lastRequest = Date.now();
      const url = new URL(endpoint, globalThis.location?.href || 'http://localhost');
      url.searchParams.set('q', name); url.searchParams.set('limit', '8');
      url.searchParams.set('lang', 'en');
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(response.status === 429 ? 'Search is busy. Wait a moment or place a pin on the map.' : 'Location search is unavailable. Place a pin on the map instead.');
      const data = await response.json();
      const results = rankLocationResults(data?.features, name);
      if (results.length) cache.set(key, results);
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      return results;
    });
    pending = request.catch(() => {});
    return (await request).map(result => ({ ...result }));
  };
}

export const searchLocations = createLocationSearch();

export async function geocodeCity(text) {
  const [location] = await searchLocations(text);
  return location ? { lat: location.lat, lon: location.lon } : null;
}
