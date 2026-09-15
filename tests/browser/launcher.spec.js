import { test, expect } from '@playwright/test';

test.beforeEach(async ({context}) => {
  await context.route('https://box.zakai.eu/**', route => route.fulfill({status:403,body:'Production session admission disabled in fixture tests'}));
  await context.route('https://api.cesium.com/**', route => route.fulfill({status:403,body:'Terrain disabled in fixture tests'}));
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6kWQAAAAASUVORK5CYII=','base64')}));
});
async function openPicker(page) {
  await page.getByRole('button',{name:'Single player',exact:true}).click();
  await page.locator('#menu [data-mode=free]').click();
  await page.locator('#menu .pick-location').click();
  await expect(page.locator('#pin-status')).toContainText('Click the map');
}

async function chooseVehicle(page, name, lobby = false) {
  const prefix = lobby ? '#lobby-car' : '#car';
  const label = page.locator(`${prefix}-name`);
  for (let clicks = 0; clicks <= 10; clicks++) {
    if ((await label.textContent())?.trim() === name) return;
    if (clicks < 10) await page.locator(`${prefix}-next`).click();
  }
  throw new Error(`Vehicle ${name} was not available in the carousel`);
}

async function visibleRects(page, selectors) {
  return page.evaluate((requested) => Object.fromEntries(requested.map((selector) => {
    const element = document.querySelector(selector);
    if (!element || getComputedStyle(element).display === 'none') return [selector, null];
    const rect = element.getBoundingClientRect();
    return [selector, {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height}];
  })), selectors);
}

function rectsOverlap(a, b, gap = 0) {
  if (!a || !b) return false;
  return a.left < b.right + gap && a.right + gap > b.left
    && a.top < b.bottom + gap && a.bottom + gap > b.top;
}

async function flushMultiplayerControls(clients) {
  // Real application handlers on separate pages; replace only the external PeerJS transport.
  for (let pass = 0; pass < 12; pass += 1) {
    const batches = await Promise.all(clients.map(({page}) => page.evaluate(() =>
      window.__testLobbyMessages.splice(0).filter(message => message.data.t !== 'pose'))));
    if (batches.every(batch => !batch.length)) return;
    for (let sender = 0; sender < clients.length; sender += 1) for (const message of batches[sender]) {
      const targets = sender === 0 ? clients.slice(1).filter(client =>
        message.kind === 'send' || (message.kind === 'sendTo' && client.id === message.id)
        || (message.kind === 'sendExcept' && client.id !== message.id)) : [clients[0]];
      for (const target of targets) await target.page.evaluate(({data,fromId}) =>
        window.__testReceiveLobbyMessage(data,fromId), {data:message.data,fromId:sender === 0 ? undefined : clients[sender].id});
    }
  }
  throw new Error('Multiplayer control messages did not settle');
}

async function startFixtureRound(clients, vehicle = 'pa28', release = true) {
  await Promise.all(clients.map(async (client,index) => {
    await client.page.goto('/');
    await expect.poll(() => client.page.evaluate(() => !!window.__game)).toBe(true);
    await client.page.locator('#btn-multi').click();
    await client.page.evaluate(({count,index,id}) => window.__testPopulateLobby(count,index > 0,id),
      {count:clients.length,index,id:client.id});
  }));
  const host = clients[0].page;
  if (vehicle === 'rocket') {
    await chooseVehicle(host, 'Rocket', true);
  }
  await host.locator('#lobby-city').fill('52.38871, 16.60069');
  await host.locator('#lobby-vehicle-lock').click();
  for (const client of clients.slice(1)) await host.locator(`[data-player-id="${client.id}"] .approval-toggle`).check();
  await flushMultiplayerControls(clients);
  for (const client of clients.slice(1)) await client.page.locator('#lobby-start').click();
  await flushMultiplayerControls(clients);
  await host.locator('#lobby-start').click();
  await flushMultiplayerControls(clients);
  if (!release) return;
  for (const client of clients) await client.page.evaluate(() => window.__testSnapMultiplayerStart());
  await flushMultiplayerControls(clients);
  for (const client of clients) expect(await client.page.evaluate(() => window.__testReceiveLobbyMessage().goSent)).toBe(true);
}

test('online launcher defaults to game access; adaptive rendering persists', async ({page}) => {
  test.setTimeout(60000);
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Single player',exact:true})).toBeVisible();
  await expect(page.locator('.landing-sub .anywhere-word')).toHaveText('anywhere');
  await expect(page.locator('#menu .mode-card')).toHaveCount(1);
  await expect(page.locator('#menu [data-mode=free]')).toHaveClass(/selected/);
  await expect(page.locator('#menu .scope-btn')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#cesium-access-default')).toBeChecked();
  await expect(page.locator('#cesium-access-custom')).not.toBeChecked();
  await expect(page.locator('#cesium-token-input')).toBeHidden();
  await expect(page.getByRole('link',{name:'How to get your own Cesium token?'})).toHaveAttribute('href','./cesium-token-guide.html');
  await expect(page.locator('#cesium-access-status')).toHaveText('Default game access is active.');
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#quality')).toHaveCount(0);
  await expect(page.locator('#quality-warning')).toContainText('nearby map tiles');
  await page.locator('#adaptive').uncheck();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await openPicker(page);
  await page.locator('#pin-query').fill('48.8584, 2.2945');
  await page.locator('#pin-search button').click();
  await page.getByRole('button',{name:'Use this location'}).click();
  await expect(page.locator('#city-input')).toHaveValue('48.858400, 2.294500');
  await page.reload();
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#adaptive')).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('a custom Cesium token stays in the tab, is confirmed to the player and overrides configured game tokens', async ({page}) => {
  test.setTimeout(60000);
  const customToken = ['headerpart','customsegment'.repeat(5),'signaturepart'.repeat(4)].join('.');
  const requestedTokens = [];
  await page.route('https://api.cesium.com/v1/assets/2275207/endpoint*', async route => {
    requestedTokens.push(new URL(route.request().url()).searchParams.get('access_token'));
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      type:'3DTILES',externalType:'3DTILES',options:{url:'https://tile.googleapis.com/v1/3dtiles/root.json?key=fixture-google-key'},
    })});
  });
  await page.route('https://tile.googleapis.com/**', route => route.fulfill({contentType:'application/json',body:JSON.stringify({
    asset:{version:'1.1'},geometricError:0,root:{boundingVolume:{sphere:[0,0,0,6378137]},geometricError:0,children:[]},
  })}));

  await page.goto('/');
  await page.locator('#cesium-access-custom').check();
  await expect(page.locator('#cesium-token-input')).toBeVisible();
  await expect(page.locator('#cesium-token-privacy')).toContainText('does not share it with other players');
  await page.locator('#cesium-token-input').fill(customToken);
  await expect(page.locator('#cesium-access-status')).toContainText('will not be shared with other players');
  await Promise.all([
    page.waitForNavigation({waitUntil:'domcontentloaded'}),
    page.locator('#btn-solo').click(),
  ]);
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#multiplayer-notice')).toContainText('not shared with other players');
  expect(await page.evaluate(token => {
    const saved = JSON.parse(sessionStorage.getItem('fotw-cesium-access-v1') || '{}');
    return saved.mode === 'custom' && saved.token === token && !localStorage.getItem('fotw-cesium-access-v1');
  }, customToken)).toBe(true);

  await page.locator('#city-input').fill('52.249558, 20.985260');
  await page.locator('#start-btn').click();
  await expect.poll(() => requestedTokens.length).toBe(1);
  expect(requestedTokens[0]).toBe(customToken);
  expect(requestedTokens).not.toContain('test-only');
  expect(requestedTokens).not.toContain('test-fallback-1');
});

test('an incomplete custom Cesium token blocks the mode choice without falling back', async ({page}) => {
  await page.goto('/');
  await page.locator('#cesium-access-custom').check();
  await page.locator('#cesium-token-input').fill('not-a-complete-token');
  await page.locator('#btn-solo').click();
  await expect(page.locator('#landing')).toBeVisible();
  await expect(page.locator('#cesium-access-status')).toContainText('complete Cesium ion token');
  expect(await page.evaluate(() => sessionStorage.getItem('fotw-cesium-access-v1'))).toBeNull();
});

test('brightness uses a 0-100 scale with neutral 50 and persists on Earth and in space', async ({page}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('fotw-settings')) localStorage.setItem('fotw-settings',JSON.stringify({
      quality:'performance',adaptive:false,brightness:1,
    }));
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__dbg?.toneMappingExposure)).toBeCloseTo(1.1, 5);
  await page.locator('#settings-toggle').click();
  const slider = page.locator('#display-brightness');
  await expect(slider).toHaveAttribute('min','0');
  await expect(slider).toHaveAttribute('max','100');
  await expect(slider).toHaveAttribute('step','1');
  await expect(slider).toHaveValue('50');
  await expect(slider).toHaveAttribute('aria-valuetext','50%');
  await expect(page.locator('#display-brightness-value')).toHaveText('50%');

  const checkpoints = [
    [0, 1.1 * 0.35],
    [25, 1.1 * Math.sqrt(0.35)],
    [50, 1.1],
    [75, 1.1 * Math.sqrt(1.8)],
    [100, 1.1 * 1.8],
  ];
  for (const [level, exposure] of checkpoints) {
    await slider.fill(String(level));
    await expect(slider).toHaveAttribute('aria-valuetext',`${level}%`);
    await expect(page.locator('#display-brightness-value')).toHaveText(`${level}%`);
    await expect.poll(() => page.evaluate(() => window.__dbg?.toneMappingExposure)).toBeCloseTo(exposure, 5);
  }

  await slider.fill('25');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fotw-settings')).brightness)).toBeCloseTo(Math.sqrt(0.35), 10);
  await page.getByRole('button',{name:'Done',exact:true}).click();
  expect(await page.evaluate(() => window.__testRocketLaunch())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.toneMappingExposure)).toBeCloseTo(1.14 * Math.sqrt(0.35), 5);
  await page.reload();
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#display-brightness')).toHaveValue('25');
});

test('a legacy brightness multiplier keeps its image until the player moves the new control', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('fotw-settings',JSON.stringify({
    quality:'performance',adaptive:false,brightness:1.2,
  })));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__dbg?.toneMappingExposure)).toBeCloseTo(1.32, 5);
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#display-brightness')).toHaveValue('66');
  await expect(page.locator('#display-brightness-value')).toHaveText('66%');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fotw-settings')).brightness)).toBe(1.2);
  await page.locator('#display-brightness').fill('50');
  await expect.poll(() => page.evaluate(() => window.__dbg?.toneMappingExposure)).toBeCloseTo(1.1, 5);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fotw-settings')).brightness)).toBe(1);
});

test('terrain authentication rotates a rejected token before loading Google tiles', async ({page}) => {
  const requests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.cesium.com/v1/assets/2275207/endpoint*', async route => {
    const token = new URL(route.request().url()).searchParams.get('access_token');
    requests.push(token);
    await route.fulfill({status:token === 'test-only' ? 401 : 200,contentType:'application/json',body:JSON.stringify({
      type:'3DTILES',externalType:'3DTILES',options:{url:'https://tile.googleapis.com/v1/3dtiles/root.json?key=fixture-google-key'},
    })});
  });
  let googleRequests = 0;
  await page.route('https://tile.googleapis.com/**', async route => {
    googleRequests += 1;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({asset:{version:'1.1'},geometricError:0,
      root:{boundingVolume:{sphere:[0,0,0,6378137]},geometricError:0,children:[]}})});
  });
  await page.goto('/');
  await page.locator('#btn-solo').click();
  await page.locator('#city-input').fill('52.249558, 20.985260');
  await page.locator('#start-btn').click();
  await expect.poll(() => requests.length).toBe(2);
  await expect.poll(() => googleRequests).toBeGreaterThan(0);
  expect(requests).toEqual(['test-only','test-fallback-1']);
  expect(errors).toEqual([]);
});

