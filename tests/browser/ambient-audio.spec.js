import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const sliderIDs=['ambient-menu-volume','ambient-lobby-volume','ambient-game-volume'];
const outputIDs=['ambient-menu-value','ambient-lobby-value','ambient-game-value'];

async function setVolume(page,id,percent) {
  const slider=page.locator('#'+id);
  await slider.focus();
  await slider.evaluate((element,value)=>{
    element.value=String(value);
    element.dispatchEvent(new Event('input',{bubbles:true}));
  },percent);
  expect(await page.evaluate(()=>document.activeElement.id)).toBe(id);
  for(const control of sliderIDs)await expect(page.locator('#'+control)).toHaveValue(String(percent));
  for(const output of outputIDs)await expect(page.locator('#'+output)).toHaveText(percent+'%');
}

test.beforeEach(async({context,page})=>{
  await context.route('https://box.zakai.eu/**',route=>route.fulfill({status:403,body:'Production admission disabled in audio fixture'}));
  await context.route('https://api.cesium.com/**',route=>route.fulfill({status:403,body:'Terrain disabled in audio fixture'}));
  await page.addInitScript(()=>{
    window.__ambientAudioContexts=[];window.__ambientGainNodes=[];
    const NativeContext=window.AudioContext;
    if(!NativeContext)return;
    window.AudioContext=class extends NativeContext {
      constructor(...args){super(...args);window.__ambientAudioContexts.push(this);}
      createGain(){const gain=super.createGain();window.__ambientGainNodes.push(gain);return gain;}
    };
  });
});

test('ambient engine and wind gain persists and synchronizes all controls independently of music',async({page})=>{
  test.setTimeout(60000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  mkdirSync('.local-baselines/ambient-audio',{recursive:true});
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>!!window.__game)).toBe(true);
  await expect(page.locator('#loader')).toBeHidden();
  await expect(page.locator('#music-landing-toggle')).toHaveText('🔊 Music on');
  expect(await page.evaluate(()=>window.__ambientAudioContexts.length)).toBe(0);
  // A settings event before any trusted gesture must not unlock/create audio.
  await page.locator('#ambient-menu-volume').evaluate(element=>{
    element.value='0';element.dispatchEvent(new Event('input',{bubbles:true}));
    element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    element.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  });
  await expect.poll(()=>page.evaluate(()=>({contexts:window.__ambientAudioContexts.length,
    volume:window.__dbg.audio.ambientVolume,music:window.__bgm.muted,
    saved:localStorage.getItem('fotw-ambient-volume')})))
    .toEqual({contexts:0,volume:0,music:false,saved:'0'});
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>!!window.__game)).toBe(true);
  for(const id of sliderIDs)await expect(page.locator('#'+id)).toHaveValue('0');
  expect(await page.evaluate(()=>window.__ambientAudioContexts.length)).toBe(0);
  await page.screenshot({path:'.local-baselines/ambient-audio/desktop-landing.png'});
  await page.locator('#music-landing-toggle').click();
  for(const id of ['music-landing-toggle','music-menu-toggle','music-lobby-toggle','music-game-toggle'])
    await expect(page.locator('#'+id)).toHaveText('🔇 Music off');
  await page.locator('#btn-solo').click();
  await setVolume(page,'ambient-menu-volume',35);
  await page.screenshot({path:'.local-baselines/ambient-audio/desktop-menu.png'});
  await page.locator('#menu-back').click();
  await page.locator('#btn-multi').click();
  await page.evaluate(()=>window.__testPopulateLobby(1,false));
  await expect(page.locator('#ambient-lobby-volume')).toBeVisible();
  await setVolume(page,'ambient-lobby-volume',65);
  await page.screenshot({path:'.local-baselines/ambient-audio/desktop-lobby.png'});
  await page.locator('#lobby-back').click();
  await page.locator('#btn-solo').click();
  await setVolume(page,'ambient-menu-volume',35);
  expect(await page.evaluate(()=>window.__testFighterFlight())).toBe(true);
  await expect(page.locator('#ambient-game-volume')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__dbg.audio.masterTarget)).toBeCloseTo(.14*.35,6);
  // Inspect the real engine GainNode, rather than only a UI/debug projection.
  await expect.poll(()=>page.evaluate(()=>window.__ambientGainNodes[0]?.gain.value)).toBeCloseTo(.14*.35,3);
  await setVolume(page,'ambient-game-volume',0);
  await expect.poll(()=>page.evaluate(()=>window.__ambientGainNodes[0].gain.value)).toBeLessThan(.0002);
  await page.locator('#music-game-toggle').click();
  expect(await page.evaluate(()=>({ambient:window.__dbg.audio.ambientVolume,
    musicMuted:window.__bgm.muted,musicVolume:window.__bgm.volume,
    musicSaved:localStorage.getItem('fotw-music-muted')})))
    .toEqual({ambient:0,musicMuted:false,musicVolume:.22,musicSaved:'0'});
  await page.screenshot({path:'.local-baselines/ambient-audio/desktop-game.png'});
  // The same master controls parachute/wind wash; neither music nor voice is on it.
  await page.evaluate(()=>{
    window.__testGroundedParachutist();
    const plane=window.__game.plane;plane.state='airborne';plane.height=1000;plane.speed=10.5;
  });
  await setVolume(page,'ambient-game-volume',25);
  await expect.poll(()=>page.evaluate(()=>window.__dbg.selectedPlane)).toBe('parachutist');
  await expect.poll(()=>page.evaluate(()=>window.__ambientGainNodes[0].gain.value)).toBeCloseTo(.14*.25,3);
  await expect.poll(()=>page.evaluate(()=>window.__ambientGainNodes.at(-1).gain.value)).toBeGreaterThan(.02);
  await page.keyboard.press('Escape');
  await setVolume(page,'ambient-game-volume',75);
  await expect.poll(()=>page.evaluate(()=>window.__dbg.audio.ambientVolume)).toBe(.75);
  await expect.poll(()=>page.evaluate(()=>window.__ambientGainNodes[0].gain.value)).toBeLessThan(.0002);
  await page.keyboard.press('Escape');
  await expect.poll(()=>page.evaluate(()=>window.__ambientGainNodes[0].gain.value)).toBeCloseTo(.14*.75,3);
  expect(await page.evaluate(()=>window.__ambientAudioContexts.length)).toBe(1);
  expect(await page.evaluate(()=>window.__ambientGainNodes.length)).toBe(7);
  expect(errors).toEqual([]);
});

test('ambient sliders fit a narrow screen in selection and gameplay',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  mkdirSync('.local-baselines/ambient-audio',{recursive:true});
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>!!window.__game)).toBe(true);
  await page.locator('#btn-solo').click();
  await setVolume(page,'ambient-menu-volume',40);
  const menu=await page.locator('#ambient-menu-volume').boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0);expect(menu.x+menu.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:'.local-baselines/ambient-audio/mobile-menu.png'});
  expect(await page.evaluate(()=>window.__testFighterFlight())).toBe(true);
  await expect(page.locator('#audio-game-controls > summary')).toBeVisible();
  await expect(page.locator('#ambient-game-volume')).toBeHidden();
  await page.locator('#audio-game-controls > summary').click();
  await expect(page.locator('#ambient-game-volume')).toBeVisible();
  await setVolume(page,'ambient-game-volume',20);
  const game=await page.locator('#ambient-game-volume').boundingBox();
  expect(game.x).toBeGreaterThanOrEqual(0);expect(game.x+game.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:'.local-baselines/ambient-audio/mobile-game.png'});
});
