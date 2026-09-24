export const LOCAL_TERRAIN_POOL_PROXY_PATH = "/__fotw-terrain-session";
export const SHARED_TERRAIN_POOL_ORIGIN = "https://box.zakai.eu";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function resolveTerrainPoolEndpoint(endpoint, {
  localProxy = false,
  pageURL = globalThis.location?.href,
} = {}) {
  const configured = String(endpoint || "").trim();
  if (!configured || !localProxy) return configured;

  try {
    const target = new URL(configured);
    const page = new URL(pageURL);
    if (target.origin !== SHARED_TERRAIN_POOL_ORIGIN
      || target.username || target.password || target.hash
      || !LOOPBACK_HOSTS.has(page.hostname)
      || !["http:", "https:"].includes(page.protocol)) {
      return configured;
    }
    return new URL(LOCAL_TERRAIN_POOL_PROXY_PATH, page.origin).href;
  } catch {
    return configured;
  }
}
