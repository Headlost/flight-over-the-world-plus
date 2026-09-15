import {
  BufferGeometry, CanvasTexture, CatmullRomCurve3, CircleGeometry,
  CylinderGeometry, DoubleSide, ExtrudeGeometry, Float32BufferAttribute,
  Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D,
  PlaneGeometry, Shape, SphereGeometry, SRGBColorSpace, TubeGeometry, Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Metres, with the same -Z forward / +Y up basis as the other aircraft.
// The livery is drawn only when the model is built; no textures are painted in flight.
const BODY = [
  [-2.94, 0.31, 0.32, 0.00], [-2.72, 0.45, 0.43, 0.00],
  [-2.16, 0.48, 0.48, 0.01], [-1.45, 0.47, 0.47, 0.02],
  [-0.70, 0.43, 0.43, 0.01], [0.10, 0.36, 0.36, -0.01],
  [0.85, 0.28, 0.29, -0.03], [1.60, 0.20, 0.22, -0.03],
  [2.40, 0.115, 0.14, -0.03], [3.05, 0.06, 0.085, -0.02],
  [3.30, 0.005, 0.014, -0.02],
];
let cachedBranding;

function bodyAt(z) {
  let i = 0;
  while (i < BODY.length - 2 && BODY[i + 1][0] < z) i++;
  const a = BODY[i], b = BODY[i + 1];
  const t = Math.max(0, Math.min(1, (z - a[0]) / (b[0] - a[0])));
  // Smooth interpolation keeps the highly polished cowl free of sharp rings.
  const s = t * t * (3 - 2 * t);
  return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s,
    a[3] + (b[3] - a[3]) * s];
}

