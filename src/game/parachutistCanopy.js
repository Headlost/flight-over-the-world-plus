import {
  BufferGeometry, DataTexture, Float32BufferAttribute, Group, LineBasicMaterial,
  LineSegments, Mesh, MeshStandardMaterial, RGBAFormat, TorusGeometry, Vector3,
} from 'three';

// Full-size ram-air wing, in the existing -Z-forward parachutist frame.
// Geometry, seams and suspension buffers are built once for each model.
const SPAN = 9.2, CHORD = 2.8, ARCH = 2.0, BASE = 6.06, CELLS = 9;
let weaveTexture;
function fabricWeave() {
  if (weaveTexture) return weaveTexture;
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4;
    const value = 182 + ((x * 17 + y * 29) % 13) + (x % 8 === 0 || y % 8 === 0 ? 30 : 0);
    pixels.set([value, value, value, 255], offset);
  }
  weaveTexture = new DataTexture(pixels, size, size, RGBAFormat);
  weaveTexture.userData.sharedModelTexture = true;
  weaveTexture.needsUpdate = true;
  return weaveTexture;
}

function wingPoint(tx, tz, top, billow = 0) {
  const edge = Math.sin(Math.PI * tx), width = .86 + edge * .14;
  const inflated = Math.pow(Math.max(0, Math.sin(Math.PI * tz)), .72);
  const thickness = top ? .13 + inflated * .28 + billow : -.13 - inflated * .075 - billow * .3;
  return [(tx - .5) * SPAN, BASE + ARCH * edge + thickness,
    (tz - .5) * CHORD * width];
}

function line(points, a, b) { points.push(...a, ...b); }

export function createParachutistCanopy(character) {
  const group = new Group(); group.name = 'parachute-canopy';
  const weave = fabricWeave();
  const surfaces = [0x181c1d, 0xd16d21].map(color => new MeshStandardMaterial({
    color, roughness: .86, metalness: 0, bumpMap: weave, bumpScale: .013, side: 2,
  }));
  const positions = [], uvs = [], coloredIndices = [[], []], seams = [];
  function quad(a, b, c, d, palette, uv = [[0,0],[1,0],[1,1],[0,1]]) {
    const offset = positions.length / 3;
    for (const point of [a,b,c,d]) positions.push(...point);
    for (const point of uv) uvs.push(...point);
    coloredIndices[palette].push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  }
  const sx = 6, sz = 18;
  for (let cell = 0; cell < CELLS; cell++) {
    const palette = cell >= 3 && cell <= 5 || cell === 0 || cell === 8 ? 1 : 0;
    for (let ix = 0; ix < sx; ix++) for (let iz = 0; iz < sz; iz++) {
      const x0 = (cell + ix / sx) / CELLS, x1 = (cell + (ix+1) / sx) / CELLS;
      const z0 = iz / sz, z1 = (iz+1) / sz;
      const b0 = .22 * Math.sin(Math.PI * ix / sx), b1 = .22 * Math.sin(Math.PI * (ix+1) / sx);
      quad(wingPoint(x0,z0,true,b0),wingPoint(x1,z0,true,b1),
        wingPoint(x1,z1,true,b1),wingPoint(x0,z1,true,b0),palette);
      quad(wingPoint(x0,z1,false,b0),wingPoint(x1,z1,false,b1),
        wingPoint(x1,z0,false,b1),wingPoint(x0,z0,false,b0),palette);
    }
    for (const tx of [cell / CELLS, (cell+1) / CELLS]) {
      for (let iz = 0; iz < sz; iz++) {
        const z0 = iz / sz, z1 = (iz+1) / sz;
        quad(wingPoint(tx,z0,true),wingPoint(tx,z1,true),
          wingPoint(tx,z1,false),wingPoint(tx,z0,false),palette);
      }
    }
    const x0 = cell / CELLS, x1 = (cell+1) / CELLS;
    // A recessed black inlet shows the depth of each inflated cell.
    for(let ix=0;ix<sx;ix++) {
      const tx0 = (cell+ix/sx)/CELLS,tx1 = (cell+(ix+1)/sx)/CELLS;
      const b0 = .22*Math.sin(Math.PI*ix/sx),b1 = .22*Math.sin(Math.PI*(ix+1)/sx);
      quad(wingPoint(tx0,.045,true,b0),wingPoint(tx1,.045,true,b1),
        wingPoint(tx1,.045,false,b1),wingPoint(tx0,.045,false,b0),0);
    }
    quad(wingPoint(x0,1,true),wingPoint(x1,1,true),
      wingPoint(x1,1,false),wingPoint(x0,1,false),palette);
  }
  for (let rib = 0; rib <= CELLS; rib++) {
    const tx = rib / CELLS;
    for (let iz = 0; iz < sz; iz++) {
      line(seams,wingPoint(tx,iz/sz,true,.003),wingPoint(tx,(iz+1)/sz,true,.003));
    }
    line(seams,wingPoint(tx,0,true),wingPoint(tx,0,false));
  }
  for (let i = 0; i < 54; i++) for (const tz of [0,1]) {
    line(seams,wingPoint(i/54,tz,true,.003),wingPoint((i+1)/54,tz,true,.003));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));
  geometry.setIndex([...coloredIndices[0],...coloredIndices[1]]);
  geometry.addGroup(0,coloredIndices[0].length,0);
  geometry.addGroup(coloredIndices[0].length,coloredIndices[1].length,1);
  geometry.computeVertexNormals();
  const wing = new Mesh(geometry,surfaces); wing.name = 'Nine inflated black and orange cells';
  wing.castShadow = true; wing.receiveShadow = true; group.add(wing);
  const seamGeometry = new BufferGeometry();
  seamGeometry.setAttribute('position',new Float32BufferAttribute(seams,3));
  const seamLines = new LineSegments(seamGeometry,new LineBasicMaterial({color:0x797b73,transparent:true,opacity:.45}));
  seamLines.name = 'Stitched cell ribs and reinforced edges'; group.add(seamLines);

  const lineCount = (CELLS+1) * 4 + 8;
  const suspensionGeometry = new BufferGeometry();
  const suspensionPositions = new Float32BufferAttribute(new Float32Array(lineCount*6),3);
  suspensionGeometry.setAttribute('position',suspensionPositions);
  const suspension = new LineSegments(suspensionGeometry,new LineBasicMaterial({color:0xe2e0d3,transparent:true,opacity:.85}));
  suspension.name = 'Branched suspension and brake lines';
  // The tiny dynamic buffer is bounded by the complete wing, not stale anchors.
  suspension.frustumCulled = false; group.add(suspension);
  const riserGeometry = new BufferGeometry();
  const riserPositions = new Float32BufferAttribute(new Float32Array(4*4*3),3);
  riserGeometry.setAttribute('position',riserPositions);
  riserGeometry.setIndex([0,1,2,0,2,3,4,5,6,4,6,7,8,9,10,8,10,11,12,13,14,12,14,15]);
  const risers = new Mesh(riserGeometry,new MeshStandardMaterial({color:0x25272a,roughness:.9,side:2}));
  risers.name = 'Four load-bearing webbing risers'; risers.frustumCulled = false; group.add(risers);
  const toggleGeometry = new TorusGeometry(.028,.007,5,12);
  const toggleMaterial = new MeshStandardMaterial({color:0xb82e20,roughness:.9});
  const toggles = [-1,1].map(side=>{
    const toggle = new Mesh(toggleGeometry,toggleMaterial); toggle.name = 'Red brake toggle';
    toggle.rotation.z = side*.22; group.add(toggle); return toggle;
  });
  const banks = [];
  let cursor = 0;
  for (let bank = 0; bank < 4; bank++) {
    const side = bank < 2 ? -1 : 1, row = bank % 2;
    const junction = new Vector3(side*.38,2.18,row === 0 ? -.26 : .26);
    const upperIndex = cursor++;
    suspensionPositions.setXYZ(cursor++,junction.x,junction.y,junction.z);
    for (let rib = 0; rib <= CELLS; rib++) {
      const tx = rib / CELLS;
      suspensionPositions.setXYZ(cursor++,junction.x,junction.y,junction.z);
      const end = side < 0 && tx > .5 || side > 0 && tx < .5
        ? junction.toArray() : wingPoint(tx,row === 0 ? .20 : .76,false);
      suspensionPositions.setXYZ(cursor++,...end);
    }
    const brakeStart = cursor++;
    suspensionPositions.setXYZ(cursor++,...wingPoint(side < 0 ? 0 : 1,.96,false));
    banks.push({side,row,junction,upperIndex,brakeStart,lower:new Vector3(),upper:new Vector3(),hand:new Vector3(),
      attach:character.riserAnchors?.[side < 0 ? 0 : 1]?.position ?? new Vector3(side*.18,.30,-.04)});
  }
  group.userData.suspension = {character,suspensionPositions,riserPositions,banks,toggles,cells:CELLS,lineCount};
  updateParachutistSuspension(group);
  return group;
}

