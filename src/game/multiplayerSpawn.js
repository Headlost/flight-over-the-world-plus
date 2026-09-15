const R = 6378137;
const DEG = Math.PI / 180;

export function multiplayerSpacing(wingspans = []) {
  return Math.max(12, Math.min(40, Math.max(9, ...wingspans) * 1.35));
}

export function multiplayerSpawnPoint(lat, lon, index, total, spacing) {
  if (total <= 1) return { lat, lon };
  const east = (index - (total - 1) / 2) * spacing;
  return offsetPoint(lat, lon, east < 0 ? -Math.PI / 2 : Math.PI / 2, Math.abs(east));
}

function offsetPoint(lat, lon, bearing, distance) {
  const angular = distance / R;
  const latitude = lat * DEG;
  const newLat = Math.asin(Math.max(-1, Math.min(1,
    Math.sin(latitude) * Math.cos(angular) + Math.cos(latitude) * Math.sin(angular) * Math.cos(bearing)
  )));
  const newLon = lon * DEG + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(latitude),
    Math.cos(angular) - Math.sin(latitude) * Math.sin(newLat));
  return { lat: newLat / DEG, lon: ((newLon / DEG + 540) % 360) - 180 };
}

export function nearbyPlayerPose(anchor, slot = 1, spacing = 20) {
  const index = Math.max(0, slot - 1);
  const bearing = (index % 8) * Math.PI / 4;
  const ring = Math.floor(index / 8) + 1;
  if (anchor.space) {
    // Space positions use the game's scaled solar-system units, not Earth metres.
    const distance = 2.5 * ring;
    return { ...anchor, x: anchor.x + Math.sin(bearing) * distance, y: anchor.y,
      z: anchor.z + Math.cos(bearing) * distance, orbitBody: '', surfaceBody: '', hyperdrive: false, autopilot: false };
  }
  return { ...anchor, ...offsetPoint(anchor.lat, anchor.lon, bearing, spacing * ring) };
}
