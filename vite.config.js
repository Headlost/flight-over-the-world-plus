import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    // CLI `--open false` is a URL path, not a boolean. Test and background
    // servers opt out explicitly so fixture credentials never open a user tab.
    open: process.env.VITE_OPEN_BROWSER !== "false",
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
});