test('terrain reuses one root session through restart, a vehicle change and a space round trip', async ({page}) => {
  test.setTimeout(45000);
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  let endpoints = 0, roots = 0;
  await page.route('https://api.cesium.com/v1/assets/2275207/endpoint*',async route=>{
    endpoints += 1;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({type:'3DTILES',externalType:'3DTILES',
      options:{url:'https://tile.googleapis.com/v1/3dtiles/root.json?key=fixture-key'}})});
  });
  await page.route('https://tile.googleapis.com/**',async route=>{
    const root = new URL(route.request().url()).pathname.endsWith('root.json');
    if (root) roots += 1;
    const body = root ? {asset:{version:'1.1'},geometricError:0,
      root:{boundingVolume:{sphere:[0,0,0,6378137]},geometricError:0,content:{uri:'empty.gltf?session=fixture-session'},children:[]}}
      : {asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>!!window.__game)).toBe(true);
  expect(endpoints).toBe(0); expect(roots).toBe(0);
  await page.locator('#btn-solo').click();
  await page.locator('#city-input').fill('52.249558, 20.985260');
  await page.evaluate(()=>window.__testTerrainLoading(20));
  await page.locator('#start-btn').click();
  await expect(page.locator('#menu')).toBeHidden({timeout:12000});
  await expect.poll(()=>roots).toBe(1);
  await page.keyboard.press('Escape'); await page.locator('#btn-restart').click();
  await page.locator('#car-next').click(); await page.locator('#start-btn').click();
  await expect(page.locator('#menu')).toBeHidden({timeout:12000});
  expect(endpoints).toBe(1); expect(roots).toBe(1);
  await page.evaluate(()=>window.__testRocketLaunch());
  await expect.poll(()=>page.evaluate(()=>window.__dbg?.spaceMode)).toBe(true);
  await page.evaluate(()=>window.__testGroundedParachutist());
  await expect.poll(()=>page.evaluate(()=>window.__dbg?.terrainDetailMode)).toBe('street');
  expect(await page.evaluate(()=>window.__dbg.terrainCameraCount)).toBe(1);
  expect(await page.evaluate(()=>window.__dbg.terrainViewDistance)).toBeGreaterThan(43000);
  expect(await page.evaluate(()=>window.__dbg.terrainRootRequests)).toBe(1);
  expect(endpoints).toBe(1); expect(roots).toBe(1); expect(errors).toEqual([]);
});

test('single player recovers from a terrain timeout and can start successive aircraft', async ({page}) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.clock.install();
  await page.locator('#btn-solo').click();
  await page.locator('#car-next').click();
  await expect(page.locator('#car-name')).toHaveText('Dash 8 Q400');
  await page.locator('#city-input').fill('52.249558, 20.985260');
  await page.evaluate(() => window.__testTerrainLoading(null));
  await page.locator('#start-btn').click();
  await expect.poll(() => page.evaluate(() => window.__testReceiveLobbyMessage().awaitingSnap)).toBe(true);
  await page.clock.fastForward(31000);
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#menu-error')).toContainText(/terrain|Terrain/);
  await expect(page.locator('#start-btn')).toBeEnabled();
  await expect(page.locator('#fatal')).toHaveClass(/hidden/);
  expect(await page.evaluate(() => sessionStorage.getItem('fotw_starting'))).toBeNull();

  for (const name of ['Dash 8 Q400', 'Cessna Citation']) {
    await page.evaluate(() => window.__testTerrainLoading(20));
    await page.locator('#start-btn').click();
    await page.clock.runFor(2500);
    await expect(page.locator('#menu')).toBeHidden();
    expect(await page.evaluate(() => window.__game.plane.height)).toBeLessThan(1000);
    await page.keyboard.press('Escape');
    await page.locator('#btn-restart').click();
    await expect(page.locator('#car-name')).toHaveText(name);
    await expect(page.locator('#start-btn')).toBeEnabled();
    if (name === 'Dash 8 Q400') await page.locator('#car-next').click();
  }
  expect(errors).toEqual([]);
});

test('leaving the single player menu cancels terrain loading and a pending location lookup', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.locator('#btn-solo').click();
  await page.locator('#city-input').fill('52.249558, 20.985260');
  await page.evaluate(() => window.__testTerrainLoading(null));
  await page.locator('#start-btn').click();
  await expect.poll(() => page.evaluate(() => window.__testReceiveLobbyMessage().awaitingSnap)).toBe(true);
  await page.locator('#menu-back').click();
  expect(await page.evaluate(() => window.__testReceiveLobbyMessage().awaitingSnap)).toBe(false);
  await page.locator('#btn-solo').click();
  await expect(page.locator('#start-btn')).toBeEnabled();

  let releaseLookup;
  const lookup = new Promise(resolve => { releaseLookup = resolve; });
  let sawRequest;
  const requested = new Promise(resolve => { sawRequest = resolve; });
  await page.route('https://photon.komoot.io/api/**', async route => {
    sawRequest();
    await lookup;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({features:[{geometry:{coordinates:[21.01,52.23]}}]})});
  });
  await page.locator('#city-input').fill('Warsaw cancelled lookup');
  await page.locator('#start-btn').click();
  await requested;
  await page.locator('#city-input').press('Enter');
  await page.locator('#menu-back').click();
  const response = page.waitForResponse('https://photon.komoot.io/api/**');
  releaseLookup();
  await (await response).finished();
  await page.locator('#btn-solo').click();
  await expect(page.locator('#start-btn')).toBeEnabled();
  await expect(page.locator('#menu-error')).toBeEmpty();
  await page.evaluate(() => window.__testTerrainLoading(20));
  expect(await page.evaluate(() => window.__testReceiveLobbyMessage().awaitingSnap)).toBe(false);
  expect(errors).toEqual([]);
});

test.describe('mobile terrain recovery', () => {
  test.use({
    viewport: {width: 393, height: 851},
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    hasTouch: true,
    isMobile: true,
  });

  test('an interrupted start enables a non-blocking memory-safe profile', async ({page}) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('fotw_starting', String(Date.now()));
      sessionStorage.setItem('fotw_lasterr', 'Phone closed the tab while loading terrain — usually out of memory.');
    });
    await page.goto('/');
    await expect(page.locator('#fatal')).toHaveClass(/hidden/);
    await expect(page.locator('#crash-note')).toBeVisible();
    await expect(page.locator('#crash-note')).toContainText('Memory-safe mode is active');
    await expect(page.locator('body')).toHaveClass(/memory-safe/);
    await expect.poll(() => page.evaluate(() => window.__dbg?.memorySafeMode)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__dbg?.terrainCacheLimitBytes)).toBeLessThanOrEqual(96e6);
  });

  test('small in-game control switches portrait play to landscape', async ({page}) => {
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
    expect(await page.evaluate(() => window.__testRocketLaunch())).toBe(true);
    await expect(page.locator('#rotate-hint')).toHaveCount(0);
    await expect(page.locator('#landscape-toggle')).toBeVisible();
    await expect(page.locator('#landscape-toggle')).toHaveText('↻');
    const toggleSize = await page.locator('#landscape-toggle').evaluate(button => {
      const rect = button.getBoundingClientRect();
      return {width:rect.width, height:rect.height};
    });
    expect(toggleSize.width).toBeLessThanOrEqual(42);
    expect(toggleSize.height).toBeLessThanOrEqual(42);
    await page.evaluate(() => {
      Object.defineProperty(document.documentElement, 'requestFullscreen', {value:undefined, configurable:true});
      if (screen.orientation) Object.defineProperty(screen.orientation, 'lock', {value:async () => { throw new Error('unsupported'); }, configurable:true});
    });
    await page.locator('#landscape-toggle').click();
    await expect(page.locator('html')).toHaveClass(/virtual-landscape/);
    await expect(page.locator('#landscape-toggle')).toHaveText('↶');
    const virtualCanvas = await page.locator('#game-canvas').evaluate(canvas => ({width:canvas.width, height:canvas.height}));
    expect(virtualCanvas.width).toBeGreaterThan(virtualCanvas.height);
    await page.locator('#landscape-toggle').click();
    await expect(page.locator('html')).not.toHaveClass(/virtual-landscape/);

    await page.setViewportSize({width: 851, height: 393});
    await expect(page.locator('#touch')).toHaveClass(/show/);
    await expect(page.locator('#touch-boost')).toBeVisible();
    await expect(page.locator('#touch-brake')).toBeVisible();
    await expect(page.locator('#touch-camera')).toBeVisible();
    await expect(page.locator('#touch-action')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
    await expect(page.locator('#touch-enter')).toBeVisible();

    const layout = await page.evaluate(() => {
      const stick = document.querySelector('#stick').getBoundingClientRect();
      const buttons = document.querySelector('.touch-btns').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, stick: {...stick.toJSON()}, buttons: {...buttons.toJSON()} };
    });
    expect(layout.stick.right).toBeLessThan(layout.width / 2);
    expect(layout.buttons.left).toBeGreaterThan(layout.width / 2);
    expect(layout.buttons.bottom).toBeLessThanOrEqual(layout.height);

    expect(await page.evaluate(() => window.__testSpaceApproach('Mars', 180, 28))).toBe(true);
    await expect(page.locator('#touch-action')).toBeVisible();
    await expect(page.locator('#touch-action')).toBeEnabled();
    await expect(page.locator('#touch-action')).toHaveText('Enter Mars orbit');
    await expect(page.locator('#touch-action')).toHaveClass(/space-context-ready/);
    await expect(page.locator('#touch-enter')).toBeHidden();
    await expect(page.locator('#space-action-hint')).toBeHidden();

    await page.locator('#touch-action').click();
    await expect.poll(() => page.evaluate(() => window.__dbg?.orbitBody)).toBe('Mars');
    await expect(page.locator('#touch-enter')).toBeVisible();
    await expect(page.locator('#touch-enter')).toBeEnabled();
    await expect(page.locator('#touch-enter')).toHaveText('Enter Mars');
    await expect(page.locator('#touch-enter')).toHaveClass(/space-context-ready/);
    await page.screenshot({path:'test-results/mobile-controls-landscape.png'});
  });

  test('edge control groups, help and collapsed audio leave space navigation clear', async ({page}) => {
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
    expect(await page.evaluate(() => window.__testRocketLaunch())).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
    await expect(page.locator('#movement-status')).toBeHidden();
    await expect(page.locator('#audio-game-controls > summary')).toBeVisible();
    await expect(page.locator('#ambient-game-volume')).toBeHidden();

    const selectors = ['#space-nav','#game-tools','#settings-toggle','.touch-left-controls','.touch-btns','.touch-primary-actions'];
    let rects = await visibleRects(page, selectors);
    expect(rectsOverlap(rects['#space-nav'], rects['#game-tools'])).toBe(false);
    expect(rectsOverlap(rects['#space-nav'], rects['#settings-toggle'])).toBe(false);
    expect(rectsOverlap(rects['.touch-left-controls'], rects['.touch-btns'])).toBe(false);
    expect(rectsOverlap(rects['.touch-left-controls'], rects['.touch-primary-actions'])).toBe(false);
    expect(rectsOverlap(rects['.touch-btns'], rects['.touch-primary-actions'])).toBe(false);

    await page.locator('#audio-game-controls > summary').click();
    await expect(page.locator('.audio-game-panel')).toBeVisible();
    rects = await visibleRects(page, ['#space-nav','.audio-game-panel','.touch-btns']);
    expect(rectsOverlap(rects['#space-nav'], rects['.audio-game-panel'])).toBe(false);
    expect(rectsOverlap(rects['.audio-game-panel'], rects['.touch-btns'])).toBe(false);
    await page.locator('#audio-game-controls > summary').click();

    await page.locator('#touch-help').click();
    await expect(page.locator('#touch-help-dialog')).toBeVisible();
    await expect(page.locator('#touch-help-intro')).toHaveText('Rocket controls in space.');
    await expect(page.locator('#touch-help-list')).toContainText('Destinations');
    await page.getByRole('button',{name:'Back to flight'}).click();
    await expect(page.locator('#touch')).toHaveClass(/show/);

    expect(await page.evaluate(() => window.__testSpaceApproach('Mars', 420, 28))).toBe(true);
    await expect(page.locator('#touch-action')).toHaveText('Approach a planet');
    await expect(page.locator('#touch-action')).toBeDisabled();

    await page.setViewportSize({width:568,height:320});
    await page.locator('#audio-game-controls > summary').click();
    await expect(page.locator('body')).toHaveClass(/mobile-audio-open/);
    rects = await visibleRects(page, ['#space-nav','.audio-game-panel','.touch-left-controls','.touch-btns','.touch-primary-actions']);
    expect(rectsOverlap(rects['#space-nav'], rects['.audio-game-panel'])).toBe(false);
    expect(rectsOverlap(rects['.audio-game-panel'], rects['.touch-btns'])).toBe(false);
    expect(rectsOverlap(rects['.touch-left-controls'], rects['.touch-primary-actions'])).toBe(false);
    expect(rectsOverlap(rects['.touch-btns'], rects['.touch-primary-actions'])).toBe(false);
    expect(rects['.touch-primary-actions'].width).toBeGreaterThan(160);
    await page.locator('#audio-game-controls > summary').click();
    await expect(page.locator('body')).not.toHaveClass(/mobile-audio-open/);

    await page.setViewportSize({width:851,height:393});
    rects = await visibleRects(page, selectors);
    expect(rectsOverlap(rects['#space-nav'], rects['#game-tools'])).toBe(false);
    expect(rectsOverlap(rects['#space-nav'], rects['#settings-toggle'])).toBe(false);
    expect(rectsOverlap(rects['.touch-left-controls'], rects['.touch-btns'])).toBe(false);
    expect(rectsOverlap(rects['.touch-left-controls'], rects['.touch-primary-actions'])).toBe(false);
    expect(rectsOverlap(rects['.touch-btns'], rects['.touch-primary-actions'])).toBe(false);
    expect(rects['.touch-primary-actions'].width).toBeGreaterThan(260);
  });

  test('Q and E work beside the joystick while virtual landscape follows the finger', async ({page}) => {
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
    expect(await page.evaluate(() => window.__testEnableMobileVoice(false))).toBe(true);
    expect(await page.evaluate(() => !!window.__testMultiplayerContactPose({key:'dzikiDzik',state:'airborne',h:1400}))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__dbg?.selectedPlane)).toBe('dzikiDzik');
    await expect(page.locator('#touch-yaw-left')).toHaveText('Q');
    await expect(page.locator('#touch-yaw-right')).toHaveText('E');

    const stick = await page.locator('#stick').boundingBox();
    await page.locator('#stick').dispatchEvent('pointerdown',{pointerId:11,pointerType:'touch',clientX:stick.x+stick.width/2,clientY:stick.y+stick.height/2});
    await page.locator('#stick').dispatchEvent('pointermove',{pointerId:11,pointerType:'touch',clientX:stick.x+stick.width*.8,clientY:stick.y+stick.height/2});
    await page.locator('#touch-yaw-left').dispatchEvent('pointerdown',{pointerId:12,pointerType:'touch'});
    await expect.poll(() => page.evaluate(() => window.__dbg?.touchControl?.targetRoll)).toBeGreaterThan(.2);
    await expect.poll(() => page.evaluate(() => window.__dbg?.controls?.yaw)).toBeLessThan(-.1);
    expect(await page.evaluate(() => window.__dbg?.touchControl?.pointerId)).toBe(11);
    await page.locator('#touch-yaw-left').dispatchEvent('pointerup',{pointerId:12,pointerType:'touch'});
    await expect.poll(() => page.evaluate(() => Math.abs(window.__dbg?.controls?.yaw || 0))).toBeLessThan(.1);
    await page.locator('#touch-yaw-right').dispatchEvent('pointerdown',{pointerId:13,pointerType:'touch'});
    await expect.poll(() => page.evaluate(() => window.__dbg?.controls?.yaw)).toBeGreaterThan(.1);
    await page.locator('#touch-yaw-right').dispatchEvent('pointercancel',{pointerId:13,pointerType:'touch'});
    await expect.poll(() => page.evaluate(() => Math.abs(window.__dbg?.controls?.yaw || 0))).toBeLessThan(.1);
    await page.locator('#stick').dispatchEvent('lostpointercapture',{pointerId:11,pointerType:'touch'});
    await expect.poll(() => page.evaluate(() => window.__dbg?.touchControl?.targetRoll)).toBe(0);
    expect(await page.evaluate(() => window.__dbg?.touchControl?.pointerId)).toBeNull();

    await page.locator('#landscape-toggle').click();
    await expect(page.locator('html')).toHaveClass(/virtual-landscape/);
    const virtualStick = await page.locator('#stick').boundingBox();
    const knobBefore = await page.locator('#stick-knob').boundingBox();
    await page.mouse.move(virtualStick.x+virtualStick.width/2,virtualStick.y+virtualStick.height/2);
    await page.mouse.down();
    await page.mouse.move(virtualStick.x+virtualStick.width*.8,virtualStick.y+virtualStick.height/2);
    await page.waitForTimeout(250);
    const knobAfter = await page.locator('#stick-knob').boundingBox();
    await page.mouse.up();
    expect(knobAfter.x-knobBefore.x).toBeGreaterThan(20);
    expect(Math.abs(knobAfter.y-knobBefore.y)).toBeLessThan(4);
  });

  test('portrait parachutist keeps Street View clear and hides the controls pill', async ({page}) => {
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
    expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
    await expect(page.locator('.touch-btns')).toBeVisible();
    await expect(page.locator('#street-view-link')).toBeVisible();
    await expect(page.locator('#movement-status')).toBeHidden();
    const layout = await page.evaluate(() => {
      const street = document.querySelector('#street-view-link').getBoundingClientRect();
      const buttons = document.querySelector('.touch-btns').getBoundingClientRect();
      const status = document.querySelector('#flight-status').getBoundingClientRect();
      return {street:{...street.toJSON()}, buttons:{...buttons.toJSON()}, status:{...status.toJSON()}};
    });
    expect(layout.street.top).toBeGreaterThanOrEqual(layout.status.bottom);
    expect(layout.street.bottom).toBeLessThan(layout.buttons.top);
    await page.screenshot({path:'test-results/mobile-parachutist-portrait.png'});
  });

  test('mobile multiplayer only shows the voice pill while talk is active and clears the credits', async ({page}) => {
    await page.setViewportSize({width:851,height:393});
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
    expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
    expect(await page.evaluate(() => window.__testEnableMobileVoice(false))).toBe(true);
    await expect(page.locator('#touch-talk')).toBeVisible();
    await expect(page.locator('#voice-ind')).toBeHidden();

    expect(await page.evaluate(() => window.__testEnableMobileVoice(true))).toBe(true);
    await expect(page.locator('#voice-ind')).toBeVisible();
    await expect(page.locator('#voice-ind')).toHaveText('Talk Active');
    const layout = await page.evaluate(() => {
      const credits = document.querySelector('#map-credits');
      credits.textContent = 'Terrain: Google Maps · imagery providers';
      const creditRect = credits.getBoundingClientRect();
      const buttons = document.querySelector('.touch-btns').getBoundingClientRect();
      return {creditHeight:creditRect.height, creditTop:creditRect.top, buttonBottom:buttons.bottom};
    });
    expect(layout.creditHeight).toBeLessThanOrEqual(18);
    expect(layout.buttonBottom).toBeLessThanOrEqual(layout.creditTop);
  });

  test('mobile lobby keeps the public room link available without extra share panels', async ({page}) => {
    await page.setViewportSize({width:390,height:844});
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
    await page.getByRole('button',{name:'Multiplayer',exact:true}).click();
    expect(await page.evaluate(() => window.__testPopulateLobby(2))).toBe(2);
    await expect(page.locator('#lobby-qr')).toBeHidden();
    await expect(page.locator('#lobby-share')).toHaveCount(0);
    await expect(page.locator('#lobby-link')).toHaveValue('https://headlost.github.io/flight-over-the-world-plus/#r=test-host');
  });
});

