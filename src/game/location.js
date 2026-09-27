import { parseCoordinates, searchLocations } from './locationSearch.js';
export { parseCoordinates, geocodeCity } from './locationSearch.js';

export function setupLocationPicker(onOpen) {
  const dialog = document.createElement('dialog'); dialog.className = 'flight-dialog location-dialog';
  dialog.setAttribute('aria-labelledby', 'location-title');
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="location-title">Choose your departure</h2><button id="pin-close" type="button" aria-label="Close map">×</button></div>
    <form id="pin-search"><label for="pin-query">City, address or latitude, longitude (Polish / English)</label><div class="pin-row"><input id="pin-query" maxlength="240" placeholder="Waszyngton / Washington or 29.0000° N, 79.0000° W" required data-gamepad-keyboard data-gamepad-submit-target="#pin-search-submit"><button id="pin-search-submit" type="submit">Search</button></div></form>
    <ul id="pin-results" class="location-results" aria-label="Search results — choose a departure" hidden></ul>
    <p id="pin-status" role="status">Click the map to place your departure pin. Gamepad: X picks up or drops the pin; left stick/D-pad moves it.</p><div id="departure-map" aria-label="Departure map"></div>
    <div class="pin-row"><span class="settings-note">No account needed. Search powered by Photon / OpenStreetMap.</span><button id="pin-use" disabled>Use this location</button></div>`;
  document.body.append(dialog);
  let map, marker, selected, target, selectedLabel = '', busy = false, generation = 0, searchRevision = 0, L, gamepadPinPicked = false;
  const status = dialog.querySelector('#pin-status'), use = dialog.querySelector('#pin-use');
  const query = dialog.querySelector('#pin-query'), results = dialog.querySelector('#pin-results');
  const searchButton = dialog.querySelector('#pin-search-submit');
  const resetSearch = (clearPin = false) => {
    searchRevision++; busy = false; searchButton.disabled = false;
    results.replaceChildren(); results.hidden = true;
    if (clearPin) {
      selected = null; use.disabled = true;
      marker?.remove(); marker = null;
    }
  };
  const select = (lat, lon, label = '') => {
    selected = parseCoordinates(`${lat}, ${lon}`); if (!selected) return;
    selectedLabel = label;
    status.textContent = `Departure: ${label ? `${label} · ` : ''}${lat.toFixed(6)}, ${lon.toFixed(6)}${gamepadPinPicked ? ' · Pin picked up — move with left stick/D-pad, X to drop.' : ' · X to pick up pin.'}`; use.disabled = false;
    if (map) {
      if (!marker) {
        marker = L.marker([lat,lon], {draggable:true, title:'Flight departure', keyboard:true, icon:L.divIcon({className:'departure-pin',html:'<span aria-hidden="true">●</span>',iconSize:[28,36],iconAnchor:[14,36]})}).addTo(map);
        marker.on('dragend', () => { const point = marker.getLatLng().wrap(); resetSearch(); select(point.lat, point.lng); });
      } else marker.setLatLng([lat,lon]);
    }
  };
  dialog.addEventListener('close', () => { generation++; gamepadPinPicked = false; resetSearch(); });
  query.addEventListener('input', () => { resetSearch(true); status.textContent = 'Press Search to find a city, address or coordinates.'; });
  dialog.querySelector('#pin-close').onclick = () => dialog.close();
  use.onclick = () => {
    if (!selected || !target || target.readOnly) return;
    target.value = `${selected.lat.toFixed(6)}, ${selected.lon.toFixed(6)}`;
    target.dispatchEvent(new Event('input', { bubbles:true })); dialog.close();
  };
  dialog.querySelector('#pin-search').onsubmit = async (event) => {
    event.preventDefault(); if (busy) return; busy = true;
    const current = generation, revision = ++searchRevision;
    searchButton.disabled = true; use.disabled = true; selected = null;
    marker?.remove(); marker = null; results.replaceChildren(); results.hidden = true;
    status.textContent = 'Searching…';
    try {
      const locations = await searchLocations(query.value);
      if (current !== generation || revision !== searchRevision || !dialog.open) return;
      if (!locations.length) throw new Error('Location not found. Try a city and country, an English name, or place a pin.');
      const choose = (loc, index) => {
        select(loc.lat, loc.lon, loc.label); map?.setView([loc.lat,loc.lon],13);
        results.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      };
      if (locations.length > 1) {
        for (const [index, loc] of locations.entries()) {
          const item = document.createElement('li'), button = document.createElement('button');
          button.type = 'button'; button.textContent = loc.label;
          button.onclick = () => choose(loc, index); item.append(button); results.append(item);
        }
        results.hidden = false;
      }
      choose(locations[0], 0);
    } catch (error) { if (current === generation && revision === searchRevision) status.textContent = error.name === 'TimeoutError' ? 'Search timed out. Place a pin or try again.' : error.message; }
    finally { if (revision === searchRevision) { busy = false; searchButton.disabled = false; } }
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
      resetSearch(true);
      const openingRevision = searchRevision;
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
          map.on('click', event => { const point = event.latlng.wrap(); resetSearch(); select(point.lat,point.lng); });
        }
        map.invalidateSize();
        if (openingRevision === searchRevision) {
          status.textContent = 'Click the map or search to choose a departure. Gamepad: X picks up or drops the pin; left stick/D-pad moves it.';
          try {
            const initial = parseCoordinates(input.value);
            if (initial) { select(initial.lat, initial.lon); map.setView([initial.lat,initial.lon],13); }
          } catch (error) { status.textContent = error.message; }
        } else if (selected) {
          select(selected.lat, selected.lon, selectedLabel); map.setView([selected.lat,selected.lon],13);
        }
      } catch { status.textContent = 'The map could not load. Search or enter latitude, longitude instead.'; }
    };
  }
  return {
    get isOpen() { return dialog.open; },
    get pinPicked() { return dialog.open && gamepadPinPicked; },
    toggleGamepadPin() {
      if (!dialog.open) return false;
      resetSearch();
      gamepadPinPicked = !gamepadPinPicked;
      if (!selected && gamepadPinPicked) {
        const centre = map?.getCenter();
        select(centre?.lat ?? 48.8584, centre?.lng ?? 2.2945);
      } else if (selected) select(selected.lat, selected.lon);
      return gamepadPinPicked;
    },
    moveGamepadPin(direction) {
      if (!dialog.open || !gamepadPinPicked || !['up', 'down', 'left', 'right'].includes(direction)) return false;
      resetSearch();
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
