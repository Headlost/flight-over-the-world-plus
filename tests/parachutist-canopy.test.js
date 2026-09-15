import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3, Group, Vector3} from 'three';
import {createParachutistCanopy,updateParachutistSuspension} from '../src/game/parachutistCanopy.js';
import {disposeModel} from '../src/game/dispose.js';

function character() {
  const body = new Group(); body.position.y = .92;
  const riserAnchors = [-1,1].map(side => {
    const anchor = new Group(); anchor.position.set(side*.175,.28,-.085); body.add(anchor); return anchor;
  });
  return {body,riserAnchors};
}

test('inflated ram-air wing retains the established flight and contact envelope',()=>{
  const wing = createParachutistCanopy(character());
  const size = new Box3().setFromObject(wing).getSize(new Vector3());
  assert.ok(Math.abs(size.x-9.2)<.001);
  assert.ok(size.y>6&&size.y<9&&size.z<3);
  const skin = wing.getObjectByName('Nine inflated black and orange cells');
  assert.equal(skin.geometry.groups.length,2);
  assert.equal(wing.userData.suspension.cells,9);
  for (const object of [skin,wing.getObjectByName('Branched suspension and brake lines')]) {
    assert.ok(object.geometry.attributes.position.array.every(Number.isFinite));
  }
  assert.ok(skin.geometry.index.count/3<10000);
  disposeModel(wing);
});

test('all four risers follow animated harness attachments without recreating GPU buffers',()=>{
  const person = character(),wing = createParachutistCanopy(person);
  const rig = wing.userData.suspension;
  const lineBuffer = rig.suspensionPositions.array,riserBuffer = rig.riserPositions.array;
  const skin = wing.getObjectByName('Nine inflated black and orange cells').geometry;
  const skinBuffer = skin.attributes.position.array,expected = new Vector3();
  for (let i=0;i<300;i++) {
    person.body.position.y = .82+.03*Math.sin(i/10);
    person.body.rotation.x = .14*Math.sin(i/17);
    updateParachutistSuspension(wing);
    for(let bank=0;bank<4;bank++) {
      const plan = rig.banks[bank];
      expected.copy(person.riserAnchors[bank<2?0:1].position).applyMatrix4(person.body.matrix);
      expected.z += bank%2===0?-.035:.035;
      const index = bank*4;
      assert.ok(Math.abs((rig.riserPositions.getX(index)+rig.riserPositions.getX(index+1))/2-expected.x)<1e-5);
      assert.ok(Math.abs(rig.riserPositions.getY(index)-expected.y)<1e-5);
      assert.ok(Math.abs(rig.riserPositions.getZ(index)-expected.z)<1e-5);
      assert.ok(Math.abs(rig.suspensionPositions.getY(plan.upperIndex)-expected.y-.43)<1e-5);
    }
  }
  assert.equal(rig.suspensionPositions.array,lineBuffer);
  assert.equal(rig.riserPositions.array,riserBuffer);
  assert.equal(skin.attributes.position.array,skinBuffer);
  assert.ok(lineBuffer.every(Number.isFinite)&&riserBuffer.every(Number.isFinite));
  disposeModel(wing);
});

test('brake lines stay in the articulated hands while load-bearing risers stay on the shoulders',()=>{
  const person = character();
  person.arms = [-1,1].map(side=>{
    const upper = new Group(),lower = new Group();
    upper.position.set(side*.235,.27,0);lower.position.y=-.33;
    upper.add(lower);person.body.add(upper);return {upper,lower,side};
  });
  const wing = createParachutistCanopy(person),rig = wing.userData.suspension;
  const firstRiser = rig.banks[0].lower.clone();
  person.arms[0].upper.rotation.x=-.2;person.arms[0].lower.rotation.x=2.52;
  updateParachutistSuspension(wing);
  const expected = new Vector3(0,-.30,-.01).applyMatrix4(person.arms[0].lower.matrix)
    .applyMatrix4(person.arms[0].upper.matrix).applyMatrix4(person.body.matrix);
  assert.ok(rig.banks[0].lower.distanceTo(firstRiser)<1e-9);
  assert.ok(rig.banks[0].hand.distanceTo(expected)<1e-9);
  assert.ok(rig.toggles[0].position.distanceTo(expected)<1e-9);
  const bufferPoint = new Vector3().fromBufferAttribute(rig.suspensionPositions,rig.banks[0].brakeStart);
  assert.ok(bufferPoint.distanceTo(expected)<1e-5);
  assert.ok(rig.banks[0].hand.distanceTo(rig.banks[0].upper)>.1);
  disposeModel(wing);
});
