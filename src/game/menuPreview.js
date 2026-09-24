import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  Box3,
  Vector3,
  Group,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { applyRotorState, spinRotors } from "./rotors.js";
import { disposeModel } from "./dispose.js";

// karuzela pojazdów w menu — jeden duży podgląd, strzałki przełączają model
export function createCarousel(canvas, items, opts = {}) {
  if (opts.lite) {
    return {
      show() {},
      resize() {},
      setActive() {},
      dispose() {},
      get currentKey() {
        return null;
      },
    };
  }

  const renderer = new WebGLRenderer({
    canvas,
    antialias: !opts.mobile,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, opts.mobile ? 1 : 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  scene.add(new HemisphereLight(0xcfe0f0, 0x5a7048, 1.25));
  const key = new DirectionalLight(0xfff2dd, 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new DirectionalLight(0x9fc4ff, 0.9);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  const camera = new PerspectiveCamera(30, 2, 0.1, 300);

  const loader = new GLTFLoader();
  const models = new Map(); // key -> { group, wingspan }
  const requested = new Set();
  const itemsByKey = new Map(items.map(item => [item.key, item]));
  let current = null; // { group, wingspan, slideX }
  let currentKey = null;
  let wantedKey = items[0].key;
  let active = true;
  let disposed = false;
  let lastFrameTime = 0;

  function resize() {
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 340;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (current) frame(current.wingspan, models.get(currentKey)?.item);
  }

  function frame(wingspan, item = null) {
    const distance = item?.previewDistance ?? 1.75;
    const height = item?.previewHeight ?? 0.42;
    camera.position.set(0, wingspan * height, wingspan * distance);
    camera.lookAt(0, item?.previewTargetY ?? 0, 0);
  }

  function show(keyName, dir = 0) {
    wantedKey = keyName;
    const item = itemsByKey.get(keyName);
    if (item) ensureLoaded(item);
    const entry = models.get(keyName);
    if (current) scene.remove(current.group);
    if (!entry) {
      current = null;
      currentKey = null;
      return;
    }
    current = { group: entry.group, wingspan: entry.wingspan, slideX: dir * entry.wingspan * 1.4 };
    currentKey = keyName;
    scene.add(entry.group);
    frame(entry.wingspan, entry.item);
  }

  function ensureLoaded(item) {
    if (requested.has(item.key) || disposed) return;
    requested.add(item.key);
    const register = (model) => {
      if (disposed) {
        disposeModel(model);
        return;
      }
      if (item.prepare) item.prepare(model); // np. poza czarownicy + miotła
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());
      model.scale.setScalar(item.wingspan / (item.spanAxis === "x"
        ? size.x : Math.max(size.x, size.y, size.z)));
      box.setFromObject(model);
      model.position.sub(box.getCenter(new Vector3()));
      model.traverse((o) => {
        if (o.isMesh && o.material && !item.preserveMaterials) {
          o.material.metalness = 0.15;
          o.material.roughness = 0.65;
        }
      });
      const group = new Group();
      group.add(model);
      if (!model.userData.customProp) applyRotorState(group, true);
      const previous = models.get(item.key);
      const replaceVisible = currentKey === item.key;
      if (previous) disposeModel(previous.group);
      models.set(item.key, { group, wingspan: item.wingspan, item });
      if (item.key === wantedKey && (replaceVisible || currentKey !== wantedKey)) show(item.key);
    };
    if (item.procedural) register(item.build());
    else {
      if (item.fallback) register(item.fallback());
      loader.load(
        item.file,
        (gltf) => {
          try {
            register(item.build ? item.build(gltf) : gltf.scene);
          } catch (error) {
            disposeModel(gltf.scene);
            console.warn(`Could not prepare ${item.key} preview; keeping the local fallback.`, error);
          }
        },
        undefined,
        (error) => console.warn(`Could not load ${item.key} preview; keeping the local fallback.`, error),
      );
    }
  }

  function tick() {
    if (disposed) return;
    requestAnimationFrame(tick);
    if (!active || !current) return;
    const t = performance.now() * 0.001;
    const dt = lastFrameTime ? Math.min(0.05, t - lastFrameTime) : 1 / 60;
    lastFrameTime = t;
    // wjazd z boku po przełączeniu + powolny obrót pokazowy
    current.slideX *= 0.86;
    current.group.position.x = current.slideX;
    const item = items.find((entry) => entry.key === currentKey);
    current.group.rotation.y = item?.previewYaw == null
      ? t * 0.45
      : item.previewYaw + Math.sin(t * 0.45) * (item.previewSweep ?? 0.28);
    current.group.rotation.z = Math.sin(t * 0.6) * 0.05;
    if (item?.update) item.update(current.group.children[0] || current.group, 1 / 60);
    spinRotors(current.group, dt, item?.cruise || 140);
    renderer.render(scene, camera);
  }
  tick();
  resize();
  show(items[0].key);
  window.addEventListener("resize", resize);

  function dispose() {
    disposed = true;
    active = false;
    for (const { group } of models.values()) disposeModel(group);
    models.clear();
    try {
      renderer.dispose();
      const gl = renderer.getContext();
      const ext = gl && gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    } catch {
      /* ignore */
    }
    current = null;
  }

  return {
    show,
    resize,
    dispose,
    get currentKey() {
      return currentKey;
    },
    setActive(v) {
      active = v;
      if (v) resize();
    },
  };
}
