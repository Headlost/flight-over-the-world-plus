import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createParachutistModel, updateParachutistModel, setParachutistRole,
  PARACHUTIST_ROLE_COLORS } from '../src/game/paraglider.js';
import { attachParachutistSkin } from '../src/game/parachutistSkin.js';

globalThis.self ||= globalThis;
globalThis.createImageBitmap ||= async () => ({ width: 1, height: 1, close() {} });

test('replacement body follows the existing parachute rig in local space at Earth-scale coordinates', () => {
  const root = createParachutistModel();
  const imported = new Group();
  imported.add(new Mesh(
    new BoxGeometry(0.6, 1.91, 0.3).translate(0, 0.635, 0),
    new MeshStandardMaterial({ color: 0x6688aa }),
  ));
  const character = root.userData.parachutist.character;
  const skin = attachParachutistSkin(character, imported);
  root.position.set(6_350_000, 1_100_000, -700_000);
  root.updateMatrixWorld(true);
  skin.skeleton.update();
  assert.equal(skin.skeleton.bones.length, 14);
  assert.equal(root.userData.parachutist.canopy.name, 'parachute-canopy');
  const boneTranslations = () => skin.skeleton.boneMatrices.filter((_, index) =>
    index % 16 === 12 || index % 16 === 13 || index % 16 === 14);
  assert.ok([...boneTranslations()].every(value => Number.isFinite(value) && Math.abs(value) < 5),
    'GPU bone transforms must not contain Earth-centred coordinates');

  const position = skin.geometry.attributes.position;
  const legVertex = Array.from({ length: position.count }, (_, index) => index)
    .find(index => position.getY(index) < 0 && position.getX(index) > 0);
  assert.notEqual(legVertex, undefined);
  const before = skin.getVertexPosition(legVertex, new Vector3()).clone();
  for (let frame = 0; frame < 14; frame += 1) {
    updateParachutistModel(root, 'grounded', 4, 1 / 60, {
      groundClearance: 0, verticalSpeed: 0,
    });
  }
  skin.skeleton.update();
  const after = skin.getVertexPosition(legVertex, new Vector3());
  assert.ok(before.distanceTo(after) > 0.005, 'new mesh responds to walking animation');
  assert.ok([...boneTranslations()].every(value => Number.isFinite(value) && Math.abs(value) < 5));
});

test('low gloves follow wrists while the backpack stays on the torso', () => {
  const root = createParachutistModel();
  const imported = new Group();
  const geometry = new BufferGeometry();
  const parts = [
    [0.32, 0.39, -0.17], [-0.32, 0.39, -0.17],
    [0.24, 1.06, 0.25], [0.14, 0.40, 0.01],
  ];
  geometry.setAttribute('position', new Float32BufferAttribute(parts.flatMap(([x, y, z]) => [
    x, y, z, x + 0.002, y, z, x, y + 0.002, z,
  ]), 3));
  imported.add(new Mesh(geometry, new MeshStandardMaterial()));
  const skin = attachParachutistSkin(root.userData.parachutist.character, imported);
  const indices = skin.geometry.attributes.skinIndex;
  const weights = skin.geometry.attributes.skinWeight;
  assert.equal(indices.getX(0), 7, 'right low glove must not follow the right leg');
  assert.equal(indices.getX(3), 4, 'left low glove must not follow the left leg');
  assert.equal(indices.getX(6), 0, 'backpack side must remain attached to the torso');
  assert.equal(indices.getX(9), 11, 'the thigh still follows the right leg');
  for (const index of [0, 3, 6, 9]) assert.ok(weights.getX(index) > 0.5);
});

test('disconnected inner-calf cloth islands follow their legs throughout a stride', () => {
  const root = createParachutistModel();
  const imported = new Group();
  const geometry = new BufferGeometry();
  // All calf vertices lie inside the old per-vertex |X| > 0.065 threshold.
  // They are separate triangles in the source scan, not sewn to the main leg.
  const panels = [
    [[-0.06, -0.04, -0.19], [-0.03, 0.16, -0.11], [-0.04, 0.22, -0.09]],
    [[0.06, -0.04, -0.19], [0.03, 0.16, -0.11], [0.04, 0.22, -0.09]],
    [[-0.06, 0.52, 0.13], [-0.04, 0.53, 0.13], [-0.05, 0.55, 0.13]],
  ];
  geometry.setAttribute('position', new Float32BufferAttribute(panels.flat(2), 3));
  imported.add(new Mesh(geometry, new MeshStandardMaterial()));
  const skin = attachParachutistSkin(root.userData.parachutist.character, imported);
  const boneIndices = skin.geometry.attributes.skinIndex;
  const boneWeights = skin.geometry.attributes.skinWeight;
  for (const vertex of [0, 1, 2]) {
    assert.ok(boneIndices.getX(vertex) >= 8 && boneIndices.getX(vertex) <= 10,
      'left calf panel must be entirely assigned to the left leg');
    assert.ok(boneWeights.getX(vertex) > 0.5);
  }
  for (const vertex of [3, 4, 5]) {
    assert.ok(boneIndices.getX(vertex) >= 11 && boneIndices.getX(vertex) <= 13,
      'right calf panel must be entirely assigned to the right leg');
    assert.ok(boneWeights.getX(vertex) > 0.5);
  }
  assert.equal(boneIndices.getX(6), 0, 'backpack cloth remains attached to the torso');

  const relative = () => {
    skin.skeleton.update();
    const torso = skin.getVertexPosition(6, new Vector3());
    return [0, 3].map(vertex => skin.getVertexPosition(vertex, new Vector3()).sub(torso));
  };
  const before = relative();
  for (let frame = 0; frame < 20; frame++) updateParachutistModel(root, 'grounded', 4, 1 / 60, {
    groundClearance: 0, verticalSpeed: 0,
  });
  const after = relative();
  assert.ok(before[0].distanceTo(after[0]) > 0.02,
    'left calf cloth must move relative to the torso as the leg strides');
  assert.ok(before[1].distanceTo(after[1]) > 0.02,
    'right calf cloth must move relative to the torso as the leg strides');
});