test('opening a copied room link boots the guest lobby without freezing', async ({page}) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/#r=lns-test-room');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#loader')).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test('multiplayer aircraft labels show the nickname and live microphone icon', async ({page}) => {
  test.setTimeout(25000);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
  await page.evaluate(() => window.__forceTestMate());
  await expect(page.locator('.mate-label')).toBeVisible({timeout:15000});
  await expect(page.locator('.mate-label-name')).toHaveText('Test Pilot');
  await expect(page.locator('.mate-label-mic')).toBeVisible();
  await expect(page.locator('.mate-label')).toHaveAttribute('aria-label', 'Test Pilot is talking');
  for (const [presence, copy] of [['paused','Paused'], ['afk','AFK'], ['street-view','Street View active']]) {
    await page.evaluate(presence => window.__testReceiveLobbyMessage({t:'presence',from:'test-mate',presence}), presence);
    await expect(page.locator('.mate-label-presence')).toBeVisible();
    await expect(page.locator('.mate-label-presence')).toHaveText(copy);
    await expect(page.locator('.mate-label')).toHaveAttribute('aria-label', `Test Pilot is talking, ${copy}`);
    await expect(page.locator('.mate-label-mic')).toBeVisible();
  }
  await page.screenshot({path:'test-results/multiplayer-street-view-presence.png'});
  await page.evaluate(() => window.__testReceiveLobbyMessage({t:'presence',from:'test-mate',presence:'active'}));
  await expect(page.locator('.mate-label-presence')).toBeHidden();
  expect(await page.evaluate(() => window.__testRemoveTestMate())).toBe(true);
  await expect(page.locator('.mate-label')).toHaveCount(0);
});

test('presence is relayed under the real player id without interrupting lobby profile edits', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.locator('#btn-multi').click();
  await page.evaluate(() => window.__testPopulateLobby(3));
  await page.locator('#player-name-input').fill('Unsaved nickname');
  const result = await page.evaluate(() => {
    window.__testLobbyMessages.length = 0;
    return window.__testReceiveLobbyMessage({t:'presence',from:'test-host',presence:'afk'}, 'test-player-1');
  });
  expect(result.roster.find(p => p.id === 'test-player-1').presence).toBe('afk');
  expect(result.roster.find(p => p.id === 'test-host').presence).toBe('active');
  await expect(page.locator('[data-player-id="test-player-1"] .player-presence')).toHaveText('AFK');
  await expect(page.locator('[data-player-id="test-host"] .player-presence')).toBeHidden();
  await expect(page.locator('#player-name-input')).toHaveValue('Unsaved nickname');
  expect(await page.evaluate(() => window.__testLobbyMessages.find(m => m.kind === 'sendExcept' && m.data.t === 'presence').data.from)).toBe('test-player-1');
  await page.evaluate(() => window.__testReceiveLobbyMessage({t:'presence',presence:'street-view'}, 'test-player-2'));
  await expect(page.locator('[data-player-id="test-player-2"] .player-presence')).toHaveText('Street View active');
  await page.evaluate(() => window.__testReceiveLobbyMessage({t:'presence',presence:'unknown'}, 'test-player-1'));
  await expect(page.locator('[data-player-id="test-player-1"] .player-presence')).toHaveText('AFK');
  await page.evaluate(() => window.__testReceiveLobbyMessage({t:'hello',protocolVersion:2,name:'New Pilot',plane:'pa28'}, 'new-pilot'));
  const welcome = await page.evaluate(() => window.__testLobbyMessages.find(m => m.kind === 'sendTo' && m.id === 'new-pilot' && m.data.t === 'welcome').data);
  expect(welcome.roster.find(p => p.id === 'test-player-1').presence).toBe('afk');
  expect(welcome.roster.find(p => p.id === 'test-player-2').presence).toBe('street-view');
});

test('pause, background and Street View publish presence and clear it on return', async ({page,context}) => {
  test.setTimeout(45000);
  await context.route('https://www.google.com/**', route => route.fulfill({contentType:'text/html',body:'<title>Street View fixture</title>'}));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.evaluate(() => {
    window.__testGroundedParachutist();
    window.__testPopulateLobby(2, true);
  });
  const latestPresence = () => page.evaluate(() => window.__testLobbyMessages.filter(m => m.data.t === 'presence').at(-1)?.data.presence);
  await expect.poll(latestPresence).toBe('active');
  await page.keyboard.press('Escape');
  await expect.poll(latestPresence).toBe('paused');
  await page.locator('#btn-resume').click();
  await expect.poll(latestPresence).toBe('active');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(latestPresence).toBe('afk');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(latestPresence).toBe('paused');
  await page.locator('#btn-resume').click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {value:true,configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(latestPresence).toBe('afk');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(latestPresence).toBe('paused');
  await page.locator('#btn-resume').click();
  await page.locator('#street-view-link').click();
  const popupPromise = context.waitForEvent('page');
  await page.locator('#street-enter').click();
  const popup = await popupPromise;
  await expect.poll(latestPresence).toBe('street-view');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(latestPresence).toBe('street-view');
  await page.bringToFront();
  await page.locator('#street-return').click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(latestPresence).toBe('active');
  // Browsers may refuse script-closing a popup after its opener was cleared for security.
  if (!popup.isClosed()) await popup.close();
  await page.locator('#street-view-link').click();
  const secondPopupPromise = context.waitForEvent('page');
  await page.locator('#street-enter').click();
  const secondPopup = await secondPopupPromise;
  await expect.poll(latestPresence).toBe('street-view');
  await secondPopup.close();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#street-mode')).not.toHaveClass(/open/);
  await expect.poll(latestPresence).toBe('active');
});

test('a player not included in the round stays in the lobby when the host releases flight', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.locator('#btn-multi').click();
  await page.evaluate(() => {
    window.__testPopulateLobby(3, true);
    window.__testReceiveLobbyMessage({t:'start',mode:'free',lat:48.8584,lon:2.2945,seats:{'test-host':0}});
  });
  await expect(page.locator('#lobby')).toBeVisible();
  await page.evaluate(() => window.__testReceiveLobbyMessage({t:'go',h:160,gh:20,heading:0}));
  await expect(page.locator('#lobby')).toBeVisible();
});

test('authoritative round vehicles override a stale guest selection before loading its actual controller', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.locator('#btn-multi').click();
  const state = await page.evaluate(() => {
    window.__testPopulateLobby(2,true);
    return window.__testReceiveLobbyMessage({t:'start',protocolVersion:2,mode:'free',lat:48.8584,lon:2.2945,
      lockedPlane:'parachutist',vehicles:{'test-host':'parachutist','test-player-1':'parachutist'},
      seats:{'test-host':0,'test-player-1':1},spawnSpacing:12.15});
  });
  expect(state.selectedPlane).toBe('parachutist');
  expect(state.controller).toBe('ParachutistController');
  expect(state.model).toBe('parachutist');
  expect(state.inRound).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__testReceiveLobbyMessage().parachutistModel)).toBe(true);
  await page.evaluate(() => window.__testReceiveLobbyMessage({t:'go',h:160,gh:20,heading:0}));
  await expect(page.locator('#lobby')).toBeHidden();
});