function surfaceGeometry(nu, nv, surface, reverse = false) {
  const positions = [], uvs = [], indices = [];
  for (let v = 0; v <= nv; v++) {
    for (let u = 0; u <= nu; u++) {
      const p = surface(u / nu, v / nv);
      positions.push(p[0], p[1], p[2]);
      uvs.push(u / nu, v / nv);
    }
  }
  for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
    const a = v * (nu + 1) + u, b = a + 1, c = a + nu + 1, d = c + 1;
    if (reverse) indices.push(a, d, b, a, c, d);
    else indices.push(a, b, d, a, d, c);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function bodyPatch(side, z0, z1, angle0, angle1, offset = 0.006) {
  return surfaceGeometry(18, 8, (u, v) => {
    const z = side > 0 ? z1 - u * (z1 - z0) : z0 + u * (z1 - z0);
    const angle = angle0 + v * (angle1 - angle0);
    const [rx, ry, cy] = bodyAt(z);
    return [side * Math.cos(angle) * (rx + offset),
      cy + Math.sin(angle) * (ry + offset), z];
  });
}

function forwardBoarDecal(geometry, side) {
  // The artwork faces +U. Mirror the port decal so both heads face the -Z nose,
  // while keeping lettering in its independently readable side orientation.
  if (side < 0) {
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  }
  return geometry;
}

function wingPoint(side, span, chord, offset = 0) {
  const rootChord = 1.94, tipChord = 1.31;
  const c = rootChord + (tipChord - rootChord) * span;
  const leading = -1.42 + span * 0.34;
  const thickness = (0.13 - span * 0.06) * Math.sin(chord * Math.PI);
  return [side * (0.34 + span * 3.36), -0.105 + span * 0.055 + thickness + offset,
    leading + chord * c];
}

function airfoilWing(side) {
  return surfaceGeometry(20, 24, (u, v) => {
    const angle = v * Math.PI * 2;
    const chord = (1 - Math.cos(angle)) / 2;
    const p = wingPoint(side, u, chord);
    p[1] = -0.105 + u * 0.055 + Math.sin(angle) * (0.13 - u * 0.06);
    return p;
  }, side > 0);
}

function canvasTexture(width, height, paint) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paint(ctx, width, height);
  const texture = new CanvasTexture(canvas);
  texture.userData.sharedModelTexture = true;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function brandingTextures() {
  if (cachedBranding) return cachedBranding;
  const title = canvasTexture(2048, 512, (ctx, w, h) => {
    ctx.save(); ctx.translate(w * 0.035, h * 0.80); ctx.transform(1, 0, -0.18, 1, 0, 0);
    ctx.fillStyle = "#eeeae8";
    ctx.font = 'italic 900 335px "Arial Black", Impact, sans-serif';
    ctx.fillText("Dziki Dzik", 0, 0, w * 0.96);
    ctx.restore();
    // Small, sharp brush cuts give the lettering the torn racing-logo edges.
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000"; ctx.lineWidth = 7;
    for (let i = 0; i < 26; i++) {
      const x = 75 + i * 72, y = 110 + (i % 5) * 57;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 58, y - 23); ctx.stroke();
    }
  });
  const number = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = "#efeeeb"; ctx.textAlign = "center";
    ctx.font = '900 370px Impact, "Arial Black", sans-serif';
    ctx.fillText("01", 256, 400, 465);
  });
  // An original vector fallback also keeps the silhouette branded during artwork loading.
  const boar = canvasTexture(768, 768, (ctx) => {
    ctx.translate(55, 48); ctx.scale(0.9, 0.9);
    ctx.fillStyle = "#b7b8ba"; ctx.strokeStyle = "#e6e5e2"; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(110, 162); ctx.lineTo(83, 39); ctx.lineTo(235, 100);
    ctx.lineTo(310, 71); ctx.lineTo(359, 109); ctx.lineTo(393, 57);
    ctx.lineTo(462, 127); ctx.lineTo(520, 189); ctx.lineTo(623, 236);
    ctx.lineTo(690, 358); ctx.lineTo(640, 435); ctx.lineTo(551, 459);
    ctx.lineTo(590, 529); ctx.lineTo(481, 578); ctx.lineTo(379, 580);
    ctx.lineTo(315, 656); ctx.lineTo(227, 558); ctx.lineTo(174, 585);
    ctx.lineTo(111, 479); ctx.lineTo(51, 403); ctx.lineTo(77, 281);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#0c1012";
    ctx.beginPath(); ctx.moveTo(215, 171); ctx.lineTo(260, 237); ctx.lineTo(162, 307);
    ctx.lineTo(211, 362); ctx.lineTo(154, 422); ctx.lineTo(245, 420);
    ctx.lineTo(272, 491); ctx.lineTo(418, 515); ctx.lineTo(496, 435);
    ctx.lineTo(446, 323); ctx.lineTo(377, 292); ctx.lineTo(370, 225);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ed191e";
    ctx.beginPath(); ctx.moveTo(409, 256); ctx.lineTo(481, 277); ctx.lineTo(422, 289);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#0a0d0f";
    for (const [x,y] of [[626,352],[590,365]]) {
      ctx.beginPath(); ctx.ellipse(x,y,17,27,-0.4,0,Math.PI*2); ctx.fill();
    }
    ctx.fillStyle = "#f1eeeb";
    ctx.beginPath(); ctx.moveTo(529, 462); ctx.quadraticCurveTo(651, 536, 660, 387);
    ctx.quadraticCurveTo(714, 566, 584, 566); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(452, 484); ctx.quadraticCurveTo(504, 564, 545, 440);
    ctx.quadraticCurveTo(552, 615, 440, 556); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#626669"; ctx.lineWidth = 8;
    for(let i=0;i<12;i++) {
      ctx.beginPath(); ctx.moveTo(127 + i*12, 146+i*19);
      ctx.lineTo(214+i*9, 142+i*20); ctx.stroke();
    }
  });
  cachedBranding = { title, number, boar };
  return cachedBranding;
}

function decalMaterial(texture) {
  return new MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 0.38,
    metalness: 0.15, transparent: true, alphaTest: 0.04, depthWrite: false,
    side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
}

