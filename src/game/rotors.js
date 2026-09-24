import {
  Box3, CanvasTexture, CircleGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Shape, SphereGeometry,
  SRGBColorSpace, Vector3,
} from "three";

let blurTexture;
function propBlurTexture() {
  if (blurTexture) return blurTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 8, 128, 128, 126);
  gradient.addColorStop(0, "rgba(22, 24, 28, 0.12)");
  gradient.addColorStop(0.72, "rgba(67, 72, 79, 0.22)");
  gradient.addColorStop(1, "rgba(67, 72, 79, 0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(128, 128, 126, 0, Math.PI * 2);
  context.fill();
  blurTexture = new CanvasTexture(canvas);
  blurTexture.colorSpace = SRGBColorSpace;
  blurTexture.userData.sharedModelTexture = true;
  return blurTexture;
}

const nameOf = object => (object.name || "").toLowerCase();

function rotorId(object, vehicle) {
  if (!object.isMesh) return null;
  const name = nameOf(object);
  if (vehicle === "ac130") {
    // Four real blade groups and hubs were retained during OBJ -> GLB import.
    // The source's helice1..4 meshes are tiny cockpit indicators.
    // GLTFLoader strips punctuation from Blender names: pal1.003 -> pal1003.
    const match = /^(?:pal[1-4]|bol)(\d{3})?_/.exec(name);
    return match ? `ac130-${match[1] || "0"}` : null;
  }
  if (vehicle === "mooney") return name.startsWith("helice_") ? "mooney" : null;
  if (/^(?:propl|propr)$/.test(name) || name.includes("propeller")
      || name.includes("fanslow") || /(^|_)rotor($|_)/.test(name)) {
    return name;
  }
  return null;
}

function makeRotor(root, parts, id) {
  root.updateMatrixWorld(true);
  const hub = parts.find(part => nameOf(part).startsWith("bol")) || parts[0];
  const centre = new Box3().setFromObject(hub).getCenter(new Vector3());
  root.worldToLocal(centre);
  const allParts = new Box3();
  for (const part of parts) allParts.expandByObject(part);
  const size = allParts.getSize(new Vector3());
  const radius = Math.max(size.x, size.y) * 0.5;
  if (!(radius > 0.1)) return null;

  const holder = new Group();
  holder.name = `spinning-propeller-${id}`;
  holder.position.copy(centre);
  root.add(holder);
  root.updateMatrixWorld(true);
  // attach preserves each baked mesh's world position. Moving the parent
  // thereafter rotates every blade about its own engine, never the fuselage.
  for (const part of parts) {
    holder.attach(part);
    part.userData.spinHolder = holder;
    part.visible = true;
  }
  if (typeof document !== "undefined") {
    const disc = new Mesh(
      new CircleGeometry(radius * 0.98, 40),
      new MeshBasicMaterial({
        map: propBlurTexture(), transparent: true, opacity: 0.15,
        side: DoubleSide, depthWrite: false,
      }),
    );
    disc.name = "propeller-motion-blur";
    disc.raycast = () => {};
    disc.position.z = 0.05;
    holder.add(disc);
    holder.userData.blur = disc;
  }
  holder.userData.radius = radius;
  holder.userData.parts = parts;
  return holder;
}

function makeLocatorRotor(root, marker) {
  root.updateMatrixWorld(true);
  const centre = marker.getWorldPosition(new Vector3());
  root.worldToLocal(centre);
  const rootScale = root.getWorldScale(new Vector3());
  const markerScale = marker.getWorldScale(new Vector3());
  const radius = Number(marker.userData.radius) * markerScale.x / rootScale.x;
  if (!Number.isFinite(radius) || radius <= 0) return null;

  const holder = new Group();
  holder.name = `spinning-propeller-${marker.name}`;
  holder.position.copy(centre);
  const shape = new Shape();
  shape.moveTo(-radius * 0.09, radius * 0.12);
  shape.lineTo(-radius * 0.105, radius * 0.34);
  shape.quadraticCurveTo(-radius * 0.16, radius * 0.77, -radius * 0.07, radius * 0.98);
  shape.quadraticCurveTo(radius * 0.055, radius * 1.01, radius * 0.09, radius * 0.88);
  shape.quadraticCurveTo(radius * 0.12, radius * 0.58, radius * 0.085, radius * 0.30);
  shape.lineTo(radius * 0.08, radius * 0.12);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: radius * 0.022, bevelEnabled: false, curveSegments: 4 });
  const material = new MeshStandardMaterial({ color: 0x20242a, metalness: 0.43, roughness: 0.4 });
  const parts = [];
  const bladeCount = Math.max(2, Math.min(8, Number(marker.userData.blades) || 4));
  for (let i = 0; i < bladeCount; i++) {
    const blade = new Mesh(geometry, material);
    blade.name = `${marker.name}-blade-${i + 1}`;
    blade.rotation.z = i * Math.PI * 2 / bladeCount;
    blade.position.z = -radius * 0.085;
    holder.add(blade);
    parts.push(blade);
  }
  const spinner = new Mesh(new SphereGeometry(radius * 0.16, 16, 10),
    new MeshStandardMaterial({ color: 0x363b43, metalness: 0.48, roughness: 0.35 }));
  spinner.name = `${marker.name}-spinner`;
  spinner.scale.z = 1.3;
  spinner.position.z = -radius * 0.045;
  holder.add(spinner);
  parts.push(spinner);
  if (typeof document !== "undefined") {
    const disc = new Mesh(new CircleGeometry(radius * 0.98, 40),
      new MeshBasicMaterial({ map: propBlurTexture(), transparent: true,
        opacity: 0.15, side: DoubleSide, depthWrite: false }));
    disc.name = "propeller-motion-blur";
    disc.raycast = () => {};
    disc.position.z = -radius * 0.10;
    holder.add(disc);
    holder.userData.blur = disc;
  }
  holder.userData.radius = radius;
  holder.userData.parts = parts;
  root.add(holder);
  return holder;
}

/** Imported blades remain visible and rotate; the subtle disc only adds blur. */
export function applyRotorState(root, flying) {
  if (!root) return;
  const existing = root.userData.spinRotors;
  if (existing?.length) {
    for (const holder of existing) {
      holder.rotation.z = flying ? holder.rotation.z : 0;
      if (holder.userData.blur) holder.userData.blur.visible = !!flying;
    }
    return;
  }
  if (!flying) return;
  const markers = [];
  root.traverse(object => {
    if (/^PROP_HUB_\d+$/.test(object.name)) markers.push(object);
  });
  if (markers.length) {
    root.userData.spinRotors = markers
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(marker => makeLocatorRotor(root, marker)).filter(Boolean);
    return;
  }
  const units = new Map();
  root.traverse(object => {
    const id = rotorId(object, root.userData.key);
    if (!id) return;
    if (!units.has(id)) units.set(id, []);
    units.get(id).push(object);
  });
  const holders = [];
  for (const [id, parts] of units) {
    const holder = makeRotor(root, parts, id);
    if (holder) holders.push(holder);
  }
  root.userData.spinRotors = holders;
}

export function spinRotors(root, dt, speed) {
  const holders = root?.userData?.spinRotors;
  if (!holders?.length || !Number.isFinite(dt) || dt <= 0) return;
  const radians = Math.max(9, Math.abs(Number(speed) || 0) * 0.25)
    * Math.min(dt, 0.05);
  for (const holder of holders) holder.rotation.z += radians;
}