test('QR room joins accept missing, older and newer optional version markers without kicking players', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.locator('#btn-multi').click();
  const state = await page.evaluate(() => {
    window.__testPopulateLobby(1);
    for (const protocolVersion of [undefined,1,2,3]) {
      const data = {t:'hello',name:`Client ${protocolVersion ?? 'public'}`,plane:'pa28'};
      if (protocolVersion != null) data.protocolVersion = protocolVersion;
      window.__testReceiveLobbyMessage(data, `client-${protocolVersion ?? 'public'}`);
    }
    return window.__testReceiveLobbyMessage();
  });
  expect(state.roster).toHaveLength(5);
  expect(state.roster.find(player => player.id === 'client-public').approved).toBe(false);
  await expect(page.locator('#lobby-link')).toHaveValue('https://headlost.github.io/flight-over-the-world-plus/#r=test-host');
  expect(await page.evaluate(() => window.__testLobbyMessages.some(message =>
    message.data.t === 'removed'))).toBe(false);
  for (const protocolVersion of [undefined,1,2,3]) {
    await page.evaluate(protocolVersion => {
      window.__testPopulateLobby(2,true);
      const roster = window.__testReceiveLobbyMessage().roster;
      const data = {t:'welcome',id:'test-player-1',roster};
      if (protocolVersion != null) data.protocolVersion = protocolVersion;
      window.__testReceiveLobbyMessage(data);
    }, protocolVersion);
    await expect(page.locator('#lobby')).toBeVisible();
    await expect(page.locator('#landing')).toBeHidden();
  }
});

test('a public handshake uses an authoritative locked vehicle spawn and never releases waiting players', async ({page,context}) => {
  test.setTimeout(30000);
  const guest = await context.newPage();
  await Promise.all([page,guest].map(async client => {
    await client.goto('/');
    await expect.poll(() => client.evaluate(() => !!window.__game)).toBe(true);
    await client.locator('#btn-multi').click();
  }));
  await guest.evaluate(() => window.__testPopulateLobby(1,true,'public-player'));
  await page.evaluate(() => {
    window.__testPopulateLobby(1);
    window.__testReceiveLobbyMessage({t:'hello',name:'Phone',plane:'jet'}, 'public-player');
    window.__testReceiveLobbyMessage({t:'hello',name:'Waiting phone',plane:'pa28'}, 'waiting-player');
  });
  await page.locator('[data-player-id="public-player"] .approval-toggle').check();
  await page.locator('#lobby-city').fill('48.8584, 2.2945');
  await chooseVehicle(page, 'Parachutist', true);
  await page.locator('#lobby-vehicle-lock').click();
  await page.evaluate(() => window.__testReceiveLobbyMessage({t:'ready',ready:true}, 'public-player'));
  await page.locator('#lobby-start').click();
  await expect.poll(() => page.evaluate(() => window.__testReceiveLobbyMessage().roundActive)).toBe(true);
  await page.evaluate(() => window.__testSnapMultiplayerStart());
  expect(await page.evaluate(() => window.__testReceiveLobbyMessage().goSent)).toBe(true);
  const messages = await page.evaluate(() => window.__testLobbyMessages);
  const spawn = messages.find(message => message.kind === 'sendTo' && message.id === 'public-player' && message.data.t === 'resume').data;
  expect(spawn.plane).toBe('parachutist');
  expect(spawn.pose.lat).toBeCloseTo(48.8584,3);
  expect(spawn.pose.lon).toBeCloseTo(2.2945,3);
  expect(messages.some(message => message.data.t === 'go' && (message.kind === 'send' || message.id === 'public-player'))).toBe(false);
  expect(messages.some(message => ['resume','go'].includes(message.data.t) && message.id === 'waiting-player')).toBe(false);
  // Do not deliver the new roster/start config: the existing resume path must be sufficient by itself.
  const joined = await guest.evaluate(spawn => window.__testReceiveLobbyMessage(spawn), spawn);
  expect(joined.inRound).toBe(true);
  expect(joined.controller).toBe('ParachutistController');
  expect(Math.abs(joined.lon - spawn.pose.lon)).toBeLessThan(0.001);
  await expect(guest.locator('#lobby')).toBeHidden();
  const resumeCount = await page.evaluate(() => {
    window.__testReceiveLobbyMessage({t:'snapped',h:340,gh:20,heading:0,probed:true}, 'public-player');
    return window.__testLobbyMessages.filter(message => message.id === 'public-player' && message.data.t === 'resume').length;
  });
  expect(resumeCount).toBe(1);
  await guest.close();
});

test('separate clients obey the vehicle lock, wait for leaders and allow a queued player to join near the moved host', async ({page,context}) => {
  test.setTimeout(60000);
  const leader = await context.newPage();
  const queued = await context.newPage();
  const clients = [{page,id:'test-host'}, {page:leader,id:'test-player-1'}, {page:queued,id:'test-player-2'}];
  await Promise.all(clients.map(async (client,index) => {
    await client.page.goto('/');
    await expect.poll(() => client.page.evaluate(() => !!window.__game)).toBe(true);
    await client.page.locator('#btn-multi').click();
    await client.page.evaluate(({index,id}) => window.__testPopulateLobby(3,index > 0,id), {index,id:client.id});
  }));
  await page.locator('[data-player-id="test-player-1"] .leader-toggle').click();
  await page.locator('[data-player-id="test-player-2"] .approval-toggle').check();
  await page.locator('#lobby-city').fill('48.8584, 2.2945');
  await chooseVehicle(page, 'Parachutist', true);
  await page.locator('#lobby-vehicle-lock').click();
  await flushMultiplayerControls(clients);
  for (const guest of [leader,queued]) {
    await expect(guest.locator('#lobby-car-name')).toHaveText('Parachutist');
    await expect(guest.locator('#lobby-car-next')).toBeDisabled();
    await expect(guest.locator('#multiplayer-notice')).toBeVisible();
    await expect(guest.locator('#multiplayer-notice')).toContainText('Admin locked vehicle selection');
    await expect(guest.locator('#lobby-vehicle-lock-status')).toContainText('You cannot choose another vehicle');
  }
  await page.locator('#lobby-start').click();
  await flushMultiplayerControls(clients);
  expect(await page.evaluate(() => window.__testReceiveLobbyMessage().roundActive)).toBe(false);
  await expect(page.locator('#lobby-status')).toContainText('Waiting for Admin and Leaders');
  await leader.locator('#lobby-start').click();
  await flushMultiplayerControls(clients);
  await expect.poll(() => page.evaluate(() => window.__testReceiveLobbyMessage().roundActive)).toBe(true);
  await flushMultiplayerControls(clients);
  for (const participant of [page,leader]) {
    const state = await participant.evaluate(() => window.__testReceiveLobbyMessage());
    expect(state.controller).toBe('ParachutistController');
    expect(state.selectedPlane).toBe('parachutist');
    expect(state.spawnSpacing).toBeCloseTo(12.42);
    expect(state.inRound).toBe(true);
    await participant.evaluate(() => window.__testSnapMultiplayerStart());
  }
  await flushMultiplayerControls(clients);
  expect(await page.evaluate(() => window.__testReceiveLobbyMessage().goSent)).toBe(true);
  await expect(queued.locator('#lobby')).toBeVisible();
  expect(await queued.evaluate(() => window.__testReceiveLobbyMessage().inRound)).toBe(false);
  const anchor = await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.__game.plane.lat = 52.25 * Math.PI / 180;
    window.__game.plane.lon = 16.9 * Math.PI / 180;
    return window.__testReceiveLobbyMessage();
  });
  await queued.locator('#lobby-start').click();
  await flushMultiplayerControls(clients);
  const joined = await queued.evaluate(() => window.__testReceiveLobbyMessage());
  expect(joined.inRound).toBe(true);
  expect(joined.goSent).toBe(true);
  expect(joined.goAt).toBeGreaterThan(0);
  expect(joined.controller).toBe('ParachutistController');
  expect(Math.abs(joined.lat - anchor.lat)).toBeLessThan(0.001);
  expect(Math.abs(joined.lon - anchor.lon)).toBeLessThan(0.001);
  expect(Math.abs(joined.h - anchor.h)).toBeLessThan(5);
  await expect.poll(() => queued.evaluate(() => window.__testReceiveLobbyMessage().parachutistModel)).toBe(true);
  await expect(queued.locator('#lobby')).toBeHidden();
  await leader.close();
  await queued.close();
});

