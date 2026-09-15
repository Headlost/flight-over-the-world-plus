import {
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  TextureLoader,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// One immutable weave is shared; clothing materials are deliberately per rig,
// so another player's rank and disposal cannot affect this character.
let weaveTexture;
let faceTexture;
let nylonTexture;
export const PARACHUTIST_SUIT_PALETTE = Object.freeze({
  base: 0x247f72,
  accent: 0x39aef0,
  baseEmissiveIntensity: 0.12,
  accentEmissiveIntensity: 0.10,
});

function photographicTexture(kind) {
  if (typeof document === "undefined") return null;
  if (kind === "face" && faceTexture) return faceTexture;
  if (kind === "nylon" && nylonTexture) return nylonTexture;
  const texture = new TextureLoader().load(`${import.meta.env?.BASE_URL || "/"}textures/parachutist/${kind === "face" ? "face" : "nylon"}-albedo.png`);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData.sharedModelTexture = true;
  if (kind === "face") faceTexture = texture;
  else {
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(1.6, 1.35);
    nylonTexture = texture;
  }
  return texture;
}

function faceUV(geometry) {
  const p = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i += 1) {
    uv.setXY(i, (p.getX(i) + 0.085) / 0.17, (p.getY(i) + 0.11) / 0.245);
  }
  return geometry;
}
function clothWeave() {
  if (weaveTexture || typeof document === "undefined") return weaveTexture || null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(128, 128);
  for (let y = 0; y < 128; y += 1) {
    for (let x = 0; x < 128; x += 1) {
      const i = (y * 128 + x) * 4;
      const thread = (x % 4 === 0 ? 14 : 0) + (y % 4 === 0 ? 10 : 0);
      const grain = ((x * 37 + y * 61 + x * y * 13) % 19) - 9;
      const value = 222 + thread + grain;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  weaveTexture = new CanvasTexture(canvas);
  weaveTexture.name = "parachutist-original-nylon-weave";
  weaveTexture.wrapS = weaveTexture.wrapT = RepeatWrapping;
  weaveTexture.repeat.set(10, 12);
  weaveTexture.anisotropy = 4;
  weaveTexture.userData.sharedModelTexture = true;
  return weaveTexture;
}

function ellipsoid(x, y, z, sx, sy, sz, detail = 14) {
  const geometry = new SphereGeometry(1, detail, Math.max(8, Math.round(detail * 0.65)));
  geometry.scale(sx, sy, sz);
  geometry.translate(x, y, z);
  return geometry;
}

// An elliptical loft gives shoulders, tapering sleeves and padded shoes their
// own silhouette. Ring values are [y, half width, half depth, z centre].
function loft(rings, segments = 20, folds = 0, phase = 0) {
  // Midpoint cubic interpolation removes the hard bands of a primitive loft,
  // while keeping each articulated garment inside its original contact shape.
  if (rings.length > 3) {
    const smooth = [];
    for (let i = 0; i < rings.length - 1; i += 1) {
      smooth.push(rings[i]);
      const a = rings[Math.max(0, i - 1)];
      const b = rings[i];
      const c = rings[i + 1];
      const d = rings[Math.min(rings.length - 1, i + 2)];
      const mid = [0, 0, 0, 0];
      mid[0] = (b[0] + c[0]) / 2;
      for (let n = 1; n < 4; n += 1) {
        mid[n] = ((b[n] || 0) + (c[n] || 0)) * 0.5625
          - ((a[n] || 0) + (d[n] || 0)) * 0.0625;
      }
      smooth.push(mid);
    }
    smooth.push(rings.at(-1));
    rings = smooth;
  }
  const positions = [];
  const uv = [];
  const indices = [];
  const length = rings.length;
  for (let row = 0; row < length; row += 1) {
    const [y, rx, rz, centreZ = 0] = rings[row];
    for (let j = 0; j <= segments; j += 1) {
      const a = (j / segments) * Math.PI * 2;
      const ripple = 1 + folds * Math.sin(row * 2.9 + a * 5 + phase)
        * Math.sin((row / (length - 1)) * Math.PI);
      positions.push(Math.cos(a) * rx * ripple, y, centreZ + Math.sin(a) * rz * ripple);
      uv.push(j / segments, row / (length - 1));
      if (row < length - 1 && j < segments) {
        const n = row * (segments + 1) + j;
        indices.push(n, n + segments + 1, n + 1, n + 1, n + segments + 1, n + segments + 2);
      }
    }
  }
  for (const row of [0, length - 1]) {
    const centre = positions.length / 3;
    positions.push(0, rings[row][0], rings[row][3] || 0);
    uv.push(0.5, 0.5);
    for (let j = 0; j < segments; j += 1) {
      const n = row * (segments + 1) + j;
      if (row === 0) indices.push(centre, n, n + 1);
      else indices.push(centre, n + 1, n);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function tube(points, radius = 0.005, segments = 5) {
  return new TubeGeometry(
    new CatmullRomCurve3(points.map(point => new Vector3(...point))),
    Math.max(4, (points.length - 1) * segments), radius, 5, false,
  );
}

function ribbon(points, width, axis = [1, 0, 0]) {
  const positions = [];
  const uv = [];
  const indices = [];
  const offset = new Vector3(...axis).normalize().multiplyScalar(width / 2);
  points.forEach(([x, y, z], i) => {
    positions.push(x - offset.x, y - offset.y, z - offset.z,
      x + offset.x, y + offset.y, z + offset.z);
    uv.push(0, i / (points.length - 1), 1, i / (points.length - 1));
    if (i < points.length - 1) {
      const n = i * 2;
      indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ovalArc(cx, cy, cz, rx, ry, start, end, steps = 10) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = start + ((end - start) * i) / steps;
    points.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, cz]);
  }
  return points;
}

function buckle(group, add, material, x, y, z, width = 0.038, height = 0.046) {
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(width, height) * 0.15;
  const points = [
    [x - w + r, y + h, z], [x + w - r, y + h, z],
    [x + w, y + h - r, z], [x + w, y - h + r, z],
    [x + w - r, y - h, z], [x - w + r, y - h, z],
    [x - w, y - h + r, z], [x - w, y + h - r, z],
    [x - w + r, y + h, z],
  ];
  add(group, tube(points, 0.0043, 2), material);
  add(group, tube([[x - w, y - 0.001, z], [x + w, y - 0.001, z]], 0.0032), material);
}

function hoodShell() {
  const positions = [];
  const uv = [];
  const indices = [];
  const rows = 20;
  const segments = 36;
  // The opening follows the forehead, cheek and jaw. Positive Z is the closed
  // back; the front (-Z) stays genuinely open instead of painting on a face.
  for (let row = 0; row <= rows; row += 1) {
    const latitude = -Math.PI / 2 + (row / rows) * Math.PI;
    const y = Math.sin(latitude) * 0.143 + 0.012;
    const cosLat = Math.cos(latitude);
    const opening = Math.max(0, Math.min(0.76, (0.093 - y) * 28, (y + 0.116) * 42));
    for (let j = 0; j <= segments; j += 1) {
      const a = -Math.PI / 2 + opening + (j / segments) * (Math.PI * 2 - opening * 2);
      const wrinkle = 1 + 0.025 * Math.sin(row * 2.7 + j * 1.3) * cosLat;
      positions.push(Math.cos(a) * 0.121 * cosLat * wrinkle,
        y, Math.sin(a) * 0.126 * cosLat * wrinkle + 0.022);
      uv.push(j / segments, row / rows);
      if (row < rows && j < segments) {
        const n = row * (segments + 1) + j;
        indices.push(n, n + segments + 1, n + 1, n + 1, n + segments + 1, n + segments + 2);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function roundedLens(x, y, z, width = 0.068, height = 0.037) {
  const points = [];
  const r = 0.008;
  const w = width / 2;
  const h = height / 2;
  for (const [cx, cy, start] of [[w - r, h - r, 0], [-w + r, h - r, Math.PI / 2],
    [-w + r, -h + r, Math.PI], [w - r, -h + r, Math.PI * 1.5]]) {
    for (let i = 0; i <= 5; i += 1) {
      const angle = start + i * Math.PI / 10;
      const px = cx + Math.cos(angle) * r;
      points.push([x + px, y + cy + Math.sin(angle) * r, z + Math.abs(x + px) ** 2 * 1.5]);
    }
  }
  points.push(points[0]);
  const positions = [x, y, z + x * x * 1.5];
  const uv = [0.5, 0.5];
  const indices = [];
  points.forEach((point, i) => {
    positions.push(...point);
    uv.push((point[0] - x) / width + 0.5, (point[1] - y) / height + 0.5);
    if (i < points.length - 1) indices.push(0, i + 2, i + 1);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, rim: points };
}

function sleeveStripe(rings, side, angularWidth = 0.4) {
  const positions = [], uv = [], indices = [];
  rings.forEach(([y, rx, rz, cz = 0], i) => {
    const centre = side > 0 ? -0.78 : Math.PI + 0.78;
    for (const edge of [-1, 1]) {
      const a = centre + edge * angularWidth / 2;
      positions.push(Math.cos(a) * (rx + 0.0035), y, Math.sin(a) * (rz + 0.0035) + cz);
      uv.push((edge + 1) / 2, i / (rings.length - 1));
    }
    if (i < rings.length - 1) {
      const n = i * 2;
      indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function wingBadge(group, add, silver, accent, x, y, z, scale = 1) {
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row += 1) {
      add(group, ribbon([
        [x + side * 0.008 * scale, y - row * 0.005 * scale, z],
        [x + side * (0.031 - row * 0.006) * scale, y + (0.009 - row * 0.003) * scale, z],
      ], 0.0028 * scale, [0, 1, 0]), silver);
    }
  }
  add(group, ellipsoid(x, y - 0.003 * scale, z, 0.0045 * scale, 0.009 * scale, 0.0015), accent);
}

/**
 * An articulated, 1.91 m adult rig in metres. Facing -Z, with boot soles at
 * pilot Y=-0.32 and body origin Y=0.92, matching the walking contact contract.
 * Details are baked together per material inside each moving joint.
 */
export function createParachutistCharacter() {
  const weave = clothWeave();
  const nylon = photographicTexture("nylon");
  const photoFace = photographicTexture("face");
  const textile = { roughness: 0.94, map: nylon || weave, bumpMap: nylon || weave, bumpScale: 0.0045 };
  const fabric = new MeshStandardMaterial({
    ...textile,
    color: PARACHUTIST_SUIT_PALETTE.base,
    emissive: PARACHUTIST_SUIT_PALETTE.base,
    emissiveIntensity: PARACHUTIST_SUIT_PALETTE.baseEmissiveIntensity,
    side: DoubleSide,
  });
  fabric.name = "parachutist-suit-base-teal";
  const accent = new MeshStandardMaterial({
    ...textile,
    color: PARACHUTIST_SUIT_PALETTE.accent,
    emissive: PARACHUTIST_SUIT_PALETTE.accent,
    emissiveIntensity: PARACHUTIST_SUIT_PALETTE.accentEmissiveIntensity,
    side: DoubleSide,
  });
  accent.name = "parachutist-suit-accent-blue";
  const webbing = new MeshStandardMaterial({ ...textile, color: 0x101315, roughness: 0.95, side: DoubleSide });
  const seam = new MeshStandardMaterial({ color: 0x353b3c, roughness: 0.89 });
  const leather = new MeshStandardMaterial({ color: 0x111415, roughness: 0.59 });
  const rubber = new MeshStandardMaterial({ color: 0x080a0b, roughness: 0.97 });
  const silver = new MeshStandardMaterial({ color: 0x9aa3a5, metalness: 0.83, roughness: 0.31, side: DoubleSide });
  const release = new MeshStandardMaterial({ color: 0xbb251a, roughness: 0.5 });
  const skin = new MeshStandardMaterial({ color: 0xb88669, roughness: 0.83 });
  const face = new MeshStandardMaterial({ color: photoFace ? 0xffffff : 0xb88669, map: photoFace, roughness: 0.87 });
  const lenses = new MeshStandardMaterial({ color: 0x080d10, roughness: 0.29, metalness: 0.22, side: DoubleSide });
  const lace = new MeshStandardMaterial({ color: 0x6d706c, roughness: 0.96 });

  const pilot = new Group();
  pilot.name = "detailed-articulated-parachutist";
  const body = new Group();
  body.name = "parachutist-torso";
  body.position.y = 0.92;
  pilot.add(body);
  const batches = new Map();
  const add = (group, geometry, material) => {
    if (!batches.has(group)) batches.set(group, new Map());
    const materials = batches.get(group);
    if (!materials.has(material)) materials.set(material, []);
    materials.get(material).push(geometry);
  };

  // Neck to seat: broad deltoids, a fitted waist and two soft abdominal folds.
  add(body, loft([
    [-0.30, 0.11, 0.075, 0.007], [-0.255, 0.145, 0.088, 0.006],
    [-0.18, 0.154, 0.10, 0], [-0.11, 0.15, 0.103, -0.007],
    [-0.025, 0.164, 0.108, -0.009], [0.06, 0.178, 0.116, -0.012],
    [0.16, 0.20, 0.121, -0.008], [0.25, 0.219, 0.113, 0],
    [0.30, 0.201, 0.095, 0.002], [0.36, 0.10, 0.071, 0.001],
    [0.39, 0.067, 0.057, 0],
  ], 28, 0.07), fabric);
  add(body, loft([[0.34, 0.074, 0.066, 0], [0.39, 0.080, 0.072, 0],
    [0.415, 0.074, 0.069, 0]], 20, 0.01), webbing);
  // Collar rolled edge, seam and center zipper with individually visible teeth.
  add(body, tube(ovalArc(0, 0.39, -0.062, 0.072, 0.026, 0, Math.PI), 0.006), seam);
  add(body, tube([[0, -0.245, -0.091], [0, -0.10, -0.119], [0, 0.08, -0.133],
    [0, 0.24, -0.115], [0, 0.385, -0.075]], 0.006), webbing);
  for (let i = 0; i < 28; i += 1) {
    const y = -0.23 + i * 0.020;
    const z = y < 0 ? -0.12 + y * -0.09 : -0.13 + Math.max(0, y - 0.1) * 0.18;
    add(body, tube([[-0.003, y, z], [0.003, y, z]], 0.0014, 2), silver);
  }
  buckle(body, add, silver, 0.002, 0.32, -0.095, 0.013, 0.022);
  for (const side of [-1, 1]) {
    add(body, tube([[side * 0.046, -0.15, -0.098], [side * 0.085, -0.125, -0.095],
      [side * 0.135, -0.115, -0.070]], 0.0028), seam);
    add(body, tube([[side * 0.023, -0.038, -0.118], [side * 0.090, -0.016, -0.113],
      [side * 0.142, 0.002, -0.085]], 0.003), seam);
    add(body, ribbon([[side * 0.18, 0.28, -0.069], [side * 0.20, 0.20, -0.057],
      [side * 0.164, 0.045, -0.071], [side * 0.145, -0.13, -0.056],
      [side * 0.137, -0.22, -0.057]], 0.025), accent);
  }

  // Pack has a convex cordura shell, a blue swept V and raised sewn panels.
  add(body, loft([
    [-0.185, 0.127, 0.055, 0.225], [-0.145, 0.170, 0.092, 0.222],
    [-0.045, 0.184, 0.102, 0.216], [0.12, 0.185, 0.098, 0.208],
    [0.28, 0.173, 0.082, 0.196], [0.36, 0.147, 0.055, 0.178],
    [0.39, 0.10, 0.036, 0.163],
  ], 26, 0.02), fabric);
  for (const side of [-1, 1]) {
    add(body, ribbon([[side * 0.14, 0.31, 0.252], [side * 0.119, 0.20, 0.300],
      [side * 0.067, 0.045, 0.315], [side * 0.031, -0.092, 0.305]], 0.035), accent);
    add(body, tube([[side * 0.146, 0.335, 0.236], [side * 0.18, 0.22, 0.235],
      [side * 0.187, 0.04, 0.24], [side * 0.176, -0.113, 0.24],
      [side * 0.118, -0.168, 0.254]], 0.0035), seam);
    add(body, tube([[side * 0.082, 0.29, 0.267], [side * 0.072, 0.22, 0.306],
      [side * 0.041, 0.185, 0.314]], 0.003), seam);
  }
  add(body, ribbon([[-0.062, 0.205, 0.310], [0, 0.202, 0.313],
    [0.062, 0.205, 0.310]], 0.016, [0, 1, 0]), webbing);
  wingBadge(body, add, silver, accent, 0, 0.11, 0.315, 1.1);
  add(body, tube([[-0.049, 0.355, 0.202], [-0.048, 0.412, 0.217],
    [0.048, 0.412, 0.217], [0.049, 0.355, 0.202]], 0.009), webbing);

  // Harness straps wrap over the shoulder and back, not through the jacket.
  const riserAnchors = [];
  for (const side of [-1, 1]) {
    add(body, ribbon([[side * 0.115, -0.155, -0.080], [side * 0.13, -0.045, -0.11],
      [side * 0.14, 0.10, -0.119], [side * 0.17, 0.265, -0.085],
      [side * 0.165, 0.34, -0.033], [side * 0.155, 0.35, 0.081],
      [side * 0.138, 0.275, 0.14], [side * 0.12, -0.12, 0.143]], 0.039), webbing);
    add(body, tube([[side * 0.13, -0.07, -0.119], [side * 0.162, 0.24, -0.101],
      [side * 0.160, 0.325, -0.042]], 0.002), seam);
    buckle(body, add, silver, side * 0.156, 0.18, -0.119, 0.038, 0.050);
    buckle(body, add, silver, side * 0.128, -0.045, -0.126, 0.033, 0.042);
    add(body, tube(ovalArc(side * 0.175, 0.28, -0.085, 0.014, 0.020,
      0, Math.PI * 2, 12), 0.004), silver);
    const anchor = new Group();
    anchor.name = side < 0 ? "left-harness-riser" : "right-harness-riser";
    anchor.position.set(side * 0.175, 0.28, -0.085);
    body.add(anchor);
    riserAnchors.push(anchor);
    add(body, ribbon([[side * 0.115, -0.10, -0.090], [side * 0.15, -0.205, -0.065],
      [side * 0.18, -0.23, 0.018]], 0.030), webbing);
    buckle(body, add, silver, side * 0.157, -0.198, -0.077, 0.030, 0.037);
  }
  add(body, ribbon([[-0.138, 0.082, -0.130], [0, 0.077, -0.136],
    [0.138, 0.082, -0.130]], 0.029, [0, 1, 0]), webbing);
  buckle(body, add, silver, 0.017, 0.079, -0.143, 0.029, 0.034);
  const waist = [];
  for (let i = 0; i <= 32; i += 1) {
    const a = (i / 32) * Math.PI * 2;
    waist.push([Math.cos(a) * 0.153, -0.149, Math.sin(a) * 0.109 + 0.002]);
  }
  add(body, ribbon(waist, 0.037, [0, 1, 0]), webbing);
  buckle(body, add, silver, 0, -0.148, -0.114, 0.045, 0.041);
  add(body, tube([[-0.151, 0.03, -0.129], [-0.162, -0.007, -0.135],
    [-0.168, -0.034, -0.135]], 0.010), release);
  add(body, tube([[0.154, -0.055, -0.106], [0.185, -0.037, -0.109],
    [0.188, -0.071, -0.11], [0.166, -0.084, -0.113]], 0.007), release);

  const headGroup = new Group();
  headGroup.name = "parachutist-head-look";
  headGroup.position.set(0, 0.515, -0.003);
  body.add(headGroup);
  add(headGroup, ellipsoid(0, -0.105, 0.006, 0.053, 0.082, 0.053), skin);
  // Broad cheek plane and narrow chin, with a real profile and jaw line.
  add(headGroup, faceUV(loft([
    [-0.105, 0.044, 0.039, -0.025], [-0.08, 0.066, 0.052, -0.021],
    [-0.04, 0.079, 0.064, -0.020], [0.02, 0.085, 0.071, -0.012],
    [0.075, 0.079, 0.071, -0.004], [0.12, 0.055, 0.053, 0.002],
    [0.135, 0.014, 0.019, 0.008],
  ], 32)), face);
  add(headGroup, hoodShell(), fabric);
  // Folded hood rim follows the open face, keeping the goggles and nose clear.
  for (const side of [-1, 1]) {
    add(headGroup, tube([[side * 0.049, 0.087, -0.078], [side * 0.072, 0.066, -0.080],
      [side * 0.095, 0.022, -0.067], [side * 0.086, -0.040, -0.066],
      [side * 0.060, -0.094, -0.060], [side * 0.026, -0.111, -0.058]], 0.006), webbing);
    add(headGroup, ellipsoid(side * 0.083, -0.008, 0.009, 0.010, 0.024, 0.012), skin);
    add(headGroup, tube([[side * 0.079, -0.082, -0.02], [side * 0.079, -0.11, -0.032],
      [side * 0.058, -0.13, -0.035]], 0.0028), seam);
  }
  const hoodStripe = [];
  for (let i = 0; i <= 26; i += 1) {
    const a = 2.3 - i / 26 * 3.38;
    hoodStripe.push([0.025, 0.012 + 0.145 * Math.cos(a), 0.022 + 0.130 * Math.sin(a)]);
  }
  add(headGroup, ribbon(hoodStripe, 0.020), accent);
  wingBadge(headGroup, add, silver, accent, -0.020, 0.098, -0.084, 0.45);
  // Nose bridge, nostrils, philtrum and lips retain a human silhouette at close range.
  add(headGroup, faceUV(ellipsoid(0, 0.019, -0.081, 0.011, 0.029, 0.014, 20)), face);
  add(headGroup, faceUV(ellipsoid(0, 0.001, -0.097, 0.014, 0.011, 0.017, 20)), face);
  for (const side of [-1, 1]) {
    add(headGroup, faceUV(ellipsoid(side * 0.012, -0.002, -0.094, 0.008, 0.006, 0.009)), face);
  }
  add(headGroup, faceUV(ellipsoid(0, -0.045, -0.078, 0.025, 0.009, 0.0035)), face);
  // Glazed wrap-around goggles: dark glass and a thick anatomical frame.
  for (const side of [-1, 1]) {
    const x = side * 0.039;
    const lens = roundedLens(x, 0.050, -0.096);
    add(headGroup, lens.geometry, lenses);
    add(headGroup, tube(lens.rim, 0.0047, 1), rubber);
    add(headGroup, tube([[side * 0.075, 0.052, -0.085], [side * 0.088, 0.047, -0.032],
      [side * 0.084, 0.035, 0.025]], 0.006), rubber);
  }
  add(headGroup, tube([[-0.012, 0.046, -0.094], [0, 0.054, -0.101],
    [0.012, 0.046, -0.094]], 0.0046), rubber);

  const arms = [];
  const legs = [];
  for (const side of [-1, 1]) {
    const upper = new Group();
    upper.name = `${side < 0 ? "left" : "right"}-shoulder`;
    upper.position.set(side * 0.235, 0.27, 0);
    upper.rotation.z = -side * 0.045;
    body.add(upper);
    add(upper, loft([[0.045, 0.040, 0.047, 0], [0, 0.074, 0.079, 0],
      [-0.08, 0.072, 0.075, 0.004], [-0.17, 0.062, 0.068, 0.005],
      [-0.26, 0.054, 0.061, 0.004], [-0.33, 0.047, 0.052, 0]], 20, 0.065, side), fabric);
    add(upper, sleeveStripe([[0.013, 0.071, 0.078], [-0.055, 0.073, 0.076, 0.003],
      [-0.15, 0.065, 0.070, 0.005], [-0.25, 0.055, 0.062, 0.004],
      [-0.326, 0.047, 0.052]], side), accent);
    add(upper, tube([[side * 0.025, -0.081, -0.069], [side * 0.024, -0.14, -0.060],
      [side * 0.010, -0.21, -0.061]], 0.0022), seam);
    const lower = new Group();
    lower.name = `${side < 0 ? "left" : "right"}-elbow`;
    lower.position.y = -0.33;
    upper.add(lower);
    add(lower, loft([[0.013, 0.046, 0.052, 0], [-0.027, 0.054, 0.058, 0],
      [-0.095, 0.050, 0.052, -0.002], [-0.17, 0.043, 0.047, -0.003],
      [-0.245, 0.037, 0.039, -0.004], [-0.297, 0.036, 0.035, -0.005]], 20, 0.08, -side), fabric);
    add(lower, sleeveStripe([[-0.012, 0.052, 0.057], [-0.09, 0.051, 0.054, -0.002],
      [-0.18, 0.044, 0.047, -0.003], [-0.273, 0.037, 0.038, -0.004]], side), accent);
    add(lower, loft([[-0.272, 0.037, 0.040, -0.005], [-0.298, 0.038, 0.038, -0.005],
      [-0.313, 0.036, 0.036, -0.007]], 16), webbing);
    // Padding is segmented across the knuckles; fingers and the bent thumb are
    // separate shapes but baked into a single leather draw inside this elbow.
    add(lower, ellipsoid(0, -0.35, -0.010, 0.041, 0.055, 0.026), leather);
    add(lower, ellipsoid(0, -0.352, -0.028, 0.035, 0.022, 0.014), rubber);
    for (let finger = 0; finger < 4; finger += 1) {
      const x = -0.024 + finger * 0.016;
      const fingerLength = [0.046, 0.055, 0.052, 0.039][finger];
      add(lower, ellipsoid(x, -0.393 - fingerLength / 2, -0.008,
        0.0085, fingerLength / 2, 0.010, 10), leather);
      add(lower, ellipsoid(x, -0.389, -0.018, 0.0085, 0.014, 0.009, 10), rubber);
      add(lower, tube([[x - 0.005, -0.406, -0.020], [x + 0.005, -0.406, -0.020]], 0.0012), seam);
    }
    add(lower, tube([[side * 0.032, -0.332, -0.015], [side * 0.045, -0.36, -0.027],
      [side * 0.044, -0.386, -0.021]], 0.010, 4), leather);
    wingBadge(lower, add, silver, accent, 0, -0.333, -0.039, 0.42);
    arms.push({ upper, lower, side });

    const thigh = new Group();
    thigh.name = `${side < 0 ? "left" : "right"}-hip`;
    thigh.position.set(side * 0.125, -0.26, 0.004);
    body.add(thigh);
    add(thigh, loft([[0.030, 0.074, 0.085, 0], [-0.028, 0.093, 0.094, 0.013],
      [-0.10, 0.096, 0.092, 0.011], [-0.20, 0.083, 0.081, 0.010],
      [-0.30, 0.072, 0.073, 0.007], [-0.40, 0.063, 0.065, 0.003],
      [-0.45, 0.058, 0.061, 0]], 22, 0.065, side * 0.7), fabric);
    add(thigh, ribbon([[side * 0.085, -0.045, -0.024], [side * 0.093, -0.16, -0.025],
      [side * 0.078, -0.278, -0.024]], 0.015, [0, 0, 1]), accent);
    // Sewn thigh pockets and the diagonal seat harness are raised off the suit.
    add(thigh, loft([[-0.12, 0.011, 0.007, 0], [-0.24, 0.014, 0.020, 0],
      [-0.31, 0.012, 0.016, 0]], 12).translate(side * 0.087, 0, 0.016), webbing);
    add(thigh, tube([[side * 0.091, -0.13, -0.025], [side * 0.091, -0.24, -0.024],
      [side * 0.08, -0.30, -0.027]], 0.0025), seam);
    add(thigh, ribbon([[side * 0.064, 0.008, -0.043], [side * 0.030, -0.07, -0.085],
      [-side * 0.035, -0.13, -0.074], [-side * 0.077, -0.07, -0.017]], 0.026), webbing);
    buckle(thigh, add, silver, side * 0.010, -0.089, -0.091, 0.031, 0.040);
    const calf = new Group();
    calf.name = `${side < 0 ? "left" : "right"}-knee`;
    calf.position.y = -0.45;
    thigh.add(calf);
    add(calf, loft([[0.017, 0.060, 0.063, 0], [-0.030, 0.068, 0.069, -0.004],
      [-0.095, 0.067, 0.072, 0.008], [-0.17, 0.061, 0.067, 0.014],
      [-0.25, 0.054, 0.058, 0.010], [-0.34, 0.048, 0.049, 0.004],
      [-0.385, 0.046, 0.047, 0.004]], 22, 0.085, side), fabric);
    add(calf, ribbon([[side * 0.054, -0.021, -0.036], [side * 0.062, -0.074, -0.036],
      [side * 0.055, -0.174, -0.036], [side * 0.048, -0.275, -0.025],
      [side * 0.044, -0.365, -0.022]], 0.027, [0, 0, 1]), accent);
    add(calf, tube([[-0.044, -0.052, -0.051], [-0.012, -0.068, -0.071],
      [0.035, -0.056, -0.060]], 0.0033), seam);
    // Ankle has a tall leather cuff. The asymmetric loft extends the toe toward
    // -Z; the outsole is planar and exactly 0.53 below the knee anchor.
    const boot = new Group();
    boot.name = `${side < 0 ? "left" : "right"}-hiking-boot`;
    boot.position.y = -0.43;
    calf.add(boot);
    add(boot, loft([[-0.080, 0.070, 0.130, -0.045], [-0.054, 0.072, 0.137, -0.045],
      [-0.023, 0.068, 0.125, -0.040], [0.006, 0.061, 0.090, -0.018],
      [0.035, 0.054, 0.063, 0.002], [0.087, 0.054, 0.055, 0.004],
      [0.12, 0.051, 0.052, 0.004]], 24, 0.01), leather);
    add(boot, loft([[-0.10, 0.070, 0.132, -0.045], [-0.084, 0.075, 0.139, -0.045],
      [-0.068, 0.073, 0.136, -0.045]], 24), rubber);
    add(boot, loft([[-0.069, 0.073, 0.136, -0.045], [-0.059, 0.071, 0.132, -0.045]], 24), seam);
    // Toe cap, heel counter and tongue are rounded leather panels.
    add(boot, ellipsoid(0, -0.039, -0.138, 0.061, 0.024, 0.039), rubber);
    add(boot, ellipsoid(0, 0.006, 0.054, 0.050, 0.060, 0.014), rubber);
    add(boot, ribbon([[0, 0.103, -0.051], [0, 0.066, -0.059],
      [0, 0.020, -0.085], [0, -0.020, -0.124]], 0.042), webbing);
    for (const shoeSide of [-1, 1]) {
      add(boot, tube([[shoeSide * 0.057, 0.049, -0.014], [shoeSide * 0.067, -0.035, -0.061],
        [shoeSide * 0.060, -0.045, -0.127]], 0.0028), seam);
      add(boot, ribbon([[shoeSide * 0.057, 0.072, 0.012], [shoeSide * 0.060, 0.013, 0.034],
        [shoeSide * 0.070, -0.049, 0.009], [shoeSide * 0.068, -0.051, -0.062]],
      0.009, [0, 1, 0]), accent);
      for (let lug = 0; lug < 5; lug += 1) {
        add(boot, ellipsoid(shoeSide * 0.063, -0.087, -0.135 + lug * 0.052,
          0.013, 0.013, 0.012, 8), rubber);
      }
    }
    for (let row = 0; row < 5; row += 1) {
      const y = 0.087 - row * 0.023;
      const z = -0.058 - Math.max(0, row - 1) * 0.017;
      for (const shoeSide of [-1, 1]) {
        add(boot, ellipsoid(shoeSide * 0.024, y, z + 0.003, 0.0037, 0.0045, 0.0023, 8), silver);
      }
      add(boot, tube([[-0.024, y, z - 0.001], [0.022, y - 0.019, z - 0.010]], 0.0019), lace);
      add(boot, tube([[0.024, y, z - 0.001], [-0.022, y - 0.019, z - 0.010]], 0.0019), lace);
    }
    wingBadge(boot, add, silver, accent, 0, 0.101, -0.054, 0.45);
    legs.push({ upper: thigh, lower: calf, boot, side });
  }

  // Nothing below allocates during animation. Each moving joint retains only
  // one mesh per material, including all its stitching and curved hardware.
  for (const [group, materials] of batches) {
    for (const [material, geometries] of materials) {
      const merged = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      const mesh = new Mesh(merged, material);
      mesh.name = `${group.name}-${material === accent ? "accent-panels" : "surface"}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  const roleSurfaces = [accent].map(surface => ({
    surface,
    color: surface.color.getHex(),
    emissive: surface.emissive.getHex(),
    emissiveIntensity: surface.emissiveIntensity,
  }));
  pilot.userData.groundClearance = 0.32;
  pilot.userData.standingHeight = 1.91;
  pilot.userData.preserveMaterials = true;
  return { pilot, body, headGroup, arms, legs, riserAnchors, roleSurfaces, phase: 0 };
}
