export function parseCoordinates(text) {
  const match = String(text).trim().match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]), lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Coordinates must be latitude −90…90, longitude −180…180.');
  return { lat, lon };
}

const cache = new Map();
let lastRequest = 0;
let pending = Promise.resolve();
export function geocodeCity(text) {
  const name = String(text).trim().slice(0, 240);
  try { const coordinates = parseCoordinates(name); if (coordinates) return Promise.resolve(coordinates); }
  catch (error) { return Promise.reject(error); }
  if (!name) return Promise.resolve(null);
  if (cache.has(name)) return Promise.resolve(cache.get(name));
  // Explicit submit only: no autocomplete traffic to the public search service.
  const request = pending.then(async () => {
    if (cache.has(name)) return cache.get(name);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - lastRequest))));
    lastRequest = Date.now();
    const endpoint = import.meta.env?.VITE_GEOCODING_URL || 'https://photon.komoot.io/api/';
    const url = new URL(endpoint, globalThis.location?.href || 'http://localhost');
    url.searchParams.set('q',name); url.searchParams.set('limit','1');
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(response.status === 429 ? 'Search is busy. Wait a moment or place a pin on the map.' : 'Location search is unavailable. Place a pin on the map instead.');
    const data = await response.json();
    const point = data.features?.[0]?.geometry?.coordinates;
    const value = point && point.length >= 2 ? parseCoordinates(`${point[1]}, ${point[0]}`) : null;
    if (value) cache.set(name, value);
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return value;
  });
  pending = request.catch(() => {});
  return request;
}