test('a queued rocket joins near the host even after the host has entered space', async ({page,context}) => {
  test.setTimeout(45000);
  const guest = await context.newPage();
  const clients = [{page,id:'test-host'}, {page:guest,id:'test-player-1'}];
  await Promise.all(clients.map(async (client,index) => {
    await client.page.goto('/');
    await expect.poll(() => client.page.evaluate(() => !!window.__game)).toBe(true);
    await client.page.locator('#btn-multi').click();
    await client.page.evaluate(index => window.__testPopulateLobby(2,index > 0), index);
  }));
  await page.locator('[data-player-id="test-player-1"] .approval-toggle').check();
  await chooseVehicle(page, 'Rocket', true);
  await page.locator('#lobby-city').fill('48.8584, 2.2945');
  await page.locator('#lobby-vehicle-lock').click();
  await flushMultiplayerControls(clients);
  await page.locator('#lobby-start').click();
  await flushMultiplayerControls(clients);
  await expect.poll(() => page.evaluate(() => window.__testReceiveLobbyMessage().roundActive)).toBe(true);
  await flushMultiplayerControls(clients);
  await page.evaluate(() => window.__testSnapMultiplayerStart());
  await flushMultiplayerControls(clients);
  expect(await page.evaluate(() => window.__testReceiveLobbyMessage().goSent)).toBe(true);
  expect(await page.evaluate(() => window.__testRocketLaunch(99980,1200,true,true))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
  expect(await page.evaluate(() => window.__testReceiveLobbyMessage().inRound)).toBe(true);
  await guest.locator('#lobby-start').click();
  await flushMultiplayerControls(clients);
  const state = await guest.evaluate(() => window.__testReceiveLobbyMessage());
  expect(state.selectedPlane).toBe('rocket');
  expect(state.inRound).toBe(true);
  expect(state.space).toBe(true);
  await expect(guest.locator('#lobby')).toBeHidden();
  await expect.poll(() => guest.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
  const positions = await Promise.all(clients.map(client => client.page.evaluate(() => window.__dbg.spacePosition)));
  expect(Math.hypot(...positions[0].map((value,index) => value - positions[1][index]))).toBeLessThan(150);
  await guest.close();
});

test('the same connected players can return to the lobby and start successive vehicles and locations', async ({page,context}) => {
  test.setTimeout(90000);
  const guest = await context.newPage();
  const clients = [{page,id:'test-host'},{page:guest,id:'test-player-1'}];
  await startFixtureRound(clients);
  for (const [vehicle,city] of [['parachutist','48.8566, 2.3522'],['rocket','40.7128, -74.006'],['jet','35.6762, 139.6503']]) {
    const previous = await page.evaluate(() => window.__testReceiveLobbyMessage());
    for (const client of clients) {
      await client.page.keyboard.press('Escape');
      await client.page.locator('#btn-restart').click();
    }
    await flushMultiplayerControls(clients);
    for (const client of clients) expect((await client.page.evaluate(() => window.__testReceiveLobbyMessage())).roundActive).toBe(false);
    while ((await page.evaluate(() => window.__testReceiveLobbyMessage().selectedPlane)) !== vehicle) {
      await page.locator('#lobby-car-next').click();
    }
    await page.locator('#lobby-city').fill(city);
    await flushMultiplayerControls(clients);
    for (const client of clients) await client.page.evaluate(() => window.__testTerrainLoading());
    await guest.locator('#lobby-start').click();
    await flushMultiplayerControls(clients);
    await page.locator('#lobby-start').click();
    await flushMultiplayerControls(clients);
    const fresh = await page.evaluate(({roundId}) => {
      window.__testReceiveLobbyMessage({t:'snapped',roundId,h:340,gh:20,heading:0,probed:true},'test-player-1');
      return window.__testReceiveLobbyMessage({t:'done',roundId},'test-player-1');
    },previous);
    expect(fresh.roundId).not.toBe(previous.roundId);
    expect(fresh.snappedIds).not.toContain('test-player-1');
    expect(fresh.roster.find(player => player.id === 'test-player-1').inRound).toBe(true);
    await guest.evaluate(previous => {
      window.__testReceiveLobbyMessage({t:'go',...previous.goPayload});
      window.__testReceiveLobbyMessage({t:'roundEnd',roundId:previous.roundId});
    },previous);
    for (const client of clients) {
      const loading = await client.page.evaluate(() => window.__testReceiveLobbyMessage());
      expect(loading.inRound).toBe(true);
      expect(loading.goSent).toBe(false);
      expect(loading.selectedPlane).toBe(vehicle);
      expect(Object.keys(loading.seats)).toHaveLength(2);
    }
    for (const client of clients) await expect.poll(() => client.page.evaluate(() => window.__testReceiveLobbyMessage().waitingGo)).toBe(true);
    await flushMultiplayerControls(clients);
    for (const client of clients) {
      const flight = await client.page.evaluate(() => window.__testReceiveLobbyMessage());
      expect(flight.goSent).toBe(true);
      expect(flight.waitingGo).toBe(false);
      expect(flight.pendingSnap).toBe(false);
      expect(flight.awaitingSnap).toBe(false);
      expect(flight.loadingTimer).toBe(false);
      expect(flight.model).toBe(vehicle);
      expect(flight.controller).toBe(vehicle === 'parachutist' ? 'ParachutistController' : 'PlaneController');
      await expect(client.page.locator('#mp-wait')).toHaveClass(/hidden/);
    }
  }
  await guest.close();
});

test('valid mountain terrain near the old holding altitude releases both connected players', async ({page,context}) => {
  const guest = await context.newPage();
  const clients = [{page,id:'test-host'},{page:guest,id:'test-player-1'}];
  await startFixtureRound(clients,'pa28',false);
  for (const client of clients) await client.page.evaluate(() => window.__testSnapMultiplayerStart(5680));
  await flushMultiplayerControls(clients);
  for (const client of clients) {
    expect((await client.page.evaluate(() => window.__testReceiveLobbyMessage())).goSent).toBe(true);
    await expect(client.page.locator('#mp-wait')).toHaveClass(/hidden/);
  }
  await guest.close();
});

test('a missing first terrain acknowledgement is retried without keeping connected players on the loading screen', async ({page,context}) => {
  const guest = await context.newPage();
  const clients = [{page,id:'test-host'},{page:guest,id:'test-player-1'}];
  await startFixtureRound(clients,'pa28',false);
  await guest.evaluate(() => {
    // A loading background tab can stop drawing; the network acknowledgement
    // must still be retried by the round's synchronization timer.
    window.__ctxLost = true;
    window.__testSnapMultiplayerStart();
    window.__testLobbyMessages = window.__testLobbyMessages.filter(message => message.data.t !== 'snapped');
  });
  await page.evaluate(() => window.__testSnapMultiplayerStart());
  await flushMultiplayerControls(clients);
  expect((await page.evaluate(() => window.__testReceiveLobbyMessage())).goSent).toBe(false);
  await expect(page.locator('#mp-wait-text')).toContainText('Pilot 1');
  await expect.poll(() => guest.evaluate(() => window.__testLobbyMessages.some(message => message.data.t === 'snapped'))).toBe(true);
  await flushMultiplayerControls(clients);
  for (const client of clients) {
    expect((await client.page.evaluate(() => window.__testReceiveLobbyMessage())).goSent).toBe(true);
    await expect(client.page.locator('#mp-wait')).toHaveClass(/hidden/);
  }
  await guest.close();
});

test('terrain release continues while the Admin is in the lobby and the Admin can join afterwards', async ({page,context}) => {
  const guest = await context.newPage();
  const clients = [{page,id:'test-host'},{page:guest,id:'test-player-1'}];
  await startFixtureRound(clients,'pa28',false);
  await page.locator('#mp-wait-lobby').click();
  await flushMultiplayerControls(clients);
  await guest.evaluate(() => window.__testSnapMultiplayerStart());
  await flushMultiplayerControls(clients);
  expect((await guest.evaluate(() => window.__testReceiveLobbyMessage())).goSent).toBe(true);
  expect((await page.evaluate(() => window.__testReceiveLobbyMessage())).inRound).toBe(false);
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#mp-wait')).toHaveClass(/hidden/);
  await page.locator('#lobby-start').click();
  await flushMultiplayerControls(clients);
  expect((await page.evaluate(() => window.__testReceiveLobbyMessage())).inRound).toBe(true);
  await expect(page.locator('#mp-wait')).toHaveClass(/hidden/);
  await guest.close();
});

test('crashed guests vanish immediately, reject delayed poses and can rejoin the same active round', async ({page,context}) => {
  test.setTimeout(60000);
  const guest = await context.newPage();
  const clients = [{page,id:'test-host'},{page:guest,id:'test-player-1'}];
  await startFixtureRound(clients);
  const guestPose = await guest.evaluate(() => window.__testMultiplayerContactPose({key:'pa28',state:'airborne',h:1000,north:120}));
  await page.evaluate(pose => {
    window.__testReceiveLobbyMessage(pose,'test-player-1');
    window.__testMultiplayerContactFrame();
  },guestPose);
  expect((await page.evaluate(() => window.__testReceiveLobbyMessage())).mateIds).toContain('test-player-1');
  expect(await guest.evaluate(() => window.__testMultiplayerCrash())).toBe(true);
  await flushMultiplayerControls(clients);
  const host = await page.evaluate(pose => window.__testReceiveLobbyMessage({...pose,seq:pose.seq + 100},'test-player-1'),guestPose);
  expect(host.roundActive).toBe(true);
  expect(host.inRound).toBe(true);
  expect(host.mateIds).not.toContain('test-player-1');
  expect(host.poseIds).not.toContain('test-player-1');
  expect(host.seats['test-player-1']).toBeUndefined();
  await expect(guest.locator('#f-banner')).toHaveClass(/show/);
  await guest.locator('#banner-menu').click();
  await expect(guest.locator('#lobby-start')).toHaveText('Join game');
  await guest.locator('#lobby-start').click();
  await flushMultiplayerControls(clients);
  const joined = await guest.evaluate(() => window.__testReceiveLobbyMessage());
  expect(joined.inRound).toBe(true);
  expect(joined.crashed).toBe(false);
  expect(joined.pendingSnap).toBe(false);
  expect(joined.awaitingSnap).toBe(false);
  await expect(guest.locator('#mp-wait')).toHaveClass(/hidden/);
  await expect(guest.locator('#lobby')).toBeHidden();
  await guest.close();
});

test('the Admin can crash and rejoin twice near a living player without restarting or freezing their round', async ({page,context}) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  const guest = await context.newPage();
  const clients = [{page,id:'test-host'},{page:guest,id:'test-player-1'}];
  await startFixtureRound(clients);
  const [hostPose,guestPose] = await Promise.all(clients.map((client,index) => client.page.evaluate(index =>
    window.__testMultiplayerContactPose({key:'pa28',state:'airborne',h:1000,north:index * 1000}),index)));
  await page.evaluate(pose => window.__testReceiveLobbyMessage(pose,'test-player-1'),guestPose);
  await guest.evaluate(pose => window.__testReceiveLobbyMessage(pose),hostPose);
  for (let cycle = 0; cycle < 2; cycle += 1) {
    expect(await page.evaluate(() => window.__testMultiplayerCrash())).toBe(true);
    await flushMultiplayerControls(clients);
    const waiting = await guest.evaluate(({pose,cycle}) => window.__testReceiveLobbyMessage({...pose,seq:pose.seq + 100 + cycle}),{pose:hostPose,cycle});
    expect(waiting.roundActive).toBe(true);
    expect(waiting.inRound).toBe(true);
    expect(waiting.mateIds).not.toContain('test-host');
    expect(waiting.poseIds).not.toContain('test-host');
    if (cycle === 0) {
      await page.keyboard.press('Escape');
      await page.locator('#btn-restart').click();
    } else {
      await expect(page.locator('#f-banner')).toHaveClass(/show/);
      await page.locator('#banner-menu').click();
    }
    await expect(page.locator('#lobby-start')).toHaveText('Join game');
    await page.evaluate(() => { window.__testLobbyMessages.length = 0; });
    await page.locator('#lobby-start').click();
    const joined = await page.evaluate(() => window.__testReceiveLobbyMessage());
    expect(joined.inRound).toBe(true);
    expect(joined.crashed).toBe(false);
    expect(joined.paused).toBe(false);
    expect(joined.launching).toBe(false);
    expect(joined.pendingSnap).toBe(false);
    expect(joined.awaitingSnap).toBe(false);
    expect(joined.waitingGo).toBe(false);
    expect(Math.abs(joined.lat - guestPose.lat)).toBeLessThan(0.001);
    expect(Object.keys(joined.seats)).toHaveLength(2);
    expect(await page.evaluate(() => window.__testLobbyMessages.some(m => ['start','roundEnd'].includes(m.data.t)))).toBe(false);
    await expect(page.locator('#mp-wait')).toHaveClass(/hidden/);
    await expect(page.locator('#lobby')).toBeHidden();
    await flushMultiplayerControls(clients);
    expect((await guest.evaluate(() => window.__testReceiveLobbyMessage())).inRound).toBe(true);
    if (cycle === 0) {
      // A death banner scheduled before the immediate respawn must not cover
      // the new flight when its 900 ms delay expires.
      await page.waitForTimeout(1000);
      await expect(page.locator('#f-banner')).not.toHaveClass(/show/);
    }
  }
  expect(errors).toEqual([]);
  await guest.close();
});

test('space impacts remove the Admin and allow a direct rejoin beside an orbiting rocket', async ({page,context}) => {
  test.setTimeout(60000);
  const guest = await context.newPage();
  const clients = [{page,id:'test-host'},{page:guest,id:'test-player-1'}];
  await startFixtureRound(clients,'rocket');
  await Promise.all(clients.map(client => client.page.evaluate(() => window.__testRocketLaunch(99999,1500,true,true))));
  for (const client of clients) await expect.poll(() => client.page.evaluate(() => window.__testReceiveLobbyMessage().space)).toBe(true);
  await expect.poll(() => guest.evaluate(() => window.__testLobbyMessages.filter(m => m.data.t === 'pose').at(-1)?.data.space)).toBe(true);
  const guestPose = await guest.evaluate(() => ({
    ...window.__testLobbyMessages.filter(m => m.data.t === 'pose').at(-1).data
  }));
  await page.evaluate(pose => window.__testReceiveLobbyMessage(pose,'test-player-1'),guestPose);
  expect(await page.evaluate(() => window.__testMultiplayerCrash())).toBe(true);
  await flushMultiplayerControls(clients);
  expect((await guest.evaluate(() => window.__testReceiveLobbyMessage())).mateIds).not.toContain('test-host');
  await page.locator('#banner-menu').click();
  await page.locator('#lobby-start').click();
  const joined = await page.evaluate(() => window.__testReceiveLobbyMessage());
  expect(joined.inRound).toBe(true);
  expect(joined.crashed).toBe(false);
  expect(joined.space).toBe(true);
  await expect(page.locator('#mp-wait')).toHaveClass(/hidden/);
  await expect(page.locator('#lobby')).toBeHidden();
  await flushMultiplayerControls(clients);
  expect((await guest.evaluate(() => window.__testReceiveLobbyMessage())).inRound).toBe(true);
  // If no living player is compatible with the Admin's new vehicle, use the
  // already measured Earth start instead of reopening the terrain barrier.
  expect(await page.evaluate(() => window.__testMultiplayerCrash())).toBe(true);
  await flushMultiplayerControls(clients);
  await page.locator('#banner-menu').click();
  await page.locator('#lobby-car-next').click();
  await page.locator('#lobby-car-next').click();
  await expect(page.locator('#lobby-car-name')).toHaveText('Piper PA-28');
  await page.locator('#lobby-start').click();
  const fallback = await page.evaluate(() => window.__testReceiveLobbyMessage());
  expect(fallback.inRound).toBe(true);
  expect(fallback.space).toBe(false);
  expect(fallback.pendingSnap).toBe(false);
  expect(fallback.awaitingSnap).toBe(false);
  expect(fallback.crashed).toBe(false);
  await expect(page.locator('#mp-wait')).toHaveClass(/hidden/);
  await flushMultiplayerControls(clients);
  const stillOrbiting = await guest.evaluate(() => window.__testReceiveLobbyMessage());
  expect(stillOrbiting.inRound).toBe(true);
  expect(stillOrbiting.space).toBe(true);
  await guest.close();
});

test('large multiplayer lobbies scroll and keep chat below the QR panel', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.getByRole('button',{name:'Multiplayer',exact:true}).click();
  expect(await page.evaluate(() => window.__testPopulateLobby(40))).toBe(40);
  await expect(page.locator('#lobby-players .player-row')).toHaveCount(40);
  await expect(page.locator('#lobby-chat-count')).toHaveText('40 players');
  await expect(page.locator('#lobby-link')).toHaveValue('https://headlost.github.io/flight-over-the-world-plus/#r=test-host');
  await expect(page.locator('.lobby-qr-actions button')).toHaveCount(1);
  await expect(page.locator('#lobby-qr-copy')).toHaveText('Copy QR');
  await expect(page.locator('[data-player-id="test-host"] .player-role-badge')).toHaveText('Admin');
  await expect(page.locator('[data-player-id="test-host"] .player-role-badge')).toHaveClass(/admin/);
  await expect(page.locator('[data-player-id="test-host"] .player-moderation')).toHaveCount(0);
  await expect(page.locator('[data-player-id="test-host"] .approval-toggle')).toBeChecked();
  await expect(page.locator('[data-player-id="test-host"] .approval-toggle')).toBeDisabled();
  await expect(page.locator('[data-player-id="test-player-1"] .mute-toggle')).toHaveText('Mute');
  await expect(page.locator('[data-player-id="test-player-1"] .remove-player')).toHaveText('Remove');
  await expect(page.locator('[data-player-id="test-player-1"] .approval-toggle')).not.toBeChecked();
  await page.locator('[data-player-id="test-player-1"] .approval-toggle').click();
  await expect(page.locator('[data-player-id="test-player-1"] .approval-toggle')).toBeChecked();

  for (let index = 1; index <= 3; index += 1) {
    await page.locator(`[data-player-id="test-player-${index}"] .leader-toggle`).click();
  }
  await expect(page.locator('.player-role-badge.leader')).toHaveCount(3);

  await page.locator('[data-player-id="test-player-5"] .mute-toggle').click();
  await expect(page.locator('[data-player-id="test-player-5"] .mute-toggle')).toHaveText('Unmute');
  await expect(page.locator('[data-player-id="test-player-5"] .muted-badge')).toHaveText('Muted');
  await page.locator('[data-player-id="test-player-5"] .mute-toggle').click();
  await expect(page.locator('[data-player-id="test-player-5"] .muted-badge')).toHaveCount(0);
  await expect(page.locator('[data-player-id="test-player-1"] .player-role-badge')).toHaveText('Leader');
  await expect(page.locator('[data-player-id="test-player-1"] .approval-toggle')).toBeChecked();
  await expect(page.locator('[data-player-id="test-player-1"] .approval-toggle')).toBeDisabled();
  await expect(page.locator('[data-player-id="test-player-4"] .leader-toggle')).toBeDisabled();

  await page.locator('[data-player-id="test-player-1"] .leader-toggle').click();
  await expect(page.locator('[data-player-id="test-player-4"] .leader-toggle')).toBeEnabled();
  await page.locator('[data-player-id="test-player-4"] .leader-toggle').click();
  await expect(page.locator('.player-role-badge.leader')).toHaveCount(3);

  const list = await page.locator('#lobby-players').evaluate(node => ({
    overflowY:getComputedStyle(node).overflowY,
    clientHeight:node.clientHeight,
    scrollHeight:node.scrollHeight,
  }));
  expect(list.overflowY).toBe('auto');
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);

  await page.locator('#lobby-chat-input').fill('<b>Hello all pilots</b>');
  await page.locator('#lobby-chat-form button').click();
  await expect(page.locator('.lobby-chat-message p')).toHaveText('<b>Hello all pilots</b>');
  await expect(page.locator('.lobby-chat-author')).toHaveClass(/role-admin/);
  await expect(page.locator('#lobby-chat-messages b')).toHaveCount(0);

  const railLayout = await page.evaluate(() => {
    const qr = document.querySelector('#lobby-qr');
    const chat = document.querySelector('#lobby-chat');
    qr.hidden = false;
    const qrRect = qr.getBoundingClientRect();
    const chatRect = chat.getBoundingClientRect();
    return {qrBottom:qrRect.bottom, chatTop:chatRect.top, chatWidth:chatRect.width};
  });
  expect(railLayout.chatTop).toBeGreaterThan(railLayout.qrBottom);
  expect(railLayout.chatWidth).toBeGreaterThanOrEqual(210);
  await page.locator('.player-row[data-player-id="test-host"]').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/lobby-scroll-chat.png',fullPage:true});
});

