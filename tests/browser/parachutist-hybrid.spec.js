import { test, expect } from '@playwright/test';

test('new parachutist body keeps separate articulated hands on canopy grips and runs after touchdown', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.fulfill({ status: 503, body: 'offline visual fixture' }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.__game)).toBe(true);
  expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
  await page.waitForFunction(() => window.__game.planeMesh?.userData?.parachutist?.character?.visualSkin?.isSkinnedMesh,
    null, { timeout: 30_000 });
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -540); // close, but remain in third person
  await page.evaluate(() => {
    const plane = window.__game.plane;
    plane.state = 'airborne';
    plane.height = 1400;
    plane.groundClearance = 200;
    plane.speed = 10.5;
    plane.verticalSpeed = -2;
  });
  await page.waitForTimeout(500);
  await page.waitForFunction(() => {
    const transition = window.__game.planeMesh?.userData?.parachutist?.character?.motion?.transition;
    return transition && transition.kind === 'liftoff' && transition.time >= transition.duration;
  }, null, { timeout: 10_000 });
  const flight = await page.evaluate(() => {
    const rig = window.__game.planeMesh.userData.parachutist;
    const character = rig.character;
    const localY = object => character.pilot.worldToLocal(
      object.getWorldPosition(object.position.clone())).y;
    return {
      hidden: rig.character.hybridArmFacesHidden,
      visibleArmMeshes: rig.character.arms.map(arm => {
        let count = 0;
        arm.upper.traverse(object => { if (object.isMesh && object.visible) count++; });
        return count;
      }),
      color: rig.character.arms[0].upper.children.find(child =>
        child.isMesh && child.material.name === 'parachutist-arm-sleeve-gray')?.material.color.getHex(),
      gripParents: rig.character.arms.map(arm => arm.grip.parent === arm.wrist),
      gripsAboveHead: character.arms.map(arm => localY(arm.grip) - localY(character.headGroup)),
      canopy: rig.canopy.visible,
    };
  });
  expect(flight.hidden).toBeGreaterThan(5_000);
  expect(flight.visibleArmMeshes.every(count => count >= 3)).toBe(true);
  expect(flight.color).toBe(0x494d50);
  expect(flight.gripParents).toEqual([true, true]);
  expect(flight.gripsAboveHead.every(height => height > 0.15)).toBe(true);
  expect(flight.canopy).toBe(true);
  await page.screenshot({ path: 'test-results/parachutist-hybrid-flight-rear.png' });
  await page.evaluate(() => {
    const camera = window.__game.camera;
    // The game restores its 70-degree flight FOV every frame. Temporarily
    // pin only this camera property for a close diagnostic screenshot.
    Object.defineProperty(camera, 'fov', { configurable: true, get: () => 20, set: () => {} });
    camera.updateProjectionMatrix();
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/parachutist-hybrid-flight-close-rear.png' });
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .5);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width * .38, box.y + box.height * .5, { steps: 12 });
  await page.mouse.up({ button: 'right' });
  await page.evaluate(() => {
    const camera = window.__game.camera;
    const root = window.__game.planeMesh;
    const lookAt = camera.lookAt.bind(camera);
    const target = camera.position.clone();
    // At diagnostic telephoto FOV, the normal off-axis chase target can move
    // the model entirely outside frame after orbiting. Center this capture.
    camera.lookAt = () => lookAt(target.set(0, 0.65, 0).applyMatrix4(root.matrixWorld));
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'test-results/parachutist-hybrid-flight-front.png' });
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .5);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width * .59, box.y + box.height * .5, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/parachutist-hybrid-flight-side.png' });
  await page.keyboard.down('d');
  await page.waitForTimeout(450);
  const steeringGrips = await page.evaluate(() => {
    const character = window.__game.planeMesh.userData.parachutist.character;
    return character.arms.map(arm => character.pilot.worldToLocal(
      arm.grip.getWorldPosition(arm.grip.position.clone())).y);
  });
  expect(steeringGrips[1]).toBeLessThan(steeringGrips[0] - 0.25);
  await page.screenshot({ path: 'test-results/parachutist-hybrid-flight-side-right-pull.png' });
  await page.keyboard.up('d');
  await page.evaluate(() => {
    delete window.__game.camera.lookAt;
    delete window.__game.camera.fov;
    window.__game.camera.fov = 70;
    window.__game.camera.updateProjectionMatrix();
  });
  expect(await page.evaluate(() => window.__testGroundedParachutist())).toBe(true);
  await page.keyboard.down('w');
  await page.keyboard.down('Shift');
  await page.waitForTimeout(650);
  await page.screenshot({ path: 'test-results/parachutist-hybrid-run.png' });
  await page.keyboard.up('Shift');
  await page.keyboard.up('w');
  expect(errors).toEqual([]);
});