export function setupLocationPicker(onOpen) {
  const dialog = document.createElement('dialog'); dialog.className = 'flight-dialog location-dialog';
  dialog.setAttribute('aria-labelledby', 'location-title');
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="location-title">Choose your departure</h2><button id="pin-close" type="button" aria-label="Close map">×</button></div>
    <form id="pin-search"><label for="pin-query">City, address or latitude, longitude</label><div class="pin-row"><input id="pin-query" maxlength="240" placeholder="Paris or 48.8584, 2.2945" required data-gamepad-keyboard data-gamepad-submit-target="#pin-search-submit"><button id="pin-search-submit" type="submit">Search</button></div></form>
    <p id="pin-status" role="status">Click the map to place your departure pin. Gamepad: X picks up or drops the pin; left stick/D-pad moves it.</p><div id="departure-map" aria-label="Departure map"></div>
    <div class="pin-row"><span class="settings-note">No account needed. Search powered by Photon / OpenStreetMap.</span><button id="pin-use" disabled>Use this location</button></div>`;
  document.body.append(dialog);
  let map, marker, selected, target, busy = false, generation = 0, L, gamepadPinPicked = false;
  const status = dialog.querySelector('#pin-status'), use = dialog.querySelector('#pin-use');
  const select = (lat, lon) => {
    selected = parseCoordinates(`${lat}, ${lon}`); if (!selected) return;
    status.textContent = `Departure: ${lat.toFixed(6)}, ${lon.toFixed(6)}${gamepadPinPicked ? ' · Pin picked up — move with left stick/D-pad, X to drop.' : ' · X to pick up pin.'}`; use.disabled = false;
    if (map) {
      if (!marker) {
        marker = L.marker([lat,lon], {draggable:true, title:'Flight departure', keyboard:true, icon:L.divIcon({className:'departure-pin',html:'<span aria-hidden="true">●</span>',iconSize:[28,36],iconAnchor:[14,36]})}).addTo(map);
        marker.on('dragend', () => { const point = marker.getLatLng().wrap(); select(point.lat, point.lng); });
      } else marker.setLatLng([lat,lon]);
    }
  };
  dialog.addEventListener('close', () => { generation++; gamepadPinPicked = false; });
  dialog.querySelector('#pin-close').onclick = () => dialog.close();
  use.onclick = () => {
    if (!selected || !target || target.readOnly) return;
    target.value = `${selected.lat.toFixed(6)}, ${selected.lon.toFixed(6)}`;
    target.dispatchEvent(new Event('input', { bubbles:true })); dialog.close();
  };
  dialog.querySelector('#pin-search').onsubmit = async (event) => {
    event.preventDefault(); if (busy) return; busy = true;
    const current = generation;
    status.textContent = 'Searching…';
    try {
      const loc = await geocodeCity(dialog.querySelector('#pin-query').value);
      if (current !== generation || !dialog.open) return;
      if (!loc) throw new Error('Location not found. Try a more specific address or place a pin.');
      select(loc.lat, loc.lon); map?.setView([loc.lat,loc.lon],13);
    } catch (error) { if (current === generation) status.textContent = error.name === 'TimeoutError' ? 'Search timed out. Place a pin or try again.' : error.message; }
    finally { busy = false; }
  };
  for (const id of ['city-input', 'lobby-city']) {
    const input = document.getElementById(id); input.maxLength = 240;
    input.setAttribute('aria-label', 'Starting city, address or latitude, longitude');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'pick-location'; button.textContent = '⌖ Choose on map';
    button.id = `${id}-choose-map`;
    input.dataset.gamepadNavRight = `#${button.id}`;
    button.dataset.gamepadNavLeft = `#${id}`;
    input.insertAdjacentElement('afterend', button);
    button.onclick = async () => {
      if (input.readOnly || input.style.display === 'none') return;
      const current = ++generation;
      target = input; selected = null; gamepadPinPicked = false; use.disabled = true;
      if (marker) { marker.remove(); marker = null; }
      dialog.querySelector('#pin-query').value = input.value;
      onOpen(); dialog.showModal(); status.textContent = 'Loading map…';
      try {
        const [leaflet] = await Promise.all([import('leaflet'),import('leaflet/dist/leaflet.css')]);
        if (current !== generation || !dialog.open) return;
        L = leaflet.default;
        if (!map) {
          map = L.map(dialog.querySelector('#departure-map'), {worldCopyJump:true}).setView([48.8584,2.2945],5);
          const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors', updateWhenIdle:true, keepBuffer:1 }).addTo(map);
          layer.on('tileerror', () => { if(dialog.open && !selected) status.textContent = 'Some map images could not load. You can still search or enter coordinates.'; });
          map.on('click', event => { const point = event.latlng.wrap(); select(point.lat,point.lng); });
        }
        map.invalidateSize();
        status.textContent = 'Click the map or search to choose a departure. Gamepad: X picks up or drops the pin; left stick/D-pad moves it.';
        const initial = parseCoordinates(input.value);
        if (initial) { select(initial.lat, initial.lon); map.setView([initial.lat,initial.lon],13); }
      } catch { status.textContent = 'The map could not load. Search or enter latitude, longitude instead.'; }
    };
  }
  return {
    get isOpen() { return dialog.open; },
    get pinPicked() { return dialog.open && gamepadPinPicked; },
    toggleGamepadPin() {
      if (!dialog.open) return false;
      gamepadPinPicked = !gamepadPinPicked;
      if (!selected && gamepadPinPicked) {
        const centre = map?.getCenter();
        select(centre?.lat ?? 48.8584, centre?.lng ?? 2.2945);
      } else if (selected) select(selected.lat, selected.lon);
      return gamepadPinPicked;
    },
    moveGamepadPin(direction) {
      if (!dialog.open || !gamepadPinPicked || !['up', 'down', 'left', 'right'].includes(direction)) return false;
      const centre = map?.getCenter();
      const point = selected || { lat: centre?.lat ?? 48.8584, lon: centre?.lng ?? 2.2945 };
      const dx = direction === 'right' ? 24 : direction === 'left' ? -24 : 0;
      const dy = direction === 'down' ? 24 : direction === 'up' ? -24 : 0;
      const projected = map?.project([point.lat, point.lon], map.getZoom());
      const next = projected ? map.unproject([projected.x + dx, projected.y + dy], map.getZoom()).wrap()
        : { lat: Math.max(-90, Math.min(90, point.lat - dy * 0.001)), lng: point.lon + dx * 0.001 };
      select(next.lat, next.lng);
      map?.panInside([next.lat, next.lng], { animate: false });
      return true;
    },
  };
}