function planarFin(points, depth = 0.065) {
  const shape = new Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: true,
    bevelThickness: 0.018, bevelSize: 0.027, bevelSegments: 2, curveSegments: 4 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function mergeStaticOpaqueMeshes(plane) {
  const buckets = new Map();
  const sourceGeometries = new Set();
  // All fixed bodywork is a direct child. The propeller and flight controls
  // belong to separate groups and retain their individual animated meshes.
  // Glass and alpha decals remain independent for transparent render sorting.
  for (const mesh of plane.children) {
    if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.material.transparent) continue;
    let materialBuckets = buckets.get(mesh.material);
    if (!materialBuckets) buckets.set(mesh.material, materialBuckets = new Map());
    const flags = [mesh.castShadow, mesh.receiveShadow, mesh.renderOrder,
      mesh.visible, mesh.layers.mask, mesh.frustumCulled].join("|");
    let parts = materialBuckets.get(flags);
    if (!parts) materialBuckets.set(flags, parts = []);
    parts.push(mesh);
  }
  let saved = 0;
  for (const materialBuckets of buckets.values()) for (const meshes of materialBuckets.values()) {
    if (meshes.length < 2) continue;
    const baked = meshes.map(mesh => {
      mesh.updateMatrix();
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return geometry.applyMatrix4(mesh.matrix);
    });
    // All source primitives have position/normal/UV attributes. Non-indexed
    // clones make their different primitive index layouts compatible without
    // changing a triangle, vertex normal, texture coordinate or material.
    const geometry = mergeGeometries(baked, false);
    for (const temporary of baked) temporary.dispose();
    if (!geometry) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const first = meshes[0];
    const batch = new Mesh(geometry, first.material);
    batch.name = `Static ${first.material.color.getHexString()} aircraft bodywork`;
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.renderOrder = first.renderOrder;
    batch.visible = first.visible;
    batch.layers.mask = first.layers.mask;
    batch.frustumCulled = first.frustumCulled;
    batch.userData.staticBatch = true;
    batch.userData.componentNames = meshes.map(mesh => mesh.name).filter(Boolean);
    for (const mesh of meshes) {
      sourceGeometries.add(mesh.geometry);
      plane.remove(mesh);
    }
    plane.add(batch);
    saved += meshes.length - 1;
  }
  // The unit sphere is also used by the animated spinner. Dispose only
  // detached geometries; never materials, textures or geometry still in use.
  const retained = new Set();
  plane.traverse(object => { if (object.geometry) retained.add(object.geometry); });
  for (const geometry of sourceGeometries) if (!retained.has(geometry)) geometry.dispose();
  plane.userData.staticDrawCallsSaved = saved;
}

