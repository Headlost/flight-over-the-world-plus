import {
  Bone, DoubleSide, Float32BufferAttribute, Matrix4, Skeleton, SkinnedMesh, Uint16BufferAttribute,
} from 'three';

const clamp01 = value => Math.max(0, Math.min(1, value));
const blend = (value, start, end) => clamp01((value - start) / (end - start));

/**
 * Bind the supplied single-piece civilian/parachutist mesh to the already
 * animated game rig. The procedural rig continues to drive harness anchors,
 * brake toggles, suspension lines, gait and landing; only its visible body is
 * replaced. Weight bands keep knees, elbows, neck and shoulders continuous.
 */
export function attachParachutistSkin(character, importedScene) {
  const source = importedScene?.getObjectByProperty('isMesh', true);
  if (!source?.geometry?.attributes?.position) throw new Error('Parachutist body has no mesh');
  importedScene.updateMatrixWorld(true);
  const geometry = source.geometry.clone();
  geometry.applyMatrix4(source.matrixWorld);
  const material = Array.isArray(source.material)
    ? source.material.map(entry => entry.clone()) : source.material.clone();
  // The imported scan contains one-sided, disconnected garment shells. A
  // reversed shell must never make an entire flank transparent in flight.
  for (const surface of Array.isArray(material) ? material : [material]) {
    surface.side = DoubleSide;
  }

  const anchors = [
    character.body, character.headGroup,
    character.arms[0].upper, character.arms[0].lower, character.arms[0].wrist,
    character.arms[1].upper, character.arms[1].lower, character.arms[1].wrist,
    character.legs[0].upper, character.legs[0].lower, character.legs[0].boot,
    character.legs[1].upper, character.legs[1].lower, character.legs[1].boot,
  ];
  // Keep the visual skeleton detached at the local origin. Binding directly to
  // the Earth-positioned scene groups introduces 6,000 km translations into
  // Float32 GPU bone matrices and tears the mesh into large triangles.
  const localRoot = new Bone();
  const pairs = [];
  const byAnchor = new Map();
  const bones = anchors.map((anchor, index) => {
    const bone = new Bone();
    bone.name = `visual-skin-${index}`;
    (byAnchor.get(anchor.parent) || localRoot).add(bone);
    bone.position.copy(anchor.position);
    bone.quaternion.copy(anchor.quaternion);
    bone.scale.copy(anchor.scale);
    byAnchor.set(anchor, bone);
    pairs.push([anchor, bone]);
    return bone;
  });
  const positions = geometry.attributes.position;
  const indices = new Uint16Array(positions.count * 4);
  const weights = new Float32Array(positions.count * 4);
  const regionAt = (x, y, z) => {
    const distanceFromCentre = Math.abs(x);
    const lowGlove = y > 0.35 && distanceFromCentre > 0.22 && z < -0.09;
    if (y > 1.32 && distanceFromCentre < 0.19 && z < 0.16) return 1;
    if (y < 1.33 && (lowGlove || (y > 0.50 && distanceFromCentre > 0.22
        && (z < 0.14 || distanceFromCentre > 0.30)))) return 2;
    if (y < 0.70 && distanceFromCentre > 0.065
        && (y < 0.30 || (distanceFromCentre < 0.23 && z < 0.16))) return 3;
    return 0;
  };
  // This scan is thousands of separate connected pieces. Do not let adjacent
  // vertices of one glove or trouser panel straddle the arm/leg threshold:
  // their different bones would stretch a single triangle across the body.
  const parent = new Uint32Array(positions.count);
  const proposed = new Uint8Array(positions.count);
  for (let vertex = 0; vertex < positions.count; vertex++) {
    parent[vertex] = vertex;
    proposed[vertex] = regionAt(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
  }
  const find = start => {
    let vertex = start;
    while (parent[vertex] !== vertex) {
      parent[vertex] = parent[parent[vertex]];
      vertex = parent[vertex];
    }
    return vertex;
  };
  const faces = geometry.index;
  for (let offset = 0; offset + 2 < (faces?.count || positions.count); offset += 3) {
    const a = faces ? faces.getX(offset) : offset;
    const b = faces ? faces.getX(offset + 1) : offset + 1;
    const c = faces ? faces.getX(offset + 2) : offset + 2;
    parent[find(b)] = find(a);
    parent[find(c)] = find(a);
  }
  const counts = new Map();
  const bounds = new Map();
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const root = find(vertex);
    if (!counts.has(root)) counts.set(root, new Uint32Array(4));
    counts.get(root)[proposed[vertex]] += 1;
    if (!bounds.has(root)) bounds.set(root, {
      minX: Infinity, maxX: -Infinity,
      minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity,
    });
    const part = bounds.get(root);
    part.minX = Math.min(part.minX, positions.getX(vertex));
    part.maxX = Math.max(part.maxX, positions.getX(vertex));
    part.minY = Math.min(part.minY, positions.getY(vertex));
    part.maxY = Math.max(part.maxY, positions.getY(vertex));
    part.minZ = Math.min(part.minZ, positions.getZ(vertex));
    part.maxZ = Math.max(part.maxZ, positions.getZ(vertex));
  }
  const dominant = new Map();
  const wristIslands = new Set();
  const residualArmIslands = new Set();
  const islandSizes = new Map();
  for (const [root, tally] of counts) {
    islandSizes.set(root, tally[0] + tally[1] + tally[2] + tally[3]);
    const part = bounds.get(root);
    // Hide complete source arm islands when their other faces were already
    // removed by the hybrid mask. Otherwise tiny remaining glove panels can
    // acquire mixed torso/wrist weights and turn into long spikes in flight.
    // The narrow X/Y/Z windows are below the harness and outside the torso.
    const size = islandSizes.get(root);
    const innerForearm = size >= 150 && size <= 300 && part.minY > 0.50 && part.maxY < 0.80
        && (part.maxX < -0.13 || part.minX > 0.13)
        && part.minZ < -0.12 && part.maxZ < 0.08;
    const loweredGlove = size <= 180 && part.minY > 0.34 && part.maxY < 0.55
        && (part.maxX < -0.19 || part.minX > 0.19)
        && part.minZ < -0.13 && part.maxZ < -0.03;
    if (innerForearm || loweredGlove) residualArmIslands.add(root);
    const outerX = Math.max(Math.abs(part.minX), Math.abs(part.maxX));
    // The photographic source consists of thousands of loose garment islands.
    // Its lowered gloves overlap the thighs in X/Y. Classify each complete
    // glove island before weighting it, otherwise inner glove vertices become
    // torso while the outer vertices follow the wrist and a single triangle
    // stretches across the character.
    const glove = part.minY > 0.32 && part.maxY < 0.68
      && (outerX > 0.25 || (outerX > 0.20 && part.minZ < -0.20))
      && part.minZ < -0.11 && part.maxZ < 0.06
      && (part.maxX < -0.16 || part.minX > 0.16);
    if (glove) {
      dominant.set(root, 2);
      wristIslands.add(root);
      continue;
    }
    // Narrow backpack/harness islands behind the upper torso can overlap the
    // shoulder X band in projection; they must remain attached to the body.
    if (part.minZ > 0.025 && outerX < 0.30 && part.minY > 0.30) {
      dominant.set(root, 0);
      continue;
    }
    // Upper-thigh pocket/seam pieces are disconnected from the main trouser
    // surface. Although they sit above the calf rule, pinning them to the
    // pelvis opens 30–40 cm gaps when that thigh swings forward. Move each
    // small, wholly one-sided rear trouser island with its own leg. The tight
    // back-facing and height bounds leave central harness/belt pieces on the
    // torso, and the head/arms have already been classified above.
    const onOneLeg = part.maxX < -0.01 || part.minX > 0.01;
    const upperThighDetail = size <= 150 && onOneLeg
      && part.minY > 0.34 && part.maxY < 0.57
      && part.minZ < -0.04 && part.maxZ < 0.08
      && (part.maxX < -0.04 || part.minX > 0.04);
    if (upperThighDetail) {
      dominant.set(root, 3);
      continue;
    }
    // The scan's inner trouser panels are separate, one-sided mesh islands.
    // Their X coordinates often sit inside the per-vertex leg threshold, so
    // majority voting incorrectly pins the entire calf panel to the torso.
    // During a stride the surrounding leg moves while that panel stays put,
    // leaving a long red/black strip hanging between the legs. Classify the
    // complete below-hip garment island, not individual vertices, as a leg.
    const lowerGarment = part.minY < 0.35 && part.maxY < 0.55
      && part.minZ < -0.015 && part.maxZ < 0.12 && outerX > 0.045;
    if (onOneLeg && lowerGarment) {
      dominant.set(root, 3);
      continue;
    }
    let region = 0;
    for (let candidate = 1; candidate < 4; candidate++) {
      if (tally[candidate] > tally[region]) region = candidate;
    }
    dominant.set(root, region);
  }
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const x = positions.getX(vertex);
    const y = positions.getY(vertex);
    const z = positions.getZ(vertex);
    const islandRoot = find(vertex);
    const part = bounds.get(islandRoot);
    const region = dominant.get(islandRoot);
    // A hip-panel island grazes the centreline by only a few millimetres.
    // Classifying each vertex by its own X sends adjacent triangles to
    // opposite thighs during a stride. Keep the complete panel on its
    // overwhelmingly dominant side, preserving its shape and UVs.
    const grazesCentre = region === 3 && part.minX < 0 && part.maxX > 0
      && Math.min(-part.minX, part.maxX) < 0.04
      && Math.max(-part.minX, part.maxX) > 0.14;
    const side = grazesCentre ? (part.maxX > -part.minX ? 1 : 0) : x < 0 ? 0 : 1;
    const armStart = side ? 5 : 2;
    const legStart = side ? 11 : 8;
    const values = new Map();
    const add = (index, weight) => values.set(index, (values.get(index) || 0) + weight);
    const distanceFromCentre = Math.abs(x);
    if (region === 1) {
      const head = blend(y, 1.32, 1.43);
      add(0, 1 - head); add(1, head);
    } else if (region === 2) {
      // Detached glove panels should move as one wrist piece. Blending their
      // inner side to the torso would stretch the fabric by 40 cm per step.
      if (wristIslands.has(find(vertex))) {
        add(armStart + 2, 1);
      } else {
        // An isolated sleeve/glove island cannot be partly weighted to the
        // torso: the arm swings while the torso stays still, pulling fabric
        // triangles apart. Only islands that really reach the shoulder blend.
        const detachedArm = part.maxX < -0.22 || part.minX > 0.22
          || (part.maxZ < 0.09 && part.minY > 0.40 && part.maxY < 1.18
            && (part.maxX < -0.18 || part.minX > 0.18));
        const arm = detachedArm ? 1 : blend(distanceFromCentre, 0.22, 0.28);
        const elbow = 1 - blend(y, 0.76, 0.90);
        const hand = 1 - blend(y, 0.49, 0.59);
        add(0, 1 - arm);
        add(armStart, arm * (1 - elbow));
        add(armStart + 1, arm * elbow * (1 - hand));
        add(armStart + 2, arm * elbow * hand);
      }
    } else if (region === 3) {
      const leg = blend(0.70 - y, 0, 0.12);
      // Nearby UV islands must agree at their shared spatial knee seam.
      // A common, broad height field bends them smoothly as one garment.
      const knee = 1 - blend(y, 0.10, 0.36);
      const foot = 1 - blend(y, -0.25, -0.13);
      add(0, 1 - leg);
      add(legStart, leg * (1 - knee));
      add(legStart + 1, leg * knee * (1 - foot));
      add(legStart + 2, leg * knee * foot);
    } else {
      add(0, 1);
    }
    const strongest = [...values].filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = strongest.reduce((total, [, weight]) => total + weight, 0) || 1;
    for (let influence = 0; influence < strongest.length; influence += 1) {
      const offset = vertex * 4 + influence;
      indices[offset] = strongest[influence][0];
      weights[offset] = strongest[influence][1] / sum;
    }
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));

  // The supplied photographic scan has no authored skin or armature. Its
  // shoulders and sleeves are thousands of disconnected UV/mesh islands; even
  // smooth weights leave visible flaps when both arms pull the toggles. Keep
  // the scan's head, torso, pack, harness and full-width legs, but render the
  // existing genuinely articulated game arms in their place. This is a
  // one-time index compaction at model load, not a per-frame mesh operation.
  let hiddenArmFaces = 0;
  let hiddenArmFaceMask = null;
  if (positions.count > 50_000) {
    const sourceFaces = geometry.index;
    const faceCount = (sourceFaces?.count || positions.count) / 3;
    hiddenArmFaceMask = new Uint8Array(faceCount);
    const visible = [];
    for (let face = 0; face < faceCount; face++) {
      const vertices = [0, 1, 2].map(corner => sourceFaces
        ? sourceFaces.getX(face * 3 + corner) : face * 3 + corner);
      let armWeight = 0;
      let x = 0, y = 0, z = 0;
      for (const vertex of vertices) {
        x += positions.getX(vertex); y += positions.getY(vertex); z += positions.getZ(vertex);
        for (let influence = 0; influence < 4; influence++) {
          const bone = indices[vertex * 4 + influence];
          if (bone >= 2 && bone <= 7) armWeight += weights[vertex * 4 + influence];
        }
      }
      x /= 3; y /= 3; z /= 3;
      const lateral = Math.abs(x);
      const shoulderOrSleeve = y > 0.66 && y < 1.22 && lateral > 0.19 && z < 0.13;
      const loweredGlove = y > 0.34 && y <= 0.66 && lateral > 0.21 && z < -0.10;
      // The scanned trousers have disconnected panels with no authored skin
      // weights. During a stride their seams open into see-through holes. Use
      // the already rigged, watertight game legs below the waist instead.
      const scannedLowerBody = vertices.some(vertex => positions.getY(vertex) < 0.67);
      if (scannedLowerBody || armWeight > 0.3 || shoulderOrSleeve || loweredGlove
          || residualArmIslands.has(find(vertices[0]))) {
        hiddenArmFaces++;
        hiddenArmFaceMask[face] = 1;
      } else visible.push(...vertices);
    }
    geometry.setIndex(visible);
    geometry.clearGroups();
    // The active photographic asset has one material. Synthetic unit meshes
    // are not compacted, so their original material groups are untouched.
    geometry.addGroup(0, visible.length, 0);
  }

  const skin = new SkinnedMesh(geometry, material);
  skin.name = 'imported-articulated-parachutist-body';
  skin.castShadow = true;
  skin.receiveShadow = true;
  skin.frustumCulled = false;
  character.pilot.traverse(object => {
    if (object.isMesh) object.visible = false;
  });
  for (const entry of character.roleSurfaces) {
    if (entry.surface.name === 'parachutist-suit-accent-blue') {
      entry.color = 0xbe4038;
      entry.emissive = 0x762a26;
      entry.surface.color.setHex(entry.color);
      entry.surface.emissive.setHex(entry.emissive);
    }
  }
  for (const arm of character.arms) arm.upper.traverse(object => {
    if (!object.isMesh) return;
    object.visible = true;
  });
  for (const leg of character.legs) leg.upper.traverse(object => {
    if (!object.isMesh) return;
    object.visible = true;
    if (object.material?.name === 'parachutist-suit-base-teal') {
      object.material.color.setHex(0x28292b);
      object.material.emissive.setHex(0x08090a);
    }
  });
  character.pilot.add(skin);
  localRoot.updateMatrixWorld(true);
  skin.bindMode = 'detached';
  skin.bind(new Skeleton(bones), new Matrix4());
  for (const surface of Array.isArray(material) ? material : [material]) {
    if (!surface?.color || !surface?.emissive) continue;
    character.roleSurfaces.push({ surface, color: surface.color.getHex(),
      emissive: surface.emissive.getHex(), emissiveIntensity: surface.emissiveIntensity });
  }
  character.visualSkin = skin;
  character.hybridArmFacesHidden = hiddenArmFaces;
  skin.userData.hiddenArmFaceMask = hiddenArmFaceMask;
  character.visualSkinRig = { localRoot, pairs };
  return skin;
}

export function syncParachutistSkin(character) {
  const rig = character?.visualSkinRig;
  if (!rig) return;
  for (const [anchor, bone] of rig.pairs) {
    bone.position.copy(anchor.position);
    bone.quaternion.copy(anchor.quaternion);
    bone.scale.copy(anchor.scale);
  }
  rig.localRoot.updateMatrixWorld(true);
}
