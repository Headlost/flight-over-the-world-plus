import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const diagnostic = (script, args = []) => JSON.parse(execFileSync(process.execPath,
  [fileURLToPath(new URL(`../scripts/${script}`, import.meta.url)), ...args],
  { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }));

test('visible imported torso and legs remain intact in a running stride', () => {
  const report = diagnostic('inspectParachutistDeformation.mjs');
  assert.ok(report.vertices > 80000);
  assert.ok(report.triangles < 70_000, 'damaged imported arm faces must be excluded');
  assert.ok(report.stretchedOver5cm <= 4,
    `${report.stretchedOver5cm} visible triangles stretched more than 5 cm`);
  assert.ok((report.worst[0]?.increase ?? 0) <= 0.09,
    `worst visible triangle stretched ${report.worst[0]?.increase} m`);
});

test('airborne pose and full brake pull keep sleeves separate and feet narrow on landing', () => {
  for (const mode of ['--flight', '--pulled']) {
    const report = diagnostic('inspectParachutistDeformation.mjs', [mode]);
    assert.equal(report.stretchedOver5cm, 0, `${mode} must not tear visible geometry`);
    assert.ok((report.worst[0]?.increase ?? 0) < 0.05);
  }
  const { flight, pulled, run } = diagnostic('inspectParachutistPose.mjs');
  assert.ok(flight.hiddenSourceArmFaces > 15_000);
  assert.ok(run.bootSeparation > 0.26 && run.bootSeparation < 0.38,
    `landing-to-run visual boot separation ${run.bootSeparation} m`);
  assert.ok(run.bootSeparation < flight.bootSeparation - 0.05,
    'running boots must move in from the parachute landing stance');
  for (const pose of [flight, pulled]) {
    assert.ok(pose.lineGripError < 0.015, 'brake lines must end at visible hand grips');
    assert.ok(pose.arms.every(arm => arm.visibleArmMeshes >= 3 && arm.nearestVisibleGlove < 0.035),
      'both separately articulated visible gloves must reach the canopy toggles');
  }
});