export function createDzikiDzikMesh({ boarTexture } = {}) {
  const plane = new Group(); plane.name = "Dziki dzik";
  const black = new MeshPhysicalMaterial({ color: 0x11151a, metalness: 0.43,
    roughness: 0.27, clearcoat: 0.9, clearcoatRoughness: 0.18 });
  const red = new MeshPhysicalMaterial({ color: 0xe21924, metalness: 0.24,
    roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.18 });
  const silver = new MeshStandardMaterial({ color: 0xb9bdc1, roughness: 0.3, metalness: 0.8 });
  const rubber = new MeshStandardMaterial({ color: 0x101113, roughness: 0.85, metalness: 0.02 });
  const darkMetal = new MeshStandardMaterial({ color: 0x252a30, roughness: 0.35, metalness: 0.8 });
  const cockpit = new MeshStandardMaterial({ color: 0x101416, roughness: 0.7 });
  const glass = new MeshPhysicalMaterial({ color: 0xa4c0cb, metalness: 0.08, roughness: 0.12,
    transparent: true, opacity: 0.31, depthWrite: false, side: DoubleSide,
    clearcoat: 1, clearcoatRoughness: 0.1 });
  const branding = brandingTextures();
  const boarMat = (boarTexture || branding.boar) ? decalMaterial(boarTexture || branding.boar) : null;
  const titleMat = branding.title ? decalMaterial(branding.title) : null;
  const numberMat = branding.number ? decalMaterial(branding.number) : null;

  const add = (geometry, material, parent = plane, name = "") => {
    const mesh = new Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = !material.transparent; mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  };
  const sphere = new SphereGeometry(1, 20, 12);
  const ellipsoid = (parent, material, position, scale, name = "") => {
    const mesh = add(sphere, material, parent, name);
    mesh.position.set(...position); mesh.scale.set(...scale); return mesh;
  };
  const tube = (points, radius, material, parent = plane, segments = 20) =>
    add(new TubeGeometry(new CatmullRomCurve3(points.map(p => new Vector3(...p))), segments,
      radius, 5, false), material, parent);
  const rod = (from, to, radius, material, parent = plane) => {
    const a = new Vector3(...from), b = new Vector3(...to), delta = b.clone().sub(a);
    const mesh = add(new CylinderGeometry(radius, radius, delta.length(), 8), material, parent);
    mesh.position.copy(a.add(b).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new Vector3(0,1,0), delta.normalize()); return mesh;
  };

  add(surfaceGeometry(64, 32, (u,v) => {
    const z = BODY[0][0] + u * (BODY.at(-1)[0] - BODY[0][0]);
    const [rx,ry,cy] = bodyAt(z), a = v*Math.PI*2;
    return [Math.cos(a)*rx, cy+Math.sin(a)*ry, z];
  }, true), black, plane, "Polished racing fuselage");
  const cowlRing = add(new CylinderGeometry(0.327, 0.39, 0.19, 32), red);
  cowlRing.rotation.x = Math.PI/2; cowlRing.position.z = -2.91;
  const intake = ellipsoid(plane, rubber, [0,-0.245,-2.925], [0.19,0.075,0.018], "Lower cowl air intake");
  intake.rotation.x = 0.17;
  for (const side of [-1,1]) {
    if (boarMat) add(forwardBoarDecal(bodyPatch(side,-2.47,-0.92,-0.48,1.03),side),boarMat,plane,"Silver boar / red eye");
    if (titleMat) add(bodyPatch(side,-0.72,1.5,-0.05,0.84),titleMat,plane,"Dziki Dzik brush lettering");
    tube([[-2.75,0.1],[-2.2,0.37],[-1.3,0.42],[-0.4,0.33],[0.6,0.25],[1.9,0.13],[3.15,0.035]]
      .map(([z,y]) => [side*(bodyAt(z)[0]+0.008)*0.72,y,z]),0.023,red);
    tube([[-2.73,-0.08],[-1.5,-0.24],[-0.3,-0.28],[1.1,-0.21],[2.6,-0.10]]
      .map(([z,y]) => [side*(bodyAt(z)[0]+0.009)*0.87,y,z]),0.011,silver);
    // Four small exhaust / ventilation slots keep the cowl visibly mechanical.
    for(let i=0;i<4;i++) {
      const vent = ellipsoid(plane,rubber,[side*0.463,0.01,-2.16+i*0.13],[0.013,0.045,0.032]);
      vent.rotation.x = -0.25;
    }
  }

  // Low, symmetric aerobatic wing, with rounded airfoil surfaces and painted tips.
  const ailerons = [];
  for (const side of [-1,1]) {
    add(airfoilWing(side),black,plane,side<0?"Port low wing":"Starboard low wing");
    ellipsoid(plane,red,[side*3.684,-0.050,-0.425],[0.031,0.067,0.655],"Rounded red wingtip");
    add(surfaceGeometry(3,16,(u,v)=>wingPoint(side,0.954+u*0.046,v,0.004),side>0),red);
    const leadingLine = [];
    for(let i=0;i<=20;i++) leadingLine.push(wingPoint(side,i/20,0.085,0.011));
    tube(leadingLine,0.016,silver,plane,24);
    for(const [start,width,mat] of [[0.06,0.025,red],[0.86,0.013,red],[0.89,0.006,silver]]) {
      add(surfaceGeometry(20,2,(u,v)=>wingPoint(side,u,start+v*width,0.008),side>0),mat);
    }
    // Red diagonal racing chevron follows the taper rather than floating above it.
    add(surfaceGeometry(16,2,(u,v)=>wingPoint(side,u,0.21+u*0.52+v*0.025,0.009),side>0),red);
    if(side<0 && titleMat) {
      add(surfaceGeometry(14,6,(u,v)=>wingPoint(side,0.14+(1-u)*0.76,0.24+(1-v)*0.41,0.014)),titleMat);
    } else if(boarMat) {
      add(surfaceGeometry(14,10,(u,v)=>wingPoint(side,0.16+u*0.74,0.10+(1-v)*0.74,0.015)),boarMat);
    }
    const aileron = new Group(); aileron.name = side<0?"Port aileron":"Starboard aileron";
    aileron.position.set(side*1.78,-0.082,0.18); plane.add(aileron); ailerons.push(aileron);
    add(surfaceGeometry(12,4,(u,v)=> {
      const p=wingPoint(side,0.46+u*0.49,0.80+v*0.20,0.007);
      return [p[0]-aileron.position.x,p[1]-aileron.position.y,p[2]-aileron.position.z];
    },side>0),black,aileron);
    tube([wingPoint(side,0.46,0.8,0.013),wingPoint(side,0.95,0.8,0.013)],0.009,darkMetal);
    ellipsoid(plane,side<0?red:silver,[side*3.685,-0.03,-0.35],[0.025,0.018,0.045],"Wingtip navigation lens");
  }

  // A transparent teardrop bubble, a pilot silhouette and tubular canopy bow.
  ellipsoid(plane,cockpit,[0,0.35,-0.13],[0.335,0.12,1.03],"Cockpit tub");
  const canopy = add(new SphereGeometry(1,28,16,0,Math.PI*2,0,Math.PI/2),glass,plane,"Bubble canopy");
  canopy.position.set(0,0.345,-0.26); canopy.scale.set(0.374,0.59,1.13); canopy.renderOrder=2;
  const cockpitRim=[];
  for(let i=0;i<=36;i++) {
    const a=i/36*Math.PI*2; cockpitRim.push([Math.cos(a)*0.376,0.35,-0.26+Math.sin(a)*1.132]);
  }
  tube(cockpitRim,0.018,darkMetal,plane,36);
  for(const z of [-0.91,0.56]) {
    const extent=Math.sqrt(Math.max(0,1-((z+0.26)/1.13)**2));
    const bow=[];
    for(let i=0;i<=18;i++) {
      const a=i/18*Math.PI; bow.push([Math.cos(a)*0.376*extent,0.35+Math.sin(a)*0.59*extent,z]);
    }
    tube(bow,0.017,silver,plane,18);
  }
  ellipsoid(plane,cockpit,[0,0.45,0.12],[0.20,0.23,0.21],"Pilot racing suit");
  ellipsoid(plane,red,[0,0.697,0.07],[0.135,0.155,0.14],"Pilot helmet");
  ellipsoid(plane,darkMetal,[0,0.70,-0.055],[0.115,0.055,0.037],"Helmet visor");
  rod([-0.10,0.48,0.0],[-0.08,0.39,-0.28],0.045,cockpit);
  rod([0.10,0.48,0.0],[0.08,0.39,-0.28],0.045,cockpit);
  rod([-0.10,0.37,-0.11],[0.10,0.37,-0.11],0.014,silver);
  ellipsoid(plane,darkMetal,[0,0.40,-0.84],[0.30,0.12,0.075],"Instrument panel");

  // Swept vertical fin with the 01 racing number, and a full-width elevator.
  const finPoints=[[2.02,0.03],[2.43,1.09],[2.87,1.20],[3.30,0.06]];
  const finGeo=planarFin(finPoints);
  const fin=add(finGeo,black,plane,"Swept racing fin");
  // This shape's XY plane is mapped to local ZY, with its thickness along X.
  fin.rotation.y=-Math.PI/2;
  const finRed=add(planarFin([[2.79,1.18],[2.87,1.20],[3.30,0.06],[3.23,0.07]],0.071),red);
  finRed.rotation.y=-Math.PI/2;
  const rudder=new Group(); rudder.name="Rudder"; rudder.position.set(0,0,3.01); plane.add(rudder);
  const rudderMesh=add(planarFin([[0,0.12],[-0.12,1.14],[0.29,0.06]],0.07),black,rudder);
  rudderMesh.rotation.y=-Math.PI/2;
  for(const side of [-1,1]) {
    if(numberMat) {
      const number=add(new PlaneGeometry(0.52,0.59),numberMat,plane,"Fin number 01");
      number.position.set(side*0.055,0.42,2.80); number.rotation.y=side*Math.PI/2;
    }
    if(boarMat) {
      const mark=add(forwardBoarDecal(new PlaneGeometry(0.49,0.45),side),boarMat,plane,"Fin boar crest");
      mark.position.set(side*0.056,0.88,2.65); mark.rotation.y=side*Math.PI/2;
    }
  }
  const tailShape=[[-1.29,0.35],[-1.22,-0.10],[-0.12,-0.40],[0.12,-0.40],[1.22,-0.10],[1.29,0.35]];
  const tail=add(planarFin(tailShape,0.04),black,plane,"Symmetric horizontal stabilizer");
  tail.rotation.x=Math.PI/2; tail.position.set(0,0.025,2.70);
  for(const side of [-1,1]) {
    tube([[side*0.14,0.06,2.31],[side*1.20,0.06,2.57],[side*1.27,0.06,3.02]],0.018,red);
  }
  const elevator=new Group(); elevator.name="Elevator"; elevator.position.set(0,0.025,2.90); plane.add(elevator);
  const elevatorGeo=planarFin([[-1.24,-0.01],[-1.16,0.18],[1.16,0.18],[1.24,-0.01]],0.045);
  const elevatorMesh=add(elevatorGeo,black,elevator); elevatorMesh.rotation.x=Math.PI/2;

  // Four sculpted blades and red tips are animated through the usual prop contract.
  const prop=new Group(); prop.name="Four-blade racing propeller"; prop.position.z=-3.105; plane.add(prop);
  const blades=[];
  const bladeShape=new Shape(); bladeShape.moveTo(-0.04,0.15); bladeShape.bezierCurveTo(-0.15,0.46,-0.14,0.90,-0.08,1.08);
  bladeShape.quadraticCurveTo(0.04,1.17,0.085,1.055); bladeShape.bezierCurveTo(0.16,0.87,0.11,0.38,0.04,0.15); bladeShape.closePath();
  const bladeGeo=new ExtrudeGeometry(bladeShape,{depth:0.035,bevelEnabled:true,bevelSize:0.008,bevelThickness:0.008,bevelSegments:1,curveSegments:8});
  for(let i=0;i<4;i++) {
    const blade=new Group(); blade.name="helice"; blade.rotation.z=i*Math.PI/2+0.32; prop.add(blade); blades.push(blade);
    add(bladeGeo,black,blade);
    const tipShape=new Shape(); tipShape.moveTo(-0.075,0.985); tipShape.lineTo(-0.08,1.08);
    tipShape.quadraticCurveTo(0.04,1.17,0.085,1.055); tipShape.lineTo(0.107,0.985); tipShape.closePath();
    const tip=add(new ExtrudeGeometry(tipShape,{depth:0.06,bevelEnabled:false,curveSegments:8}),red,blade);
    tip.position.z=-0.013;
  }
  ellipsoid(prop,red,[0,0,-0.12],[0.245,0.245,0.33],"Red racing spinner");
  const propDisc=add(new CircleGeometry(1.15,32),new MeshStandardMaterial({color:0x3b424a,
    transparent:true,opacity:0.10,side:DoubleSide,depthWrite:false}),prop,"propdisc");
  propDisc.position.z=0.04; propDisc.visible=false;

  // Fixed taildragger: swept spring legs, elongated red/black wheel fairings.
  for(const side of [-1,1]) {
    rod([side*0.30,-0.22,-0.83],[side*1.01,-0.92,-0.97],0.045,darkMetal);
    rod([side*0.31,-0.24,-0.55],[side*1.01,-0.91,-0.94],0.032,black);
    const pantPoint=(u,v,offset=0)=>{
      const angle=v*Math.PI*2;
      const r=Math.sin(Math.PI*u)**0.65;
      const taper=1-0.26*u;
      return [side*1.02+Math.cos(angle)*(0.252*r*taper+offset),
        -1.015+Math.sin(angle)*(0.244*r*taper+offset),-1.49+u*0.99];
    };
    add(surfaceGeometry(24,16,(u,v)=>pantPoint(u,v),true),black,plane,"Streamlined main wheel pant");
    add(surfaceGeometry(18,8,(u,v)=>pantPoint(u*0.79,v*0.5,0.004),true),red,plane,"Red upper wheel fairing");
    const wheel=add(new CylinderGeometry(0.218,0.218,0.16,16),rubber);
    wheel.rotation.z=Math.PI/2; wheel.position.set(side*1.02,-1.115,-0.87);
    const hub=add(new CylinderGeometry(0.085,0.085,0.165,12),silver);
    hub.rotation.z=Math.PI/2; hub.position.copy(wheel.position);
    tube([[side*0.79,-1.05,-1.25],[side*0.79,-1.075,-0.83],[side*0.82,-1.03,-0.66]],0.008,silver);
  }
  rod([0,-0.08,2.71],[0,-0.43,3.03],0.032,darkMetal);
  const tailWheel=add(new CylinderGeometry(0.125,0.125,0.10,12),rubber);
  tailWheel.rotation.z=Math.PI/2; tailWheel.position.set(0,-0.50,3.05);

  // Two distinct steel nozzles point rearward. Smoke code uses their local anchors.
  const smokeEmitters=[];
  for(const side of [-1,1]) {
    rod([side*0.38,-0.35,-1.10],[side*0.61,-0.39,-0.52],0.063,darkMetal);
    const nozzle=add(new CylinderGeometry(0.085,0.068,0.25,16,1,true),silver,plane,"Aerobatic smoke nozzle");
    nozzle.rotation.x=Math.PI/2; nozzle.position.set(side*0.61,-0.39,-0.405);
    const bore=add(new CircleGeometry(0.064,16),rubber);
    bore.position.set(side*0.61,-0.39,-0.277);
    const emitter=new Object3D(); emitter.name=side<0?"Port smoke emitter":"Starboard smoke emitter";
    emitter.position.set(side*0.61,-0.39,-0.265); plane.add(emitter); smokeEmitters.push(emitter);
  }
  plane.userData.prop=prop;
  plane.userData.blades=blades;
  plane.userData.propDisc=propDisc;
  plane.userData.customProp=true;
  plane.userData.preserveMaterials=true;
  plane.userData.smokeEmitters=smokeEmitters;
  plane.userData.controlSurfaces={ailerons,elevator,rudder};
  plane.userData.dimensions={length:6.8,wingSpan:7.4,height:2.55};
  plane.userData.wingSpan=7.4;
  plane.userData.isDzikiDzik=true;
  mergeStaticOpaqueMeshes(plane);
  return plane;
}