test('real scan renders intact torso with watertight animated fallback legs', async () => {
  const bytes = await readFile(new URL('../public/models/parachutist-body.glb', import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const root = createParachutistModel();
  const character = root.userData.parachutist.character;
  const skin = attachParachutistSkin(character, scene);
  const positions = skin.geometry.attributes.position;
  const faces = skin.geometry.index;
  assert.equal(skin.skeleton.bones.length, 14, 'existing armature remains in place');
  assert.ok(faces.count > 30_000, 'head, torso and backpack still use the original scan');
  let torsoFaces = 0;
  for (let offset = 0; offset < faces.count; offset += 3) {
    const vertices = [faces.getX(offset), faces.getX(offset + 1), faces.getX(offset + 2)];
    assert.ok(vertices.every(vertex => positions.getY(vertex) >= 0.67),
      'detached source trouser triangles must not render');
    if (vertices.every(vertex => {
      const y = positions.getY(vertex);
      return y > 0.85 && y < 1.25;
    })) torsoFaces++;
  }
  assert.ok(torsoFaces > 1000, 'the scanned torso remains visible');
  for (const leg of character.legs) {
    let visibleMeshes = 0;
    leg.upper.traverse(object => {
      if (object.isMesh && object.visible) {
        visibleMeshes++;
        if (object.material.name === 'parachutist-suit-base-teal') {
          assert.equal(object.material.color.getHex(), 0x28292b,
            'fallback trousers match the dark source suit');
        }
      }
    });
    assert.ok(visibleMeshes >= 3, 'each hip, calf and boot covers the removed scan');
  }
  character.pilot.updateMatrixWorld(true);
  const before = character.legs.map(leg => leg.lower.getWorldPosition(new Vector3()));
  for (let frame = 0; frame < 20; frame++) updateParachutistModel(root, 'grounded', 4, 1 / 60, {
    groundClearance: 0, verticalSpeed: 0,
  });
  character.pilot.updateMatrixWorld(true);
  for (const [index, leg] of character.legs.entries()) {
    assert.ok(before[index].distanceTo(leg.lower.getWorldPosition(new Vector3())) > 0.01,
      'replacement leg must still animate during a stride');
  }
});
test('hybrid sleeves match the source palette while role tint stays on red panels', () => {
  const root = createParachutistModel();
  const imported = new Group();
  imported.add(new Mesh(new BoxGeometry(0.6, 1.91, 0.3), new MeshStandardMaterial()));
  const character = root.userData.parachutist.character;
  attachParachutistSkin(character, imported);
  const armMaterials = new Map();
  for (const arm of character.arms) arm.upper.traverse(object => {
    if (object.isMesh && object.visible) armMaterials.set(object.material.name, object.material);
  });
  const sleeve = armMaterials.get('parachutist-arm-sleeve-gray');
  const white = armMaterials.get('parachutist-arm-piping-white');
  const red = armMaterials.get('parachutist-suit-accent-blue');
  assert.equal(sleeve?.color.getHex(), 0x494d50);
  assert.equal(white?.color.getHex(), 0xe2e0dc);
  assert.equal(red?.color.getHex(), 0xbe4038);
  assert.ok(armMaterials.has('parachutist-skin'), 'bare forearms follow the lower-arm bone');
  assert.ok(character.arms.every(arm => arm.grip.parent === arm.wrist));
  setParachutistRole(root, 'admin');
  assert.equal(red.color.getHex(), PARACHUTIST_ROLE_COLORS.admin);
  assert.equal(sleeve.color.getHex(), 0x494d50);
  assert.equal(white.color.getHex(), 0xe2e0dc);
  setParachutistRole(root, 'player');
  assert.equal(red.color.getHex(), 0xbe4038);
});