test('admin vehicle cube forces the lobby selection and ready profiles reject edits', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.locator('#btn-multi').click();
  expect(await page.evaluate(() => window.__testPopulateLobby(4))).toBe(4);
  await page.locator('[data-player-id="test-player-1"] .approval-toggle').check();
  await page.locator('[data-player-id="test-player-2"] .leader-toggle').click();
  await page.locator('#lobby-car-next').click();
  await page.locator('#lobby-vehicle-lock').click();
  await expect(page.locator('#lobby-vehicle-lock')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#lobby-car-next')).toBeEnabled();
  await expect(page.locator('.p-plane')).toHaveText(Array(4).fill('Dash 8 Q400'));
  await page.locator('#lobby-car-next').click();
  await expect(page.locator('.p-plane')).toHaveText(Array(4).fill('Cessna Citation'));

  const rejected = await page.evaluate(() => {
    window.__testLobbyMessages.length = 0;
    return window.__testReceiveLobbyMessage({t:'plane',plane:'jet'}, 'test-player-1');
  });
  expect(rejected.roster.find(p => p.id === 'test-player-1').plane).toBe('citation');
  expect(await page.evaluate(() => window.__testLobbyMessages.some(m => m.kind === 'sendExcept' && m.data.t === 'plane'))).toBe(false);

  const joined = await page.evaluate(() => window.__testReceiveLobbyMessage({t:'hello',protocolVersion:2,name:'New Pilot',plane:'rocket'}, 'test-new-player'));
  expect(joined.roster.find(p => p.id === 'test-new-player').plane).toBe('citation');
  expect(await page.evaluate(() => window.__testLobbyMessages.find(m => m.kind === 'sendTo' && m.id === 'test-new-player' && m.data.t === 'welcome').data.lockedPlane)).toBe('citation');

  await page.evaluate(() => window.__testReceiveLobbyMessage({t:'ready',ready:true}, 'test-player-1'));
  await expect(page.locator('[data-player-id="test-player-1"] .p-name-input')).toBeDisabled();
  const frozen = await page.evaluate(() => window.__testReceiveLobbyMessage({t:'name',name:'Changed after start'}, 'test-player-1'));
  expect(frozen.roster.find(p => p.id === 'test-player-1').name).toBe('Pilot 1');
  const repeatedHello = await page.evaluate(() => window.__testReceiveLobbyMessage({t:'hello',name:'Reset profile',plane:'rocket'}, 'test-player-1'));
  expect(repeatedHello.roster.find(p => p.id === 'test-player-1')).toMatchObject({name:'Pilot 1',plane:'citation',ready:true});
  expect(await page.evaluate(() => {
    window.__testLobbyMessages.length = 0;
    window.__testReceiveLobbyMessage({t:'pose',plane:'rocket',lat:52,lon:16,h:400,heading:0,pitch:0,roll:0,seq:1,at:1000}, 'test-player-1');
    return window.__testLobbyMessages.some(m => m.kind === 'sendExcept' && m.data.t === 'pose');
  })).toBe(false);

  await page.locator('#lobby-start').click();
  await expect(page.locator('#lobby-start')).toHaveText('Cancel ready');
  await expect(page.locator('#player-name-input')).toBeDisabled();
  await expect(page.locator('#player-name-input').locator('..').getByRole('button', {name:'Save'})).toBeDisabled();
  await expect(page.locator('#lobby-car-next')).toBeDisabled();
  await expect(page.locator('#lobby-vehicle-lock')).toBeDisabled();
  const ownName = await page.evaluate(() => {
    const form = document.querySelector('#player-name-input').form;
    form.elements.nickname.value = 'Blocked rename';
    form.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}));
    return window.__testReceiveLobbyMessage().roster.find(p => p.id === 'test-host').name;
  });
  expect(ownName).toBe('Host');
  await page.locator('#lobby-car-next').dispatchEvent('click');
  await expect(page.locator('#lobby-car-name')).toHaveText('Cessna Citation');
  await page.locator('#lobby-start').click();
  await expect(page.locator('#player-name-input')).toBeEnabled();
  await expect(page.locator('#lobby-car-next')).toBeEnabled();
  await page.locator('#lobby-vehicle-lock').click();
  await expect(page.locator('#lobby-vehicle-lock')).toHaveAttribute('aria-pressed', 'false');
  const stillFrozen = await page.evaluate(() => window.__testReceiveLobbyMessage({t:'plane',plane:'rocket'}, 'test-player-1'));
  expect(stillFrozen.roster.find(p => p.id === 'test-player-1').plane).toBe('citation');
  await page.evaluate(() => window.__testReceiveLobbyMessage({t:'ready',ready:false}, 'test-player-1'));
  await expect(page.locator('[data-player-id="test-player-1"] .p-name-input')).toBeEnabled();
  const editable = await page.evaluate(() => window.__testReceiveLobbyMessage({t:'plane',plane:'rocket'}, 'test-player-1'));
  expect(editable.roster.find(p => p.id === 'test-player-1').plane).toBe('rocket');
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#lobby-vehicle-lock')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/lobby-vehicle-lock-mobile.png',fullPage:true});
});

test('guest vehicle lock follows the admin and Start freezes its own profile until cancellation', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.locator('#btn-multi').click();
  expect(await page.evaluate(() => window.__testPopulateLobby(3, true))).toBe(3);
  await expect(page.locator('#lobby-vehicle-lock')).toHaveCount(0);
  await page.evaluate(() => {
    const roster = window.__testReceiveLobbyMessage().roster.map(p => ({...p,plane:'rocket'}));
    window.__testReceiveLobbyMessage({t:'welcome',protocolVersion:2,id:'test-player-1',name:'Pilot 1',roster,lockedPlane:'rocket',roundActive:false,mode:'free'});
  });
  await expect(page.locator('#lobby-car-name')).toHaveText('Rocket');
  await expect(page.locator('#lobby-car-next')).toBeDisabled();
  await expect(page.locator('#player-name-input')).toBeEnabled();
  await expect(page.locator('#lobby-vehicle-lock-status')).toContainText('Admin locked vehicle selection to Rocket');
  await page.locator('#lobby-car-next').dispatchEvent('click');
  await expect(page.locator('#lobby-car-name')).toHaveText('Rocket');
  await page.locator('#lobby-start').click();
  await expect(page.locator('#player-name-input')).toBeDisabled();
  await expect(page.locator('#lobby-vehicle-lock-status')).toContainText('cancel ready');
  await page.locator('#lobby-start').click();
  await expect(page.locator('#player-name-input')).toBeEnabled();
  await expect(page.locator('#lobby-car-next')).toBeDisabled();
  await page.evaluate(() => {
    const players = window.__testReceiveLobbyMessage().roster.map(p => ({...p,ready:false}));
    window.__testReceiveLobbyMessage({t:'roster',players,lockedPlane:'',roundActive:false});
  });
  await expect(page.locator('#lobby-car-next')).toBeEnabled();
  await page.locator('#lobby-car-next').click();
  await expect(page.locator('#lobby-car-name')).toHaveText('Parachutist');
  await page.locator('#lobby-start').click();
  await expect(page.locator('#lobby-car-next')).toBeDisabled();
  await page.evaluate(() => {
    const players = window.__testReceiveLobbyMessage().roster.map(p => ({...p,ready:false}));
    window.__testReceiveLobbyMessage({t:'roster',players,lockedPlane:'',roundActive:false});
  });
  await expect(page.locator('#player-name-input')).toBeEnabled();
  await expect(page.locator('#lobby-car-next')).toBeEnabled();
});

test('music toggles stay synchronized between vehicle selection and gameplay', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Single player',exact:true}).click();
  await expect(page.locator('#music-menu-toggle')).toHaveText('🔊 Music on');
  await page.locator('#music-menu-toggle').click();
  await expect(page.locator('#music-menu-toggle')).toHaveText('🔇 Music off');
  await expect(page.locator('#music-lobby-toggle')).toHaveText('🔇 Music off');
  expect(await page.evaluate(() => ({muted:window.__bgm.muted, paused:window.__bgm.paused, saved:localStorage.getItem('fotw-music-muted')})))
    .toEqual({muted:true, paused:true, saved:'1'});

  expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
  await expect(page.locator('#game-tools')).toBeVisible();
  await expect(page.locator('#music-game-toggle')).toHaveText('🔇 Music off');
  await page.locator('#music-game-toggle').click();
  await expect(page.locator('#music-menu-toggle')).toHaveText('🔊 Music on');
  expect(await page.evaluate(() => ({muted:window.__bgm.muted, saved:localStorage.getItem('fotw-music-muted')})))
    .toEqual({muted:false, saved:'0'});
});

test('parachutist is selectable and its animated model is bundled', async ({page}) => {
  const model = await page.request.get('/models/parachutist.glb');
  expect(model.ok()).toBe(true);
  expect((await model.body()).subarray(0, 4).toString()).toBe('glTF');
  await page.goto('/');
  await page.getByRole('button',{name:'Single player',exact:true}).click();
  await chooseVehicle(page, 'Parachutist');
  await expect(page.locator('#car-name')).toHaveText('Parachutist');
  await expect(page.locator('#car-desc')).toContainText('Land on roofs or streets');
  await expect(page.locator('body')).toHaveClass(/parachutist-selected/);
});