export function updateParachutistSuspension(group) {
  const rig = group?.userData?.suspension;
  if (!rig) return;
  const {character,suspensionPositions,riserPositions,banks,toggles} = rig;
  character.body.updateMatrix();
  let riserCursor = 0;
  for (const bank of banks) {
    const {lower,upper,hand,row,side,junction,attach,upperIndex,brakeStart} = bank;
    lower.copy(attach).applyMatrix4(character.body.matrix);
    lower.z += row === 0 ? -.035 : .035;
    upper.copy(lower); upper.y += .43; upper.z = junction.z * .55;
    suspensionPositions.setXYZ(upperIndex,upper.x,upper.y,upper.z);
    const arm = character.arms?.[side < 0 ? 0 : 1];
    if(arm) {
      arm.upper.updateMatrix(); arm.lower.updateMatrix();
      hand.set(0,-.30,-.01).applyMatrix4(arm.lower.matrix)
        .applyMatrix4(arm.upper.matrix).applyMatrix4(character.body.matrix);
    } else hand.copy(upper);
    suspensionPositions.setXYZ(brakeStart,hand.x,hand.y,hand.z);
    if(row === 1) toggles[side < 0 ? 0 : 1].position.copy(hand);
    const width = .019;
    riserPositions.setXYZ(riserCursor++,lower.x-width,lower.y,lower.z);
    riserPositions.setXYZ(riserCursor++,lower.x+width,lower.y,lower.z);
    riserPositions.setXYZ(riserCursor++,upper.x+width,upper.y,upper.z);
    riserPositions.setXYZ(riserCursor++,upper.x-width,upper.y,upper.z);
  }
  suspensionPositions.needsUpdate = true; riserPositions.needsUpdate = true;
}
