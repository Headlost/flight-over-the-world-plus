import { defineConfig } from '@playwright/test';
const localGraphicsArgs = process.platform === 'win32'
  ? ['--use-angle=d3d11', '--renderer-process-limit=2']
  : ['--use-angle=swiftshader', '--renderer-process-limit=2'];
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5179', viewport:{width:1440,height:1000}, launchOptions:{args:localGraphicsArgs} },
  webServer: {
    command:'npm run dev -- --port 5179 --strictPort',
    url:'http://127.0.0.1:5179',
    reuseExistingServer:false,
    // Keep fixture tests independent of the developer's real map credentials.
    env:{ VITE_OPEN_BROWSER:'false', VITE_CESIUM_ION_KEY:'test-only', VITE_CESIUM_ION_FALLBACK_KEYS:'test-fallback-1,test-fallback-2', VITE_TERRAIN_POOL_ENDPOINT:'', VITE_TERRAIN_POOL_LOCAL_PROXY:'false', VITE_GEOCODING_URL:'https://photon.komoot.io/api/' },
  },
});