test('right-dragging upward helps a landed parachutist climb after Space', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
  await page.keyboard.press('Space');
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({button:'right'});
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 180, {steps:8});
  await expect.poll(() => page.evaluate(() => window.__dbg?.parachutistCameraClimb)).toBeGreaterThan(0.8);
  const assistedHeight = await page.evaluate(() => window.__dbg.height);
  await expect.poll(() => page.evaluate(() => window.__dbg.height)).toBeGreaterThan(assistedHeight + 1);
  await page.mouse.up({button:'right'});
  await expect.poll(() => page.evaluate(() => window.__dbg?.parachutistCameraClimb)).toBeLessThan(0.1);
});

test('multiplayer contact nudges a player without destroying their vehicle', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
  const result = await page.evaluate(() => window.__testSoftPlayerBump());
  expect(result.applied).toBe(true);
  expect(result.moved).toBeGreaterThan(0.05);
  expect(result.wasCrashed).toBe(false);
  expect(result.crashed).toBe(false);
});

test('walking bodies, flying parachutists and every aircraft detect real pose contacts', async ({page}) => {
  test.setTimeout(45000);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.evaluate(() => window.__testPopulateLobby(2));
  for (const [key,state,distance] of [['parachutist','grounded',0.5],['parachutist','airborne',8.5],
    ['pa28','airborne',10],['q400','airborne',26],['citation','airborne',15],
    ['jet','airborne',9],['rocket','airborne',11]]) {
    const result = await page.evaluate(({key,state,distance}) => {
      const pose = window.__testMultiplayerContactPose({key,state});
      window.__testLobbyMessages.length = 0;
      window.__testReceiveLobbyMessage({...pose,from:'test-player-1',
        lon:pose.lon + distance / (6378137 * Math.cos(pose.lat * Math.PI / 180)) * 180 / Math.PI},'test-player-1');
      const frame = window.__testMultiplayerContactFrame();
      return {...frame,bump:window.__testLobbyMessages.find(m => m.data.t === 'bump')?.data};
    },{key,state,distance});
    expect(result.moved,key).toBeGreaterThan(0.05);
    expect(Math.hypot(result.bump.ix,result.bump.iy,result.bump.iz),key).toBeGreaterThan(0.5);
    expect(result.crashed,key).toBe(false);
  }
});

test('two real clients receive full opposite impulses and characters can stand on one another', async ({page,context}) => {
  test.setTimeout(45000);
  const guest = await context.newPage();
  await Promise.all([page,guest].map(async client => {
    await client.goto('/');
    await expect.poll(() => client.evaluate(() => !!window.__game)).toBe(true);
  }));
  const [hostPose,guestPose] = await Promise.all([page,guest].map((client,index) => client.evaluate(index => {
    window.__testPopulateLobby(2,index > 0);
    return window.__testMultiplayerContactPose({east:index * 0.5});
  },index)));
  await guest.evaluate(pose => window.__testReceiveLobbyMessage(pose),hostPose);
  const host = await page.evaluate(pose => {
    window.__testReceiveLobbyMessage(pose,'test-player-1');
    window.__testMultiplayerContactFrame();
    return window.__testLobbyMessages.find(m => m.data.t === 'bump').data;
  },guestPose);
  expect(Math.hypot(host.ix,host.iy,host.iz)).toBeGreaterThan(0.5);
  const reaction = await guest.evaluate(bump => {
    window.__testReceiveLobbyMessage(bump);
    return window.__testMultiplayerContactFrame();
  },host);
  expect(Math.hypot(...reaction.velocity)).toBeGreaterThan(0.5);
  expect(reaction.crashed).toBe(false);
  const stack = await page.evaluate(() => {
    const pose = window.__testMultiplayerContactPose({state:'airborne',h:101.72});
    window.__testReceiveLobbyMessage({...pose,from:'test-player-1',h:100,state:'grounded'},'test-player-1');
    return window.__testMultiplayerContactFrame();
  });
  expect(stack.supportedBy).toBe('test-player-1');
  expect(stack.state).toBe('grounded');
  expect(stack.h).toBeCloseTo(101.72,2);
  expect(stack.crashed).toBe(false);
  await guest.close();
});

test('a paused admin still relays contacts between guests and rejects distant bumps', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  const result = await page.evaluate(() => {
    window.__testPopulateLobby(4);
    const pose = window.__testMultiplayerContactPose();
    for (const id of ['test-player-1','test-player-2','test-player-3']) window.__testReceiveLobbyMessage({...pose,from:id},id);
    window.dispatchEvent(new Event('blur'));
    window.__testLobbyMessages.length = 0;
    window.__testReceiveLobbyMessage({t:'bump',target:'test-player-2',ix:2,iy:0,iz:0},'test-player-1');
    window.__testReceiveLobbyMessage({t:'bump',target:'test-player-3',ix:2,iy:0,iz:0},'test-player-1');
    const relayed = window.__testLobbyMessages.find(m => m.data.t === 'bump');
    const nearbyBumps = window.__testLobbyMessages.filter(m => m.data.t === 'bump').length;
    window.__testReceiveLobbyMessage({...pose,seq:pose.seq + 1,from:'test-player-2',lon:pose.lon + 1},'test-player-2');
    window.__testLobbyMessages.length = 0;
    window.__testReceiveLobbyMessage({t:'bump',target:'test-player-2',ix:2,iy:0,iz:0},'test-player-1');
    return {relayed,nearbyBumps,distantBumps:window.__testLobbyMessages.filter(m => m.data.t === 'bump').length};
  });
  expect(result.relayed.kind).toBe('sendTo');
  expect(result.relayed.id).toBe('test-player-2');
  expect(result.relayed.data.from).toBe('test-player-1');
  expect(result.relayed.data.ix).toBe(2);
  expect(result.nearbyBumps).toBe(2);
  expect(result.distantBumps).toBe(0);
});

test('nearby first-person characters keep pause, AFK and Street View labels above their heads', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  await page.evaluate(() => {
    window.__testGroundedParachutist();
    window.__forceTestMate({aheadM:2,eastM:0,firstPerson:true});
  });
  for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    for (const [presence,copy] of [['paused','Paused'],['afk','AFK'],['street-view','Street View active']]) {
      await page.evaluate(presence => window.__testReceiveLobbyMessage({t:'presence',from:'test-mate',presence}),presence);
      await expect(page.locator('.mate-label-presence')).toBeVisible();
      await expect(page.locator('.mate-label-presence')).toHaveText(copy);
      const bounds = await page.locator('.mate-label').boundingBox();
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    }
  }
  await page.screenshot({path:'test-results/nearby-first-person-presence.png'});
});

test('real pause, background and Street View events reach another player overhead', async ({page,context}) => {
  test.setTimeout(45000);
  await context.route('https://www.google.com/**', route => route.fulfill({contentType:'text/html',body:'<title>Street View fixture</title>'}));
  const guest = await context.newPage();
  const clients = [{page,id:'test-host'},{page:guest,id:'test-player-1'}];
  await Promise.all(clients.map(async (client,index) => {
    await client.page.goto('/');
    await expect.poll(() => client.page.evaluate(() => !!window.__game)).toBe(true);
    await client.page.evaluate(index => window.__testPopulateLobby(2,index > 0),index);
  }));
  const [hostPose,guestPose] = await Promise.all(clients.map((client,index) => client.page.evaluate(index =>
    window.__testMultiplayerContactPose({north:index * 2}),index)));
  await page.evaluate(pose => window.__testReceiveLobbyMessage(pose,'test-player-1'),guestPose);
  await guest.evaluate(pose => window.__testReceiveLobbyMessage(pose),hostPose);
  await guest.bringToFront();
  const expectOverhead = async copy => {
    await flushMultiplayerControls(clients);
    await page.evaluate(() => window.__testMultiplayerContactFrame());
    await expect(page.locator('.mate-label-presence')).toBeVisible();
    await expect(page.locator('.mate-label-presence')).toHaveText(copy);
  };
  await guest.keyboard.press('Escape');
  await expectOverhead('Paused');
  await guest.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expectOverhead('AFK');
  await guest.evaluate(() => window.dispatchEvent(new Event('focus')));
  await guest.locator('#btn-resume').click();
  await guest.locator('#street-view-link').click();
  const popupPromise = context.waitForEvent('page');
  await guest.locator('#street-enter').click();
  const popup = await popupPromise;
  await expectOverhead('Street View active');
  await popup.close();
  await guest.close();
});

test('fighter streams terrain in smooth batches without lowering detail', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testFighterFlight())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.selectedPlane)).toBe('jet');
  await expect.poll(() => page.evaluate(() => window.__dbg?.terrainFastFlight)).toBe(true);
  expect(await page.evaluate(() => window.__dbg.terrainErrorTarget)).toBe(7);
  expect(await page.evaluate(() => window.__dbg.terrainMaxTilesProcessed)).toBeLessThanOrEqual(84);
  expect(await page.evaluate(() => window.__dbg.terrainParseJobs)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => window.__dbg.terrainCameraCount)).toBe(1);
  expect(await page.evaluate(() => window.__dbg.terrainLoadAncestors)).toBe(false);
  expect(await page.evaluate(() => window.__dbg.terrainLoadSiblings)).toBe(false);
  await page.evaluate(() => window.__testFighterFlight(150, 12000));
  await expect.poll(() => page.evaluate(() => window.__dbg?.terrainErrorTarget)).toBe(7);
  expect(await page.evaluate(() => window.__dbg.terrainResolutionScale)).toBe(1);
  expect(await page.evaluate(() => window.__dbg.terrainViewDistance)).toBeLessThan(90000);
});

test('aircraft keeps its course while terrain loading stretches frame times', async ({page}) => {
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>!!window.__game)).toBe(true);
  await page.evaluate(()=>window.__testFighterFlight());
  const course=await page.evaluate(()=>window.__game.plane.heading);
  await page.clock.install();
  await page.clock.runFor(3000);
  const change=await page.evaluate(start=>{
    const current=window.__game.plane.heading;
    return Math.abs(Math.atan2(Math.sin(current-start),Math.cos(current-start)));
  },course);
  expect(change).toBeLessThan(0.01);
});

test('rocket launcher advertises orbital controls and exposes every destination', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Single player',exact:true}).click();
  await chooseVehicle(page, 'Rocket');
  await expect(page.locator('#car-name')).toHaveText('Rocket');
  await expect(page.locator('#car-desc')).toContainText('R vertical launch to orbit');
  await expect(page.locator('#space-targets button')).toHaveCount(11);
  await expect(page.locator('#space-nav')).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/rocket-selected/);
});

test('Street View return control stays above the panorama layer', async ({page}) => {
  await page.goto('/');
  const layers = await page.evaluate(() => ({
    panorama: Number(getComputedStyle(document.querySelector('#streetview')).zIndex),
    controls: Number(getComputedStyle(document.querySelector('.street-mode-hud')).zIndex),
  }));
  expect(layers.controls).toBeGreaterThan(layers.panorama);
  await expect(page.locator('#street-return')).toContainText('Return to game');
});

test('rocket crosses into orbit, selects Mars and engages hyperdrive', async ({page}) => {
  test.setTimeout(30000);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testRocketLaunch())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
  await expect(page.locator('#space-nav')).toBeVisible();
  await expect(page.locator('#space-mode-label')).toContainText('Earth orbit');
  await page.locator('#space-targets [data-body=Mars]').click();
  await expect.poll(() => page.evaluate(() => window.__dbg?.target)).toBe('Mars');
  const cruise = await page.evaluate(() => window.__dbg.spaceSpeed);
  await page.keyboard.down('Shift');
  await expect.poll(() => page.evaluate(() => window.__dbg?.hyperdrive)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceSpeed)).toBeGreaterThan(cruise + 100);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceCameraDistance)).toBeLessThan(22);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketPlume?.visible)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketPlume?.space)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketPlume?.color)).toBe('#147cff');
  await page.keyboard.up('Shift');
  const cameraBefore = await page.evaluate(() => ({...window.__dbg.spaceCameraOrbit}));
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 - 30, {steps:6});
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceCameraOrbit?.yaw)).not.toBeCloseTo(cameraBefore.yaw, 2);
  await page.mouse.wheel(0, 420);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceCameraOrbit?.zoom)).toBeGreaterThan(cameraBefore.zoom);
  await page.mouse.wheel(0, -5000);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceCameraOrbit?.zoom)).toBeLessThanOrEqual(0.21);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceCameraDistance)).toBeLessThan(5);
});

test('space flight briefly suggests orbit and planet entry controls', async ({page}) => {
  test.setTimeout(15000);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testRocketLaunch())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);

  expect(await page.evaluate(() => window.__testSpaceApproach('Mars', 180, 28))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceActionHint?.key)).toBe('R');
  await expect(page.locator('#space-action-hint')).toBeVisible();
  await expect(page.locator('#space-action-key')).toHaveText('R');
  await expect(page.locator('#space-action-copy')).toContainText('Mars orbit');
  expect(await page.locator('#space-action-key').evaluate((node) => getComputedStyle(node).animationName)).toContain('space-action-pulse');

  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__dbg?.orbitBody)).toBe('Mars');
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceActionHint?.key)).toBe('E');
  await expect(page.locator('#space-action-key')).toHaveText('E');
  await expect(page.locator('#space-action-copy')).toContainText('Enter Mars');

  expect(await page.evaluate(() => window.__testSpaceApproach('Sun', 40, 28))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceActionHint)).toBe(null);
  await expect(page.locator('#space-action-hint')).toBeHidden();
});

