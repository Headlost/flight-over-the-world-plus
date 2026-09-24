import { defineConfig, loadEnv } from "vite";
import {
  LOCAL_TERRAIN_POOL_PROXY_PATH,
  SHARED_TERRAIN_POOL_ORIGIN,
} from "./src/game/terrainEndpoint.js";

const ONLINE_GAME_ORIGIN = "https://headlost.github.io";

export function createLocalTerrainPoolProxy(endpoint) {
  let target;
  try {
    target = new URL(String(endpoint || "").trim());
  } catch {
    throw new Error("VITE_TERRAIN_POOL_LOCAL_PROXY requires a valid terrain pool endpoint");
  }
  if (target.origin !== SHARED_TERRAIN_POOL_ORIGIN
    || target.username || target.password || target.hash) {
    throw new Error("Local terrain proxy is restricted to the configured shared terrain service");
  }
  const targetPath = target.pathname + target.search;
  return {
    target: target.origin,
    changeOrigin: true,
    secure: true,
    headers: { Origin: ONLINE_GAME_ORIGIN },
    rewrite: () => targetPath,
    configure(proxy) {
      // http-proxy may update forwarding headers after applying static options.
      // Pin the exact production Origin expected by the existing broker.
      proxy.on("proxyReq", request => request.setHeader("Origin", ONLINE_GAME_ORIGIN));
    },
  };
}

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "");
  const localTerrainProxyEnabled = String(
    process.env.VITE_TERRAIN_POOL_LOCAL_PROXY
      ?? fileEnv.VITE_TERRAIN_POOL_LOCAL_PROXY
      ?? ""
  ).toLowerCase() === "true";
  const terrainPoolEndpoint = process.env.VITE_TERRAIN_POOL_ENDPOINT
    ?? fileEnv.VITE_TERRAIN_POOL_ENDPOINT
    ?? "";
  const terrainProxy = localTerrainProxyEnabled
    ? createLocalTerrainPoolProxy(terrainPoolEndpoint)
    : null;

  return {
    base: "./",
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      // CLI `--open false` is a URL path, not a boolean. Test and background
      // servers opt out explicitly so fixture credentials never open a user tab.
      open: process.env.VITE_OPEN_BROWSER !== "false",
      proxy: terrainProxy ? { [LOCAL_TERRAIN_POOL_PROXY_PATH]: terrainProxy } : undefined,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/three/')) return 'three';
            if (id.includes('node_modules/3d-tiles-renderer/')) return 'terrain';
            if (id.includes('node_modules/peerjs/') || id.includes('node_modules/peerjs-js-binarypack/')) return 'multiplayer';
          },
        },
      },
    },
  };
});
