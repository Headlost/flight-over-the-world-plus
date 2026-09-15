/** Google Maps URL opens the closest available panorama without a Maps API key. */
export function streetViewUrl(lat, lon, heading = 0) {
  const viewpoint = `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
  const normalizedHeading = ((Number(heading) % 360) + 360) % 360;
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(viewpoint)}&heading=${Math.round(normalizedHeading)}&pitch=0&fov=80`;
}