test('rocket launch moves from a rear camera to an angled atmospheric view', async ({page}) => {
  test.setTimeout(15000);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testRocketLaunch(20000))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketLaunch)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.camDist)).toBeLessThan(13);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketLaunchCameraLocal?.[2])).toBeGreaterThan(9);
  await expect.poll(() => page.evaluate(() => window.__dbg?.skySpaceBlend)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketPlume?.visible)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketPlume?.space)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketPlume?.color)).toBe('#ffa21a');
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketLaunchCameraPhase), {timeout:6000}).toBeGreaterThan(0.98);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketLaunchCameraLocal?.[0])).toBeLessThan(-6.5);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketLaunchCameraLocal?.[1])).toBeGreaterThan(17);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketLaunchCameraLocal?.[2])).toBeLessThan(-9.5);
});

test('rocket launch has the faster ascent profile', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testRocketLaunch(1000, null))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketLaunchVelocity)).toBeGreaterThanOrEqual(225);
});

test('multiplayer rockets can travel through space and render nearby players', async ({page}) => {
  test.setTimeout(25000);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testRocketLaunch(99980, 1200, true))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__testLastMpMessage?.space)).toBe(true);
  expect(await page.evaluate(() => window.__testSpaceMatePose())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__testSpaceMateState()?.visible)).toBe(true);
  const mate = await page.evaluate(() => window.__testSpaceMateState());
  expect(mate.distance).toBeGreaterThan(0);
  expect(mate.distance).toBeLessThan(6);
  expect(mate.scale).toBeCloseTo(0.16, 3);
});

test('space environments support reentry, planetary surface flight and the black-hole farm return', async ({page}) => {
  test.setTimeout(30000);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testRocketLaunch())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
  const earthTexture = await page.request.get('/textures/space/earth.jpg');
  const galaxyTexture = await page.request.get('/textures/space/milky-way.jpg');
  const blackHoleScore = await page.request.get('/music/no-time-for-caution.mp3');
  const tesseractVideo = await page.request.get('/assets/tesseract.mp4');
  const tesseractPoster = await page.request.get('/assets/tesseract-poster.jpg');
  expect(earthTexture.ok()).toBe(true);
  expect(galaxyTexture.ok()).toBe(true);
  expect(blackHoleScore.ok()).toBe(true);
  expect(tesseractVideo.ok()).toBe(true);
  expect(tesseractPoster.ok()).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceTextures?.loaded), {timeout:10000})
    .toBe(await page.evaluate(() => window.__dbg.spaceTextures.total));
  expect(await page.evaluate(() => window.__dbg.spaceTextures.failed)).toBe(0);

  await page.locator('#space-enter').click();
  await expect.poll(() => page.evaluate(() => window.__dbg?.earthReentry)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.camDist)).toBeLessThan(18);
  await expect.poll(() => page.evaluate(() => window.__dbg?.skySpaceBlend)).toBeGreaterThan(0.9);
  await expect(page.locator('#space-nav')).toBeHidden();
  await page.evaluate(() => { window.__game.plane.height = window.__dbg.groundAlt + 6001; });
  await expect.poll(() => page.evaluate(() => window.__dbg?.earthReentry)).toBe(false);

  expect(await page.evaluate(() => window.__testRocketLaunch())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
  expect(await page.evaluate(() => window.__testSpaceApproach('Mars', -0.2, 28, true))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceSurfaceBody)).toBe('Mars');
  await expect(page.locator('#space-mode-label')).toContainText('surface flight');
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__dbg?.orbitBody)).toBe('Mars');

  expect(await page.evaluate(() => window.__testSpaceApproach('Galactic Core', 10000, 92))).toBe(true);
  await expect(page.locator('body')).not.toHaveClass(/black-hole-gravity/);
  await expect.poll(() => page.evaluate(() => window.__dbg?.music?.blackHole?.proximity || 0)).toBe(0);
  expect(await page.evaluate(() => window.__testSpaceApproach('Galactic Core', 4000, 92))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.blackHoleGravity?.intensity || 0)).toBeGreaterThan(0.35);
  await expect(page.locator('body')).toHaveClass(/black-hole-gravity/);
  await expect.poll(() => page.evaluate(() => window.__dbg?.music?.blackHole?.proximity || 0)).toBeGreaterThan(0.4);
  await expect.poll(() => page.evaluate(() => window.__dbg?.music?.gain ?? 1)).toBeLessThan(0.04);
  await expect.poll(() => page.evaluate(() => window.__dbg?.music?.blackHole?.gain || 0)).toBeGreaterThan(0.18);
  await expect.poll(() => page.evaluate(() => window.__dbg?.music?.blackHole?.crossfadeActive)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.music?.blackHole?.time || 0)).toBeGreaterThanOrEqual(45);
  expect(await page.evaluate(() => window.__testSpaceApproach('Galactic Core', -1, 60))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.blackHoleCaptureProgress || 0)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__dbg?.blackHoleCameraShake || 0)).toBeGreaterThan(0);
  await expect(page.locator('#interstellar')).toHaveClass(/show/);
  await expect.poll(() => page.evaluate(() => window.__dbg?.music?.blackHole?.time || 0)).toBeGreaterThan(200);
  expect(await page.evaluate(() => window.__testDropBlackHoleFinishTimer())).toBe(true);
  await expect(page.locator('#interstellar')).toHaveClass(/silent-void/);
  await expect(page.locator('#transit-status')).toBeHidden();
  await expect(page.locator('#transit-countdown')).toBeHidden();
  await expect(page.locator('#interstellar')).not.toHaveClass(/silent-void/, {timeout:2000});
  await expect(page.locator('#interstellar')).toHaveClass(/countdown-only/);
  await expect(page.locator('#transit-countdown')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__dbg?.music?.blackHole?.gain || 0)).toBeGreaterThan(0.4);
  await expect(page.locator('#transit-countdown span')).toBeHidden();
  await expect(page.locator('#transit-status')).toBeHidden();
  await expect(page.locator('#interstellar')).toHaveClass(/approach-phase/, {timeout:2000});
  await expect(page.locator('#tesseract-video')).toBeVisible();
  expect(await page.locator('#tesseract-video').evaluate(video => getComputedStyle(video).animationName)).toBe('tesseract-video-approach');
  const approachFrame = await page.locator('#tesseract-video').evaluate(video => {
    const rect = video.getBoundingClientRect();
    return {
      centerX: (rect.left + rect.right) / 2,
      centerY: (rect.top + rect.bottom) / 2,
      viewportX: innerWidth / 2,
      viewportY: innerHeight / 2,
    };
  });
  expect(approachFrame.centerX).toBeCloseTo(approachFrame.viewportX, 0);
  expect(approachFrame.centerY).toBeCloseTo(approachFrame.viewportY, 0);
  await page.screenshot({path:'test-results/tesseract-video-approach.png'});
  await expect(page.locator('#interstellar')).toHaveClass(/tesseract-phase/, {timeout:3000});
  await expect(page.locator('#transit-status')).toBeVisible();
  await expect(page.locator('#tesseract-video')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__dbg?.tesseractVideo?.readyState || 0)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.__dbg?.tesseractVideo?.paused)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__dbg?.tesseractVideo?.currentTime || 0)).toBeGreaterThan(0);
  const transitFrame = await page.locator('#tesseract-video').evaluate(video => {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    return {left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight, objectFit: style.objectFit, objectPosition: style.objectPosition};
  });
  expect(transitFrame).toMatchObject({left: 0, top: 0, objectFit: 'cover', objectPosition: '50% 50%'});
  expect(transitFrame.width).toBeCloseTo(transitFrame.viewportWidth, 0);
  expect(transitFrame.height).toBeCloseTo(transitFrame.viewportHeight, 0);
  await page.screenshot({path:'test-results/tesseract-video-transit.png'});
  expect(await page.evaluate(() => window.__dbg.tesseractVideo.videoWidth)).toBe(1440);
  expect(await page.evaluate(() => window.__dbg.tesseractVideo.videoHeight)).toBe(1440);
  expect(await page.evaluate(() => window.__dbg.tesseractVideo.muted)).toBe(true);
  expect(await page.evaluate(() => window.__dbg.tesseractVideo.error)).toBe('');
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode), {timeout:7000}).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__dbg?.selectedPlane)).toBe('rocket');
  await expect.poll(() => page.evaluate(() => window.__dbg?.cooperFarmRocketReady), {timeout:7000}).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.camDist)).toBeGreaterThan(24);
  await expect.poll(() => page.evaluate(() => window.__dbg?.lat)).toBeCloseTo(50.4064167, 5);
  await expect.poll(() => page.evaluate(() => window.__dbg?.lon)).toBeCloseTo(-114.2042778, 5);
  await expect(page.locator('#location-arrival')).toHaveClass(/show/);
  await expect(page.locator('#farm-reference')).toHaveAttribute('href', /google\.com\/maps\/place\/Interstellar\+farm/);
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__dbg?.rocketLaunch)).toBe(true);
});

test('space environments warn near the Sun and destroy a direct impact', async ({page}) => {
  test.setTimeout(20000);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testRocketLaunch())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.spaceMode)).toBe(true);
  expect(await page.evaluate(() => window.__testSpaceApproach('Sun', 40, 28))).toBe(true);
  await expect(page.locator('body')).toHaveClass(/solar-warning/);
  expect(await page.evaluate(() => window.__testSpaceApproach('Sun', -1, 28))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__dbg?.crashed)).toBe(true);
  await expect(page.locator('#f-banner')).toContainText('STAR INCINERATION');
});

test('invalid coordinates show an actionable error', async ({page}) => {
  await page.goto('/'); await openPicker(page);
  await page.locator('#pin-query').fill('999, 2');
  await page.locator('#pin-search button').click();
  await expect(page.locator('#pin-status')).toContainText('Coordinates');
  await expect(page.locator('#pin-use')).toBeDisabled();
});

test('renderer uses the adaptive 1440p budget and survives resize', async ({page}) => {
  test.setTimeout(60000);
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width:1280,height:720});
  await page.addInitScript(() => localStorage.setItem('fotw-settings',JSON.stringify({quality:'performance',adaptive:false})));
  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__dbg?.frame || 0)).toBeGreaterThan(2);
  await expect.poll(() => page.locator('#game-canvas').evaluate(canvas => [canvas.width,canvas.height])).toEqual([1280,720]);
  await page.locator('#settings-toggle').click();
  await page.locator('#adaptive').uncheck();
  await expect.poll(() => page.locator('#game-canvas').evaluate(canvas => [canvas.width,canvas.height])).toEqual([1280,720]);
  await page.setViewportSize({width:900,height:900});
  await expect.poll(() => page.locator('#game-canvas').evaluate(canvas => [canvas.width,canvas.height])).toEqual([900,900]);
  expect(errors).toEqual([]);
});

test('mobile picker fits and places a pin', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/'); await openPicker(page);
  await expect.poll(() => page.locator('.location-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator('#departure-map').click({position:{x:150,y:130}});
  await expect(page.locator('#pin-use')).toBeEnabled();
  await page.screenshot({path:'test-results/online-picker-mobile.png'});
});

test('real map click and pin drag update the departure', async ({page}) => {
  await page.goto('/'); await openPicker(page);
  const area = page.locator('#departure-map');
  await area.click({position:{x:400,y:200}});
  const initial = await page.locator('#pin-status').textContent();
  const pin = page.locator('.departure-pin');
  const box = await pin.boundingBox();
  await page.mouse.move(box.x+14,box.y+15); await page.mouse.down();
  await page.mouse.move(box.x+64,box.y+45,{steps:8}); await page.mouse.up();
  await expect(page.locator('#pin-status')).not.toHaveText(initial);
  await page.getByRole('button',{name:'Use this location'}).click();
  await expect(page.locator('#city-input')).toHaveValue(/^-?\d+\.\d{6}, -?\d+\.\d{6}$/);
});

test('place search works without credentials', async ({page}) => {
  await page.route('https://photon.komoot.io/api/**', route=> route.fulfill({json:{features:[{geometry:{coordinates:[21.01,52.23]}}]}}));
  await page.goto('/'); await openPicker(page);
  await page.locator('#pin-query').fill('Warsaw');
  await page.locator('#pin-search button').click();
  await expect(page.locator('#pin-status')).toContainText('52.230000, 21.010000');
  await page.getByRole('button',{name:'Use this location'}).click();
  await expect(page.locator('#city-input')).toHaveValue('52.230000, 21.010000');
});
