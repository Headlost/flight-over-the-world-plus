import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";

const LIFE_SECONDS = 3;
const MAX_POINT_SIZE = 80;
const NO_OPTIONS = Object.freeze({});

/** A bounded, single-draw-call pair of aerobatic smoke trails. */
export class AerobaticSmoke {
  constructor(scene, { mobile = false } = NO_OPTIONS) {
    this.cap = mobile ? 384 : 640;
    this._emissionInterval = 1 / (mobile ? 60 : 90);
    this._world = new Float64Array(this.cap * 3);
    this._velocity = new Float64Array(this.cap * 3);
    this._basis = new Float32Array(this.cap * 6);
    this._ages = new Float32Array(this.cap);
    this._seeds = new Float32Array(this.cap);
    this._positions = new Float32Array(this.cap * 3);
    this._drawAges = new Float32Array(this.cap);
    this._drawSeeds = new Float32Array(this.cap);
    this._previousEmitters = new Float64Array(6);
    this._currentEmitters = new Float64Array(6);
    this._origin = new Vector3();
    this._emitterPosition = new Vector3();
    this._up = new Vector3();
    this._right = new Vector3();
    this._backward = new Vector3();
    this._cursor = 0;
    this._carry = 0;
    this._lastModel = null;
    this._hasPreviousEmitters = false;
    this._debug = {
      count: 0,
      cap: this.cap,
      emitterCount: 0,
      maxPointSize: MAX_POINT_SIZE,
      lifeSeconds: LIFE_SECONDS,
    };
    this._ages.fill(LIFE_SECONDS);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new BufferAttribute(this._positions, 3).setUsage(DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      "aAge",
      new BufferAttribute(this._drawAges, 1).setUsage(DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      "aSeed",
      new BufferAttribute(this._drawSeeds, 1).setUsage(DynamicDrawUsage),
    );
    this.geometry.setDrawRange(0, 0);

    this.material = new ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      fog: false,
      uniforms: { uViewportHeight: { value: 720 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float aAge;
        attribute float aSeed;
        uniform float uViewportHeight;
        varying float vAlpha;
        varying float vSeed;
        void main() {
          float ageFraction = clamp(aAge / 3.0, 0.0, 1.0);
          float radius = mix(0.18, 1.7, pow(ageFraction, 0.72));
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float cameraDistance = length(mvPosition.xyz);
          float nearFade = smoothstep(3.0, 8.0, cameraDistance);
          float birthFade = smoothstep(0.0, 0.07, aAge);
          vAlpha = 0.40 * birthFade * pow(1.0 - ageFraction, 0.9) * nearFade;
          vSeed = aSeed;
          gl_Position = projectionMatrix * mvPosition;
          // A puff must never become a full-screen sheet when crossing the camera.
          float projectedSize = radius * uViewportHeight * projectionMatrix[1][1]
            / max(1.0, -mvPosition.z);
          gl_PointSize = clamp(projectedSize, 1.0, 80.0);
          if (mvPosition.z >= -0.5) vAlpha = 0.0;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        varying float vAlpha;
        varying float vSeed;
        void main() {
          vec2 p = (gl_PointCoord - 0.5) * 2.0;
          float radiusSquared = dot(p, p);
          if (radiusSquared >= 1.0) discard;
          float feather = (1.0 - radiusSquared) * (1.0 - radiusSquared);
          float wisps = 0.78 + 0.22 * sin(p.x * 8.0 + vSeed * 11.0)
            * sin(p.y * 10.0 - vSeed * 7.0);
          float alpha = vAlpha * feather * wisps;
          if (alpha < 0.003) discard;
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(vec3(0.98, 0.99, 1.0), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.name = "Dziki dzik — twin aerobatic smoke";
    // Centers move every frame; the tiny bounded pool needs no bounding-sphere rebuild.
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  update(dt, model, options = NO_OPTIONS) {
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (model && model !== this._lastModel) {
      this.clear();
      this._lastModel = model;
    }
    if (model) {
      model.getWorldPosition(this._origin);
      this.points.position.copy(this._origin);
    }
    const viewportHeight = options.viewportHeight;
    if (Number.isFinite(viewportHeight)) {
      this.material.uniforms.uViewportHeight.value = Math.max(1, Math.min(16384, viewportHeight));
    }

    // Existing smoke keeps its world location while the aircraft turns or goes inverted.
    for (let i = 0; i < this.cap; i++) {
      if (this._ages[i] >= LIFE_SECONDS) continue;
      this._ages[i] += elapsed;
      if (this._ages[i] >= LIFE_SECONDS) continue;
      const offset = i * 3;
      this._world[offset] += this._velocity[offset] * elapsed;
      this._world[offset + 1] += this._velocity[offset + 1] * elapsed;
      this._world[offset + 2] += this._velocity[offset + 2] * elapsed;
    }

    const emitters = model?.userData?.smokeEmitters;
    let emitterCount = 0;
    if (options.active && emitters) {
      for (let i = 0; i < Math.min(2, emitters.length); i++) {
        const emitter = emitters[i];
        if (!emitter?.isObject3D) continue;
        emitter.getWorldPosition(this._emitterPosition);
        const offset = emitterCount * 3;
        this._currentEmitters[offset] = this._emitterPosition.x;
        this._currentEmitters[offset + 1] = this._emitterPosition.y;
        this._currentEmitters[offset + 2] = this._emitterPosition.z;
        emitterCount++;
      }
    }
    this._debug.emitterCount = emitterCount;

    if (emitterCount > 0) {
      if (!this._hasPreviousEmitters || elapsed > 0.25) {
        this._previousEmitters.set(this._currentEmitters);
      }
      this._up.copy(this._origin);
      if (this._up.lengthSq() > 1000000) this._up.normalize();
      else this._up.set(0, 1, 0);
      const matrix = model.matrixWorld.elements;
      this._right.set(matrix[0], matrix[1], matrix[2]).normalize();
      this._backward.set(matrix[8], matrix[9], matrix[10]).normalize();
      const speed = Number.isFinite(options.speed) ? Math.max(0, options.speed) : 0;
      const exhaustDrift = 0.28 + Math.min(speed, 180) * 0.003;
      // A returning background tab must not create a large catch-up emission burst.
      const emissionElapsed = Math.min(elapsed, 0.1);
      const oldCarry = this._carry;
      const interval = this._emissionInterval;
      let sampleTime = interval - oldCarry;
      this._carry += emissionElapsed;
      while (this._carry >= interval) {
        const fraction = emissionElapsed > 0 ? Math.min(1, sampleTime / emissionElapsed) : 1;
        const initialAge = Math.max(0, emissionElapsed - sampleTime);
        for (let emitter = 0; emitter < emitterCount; emitter++) {
          this._emit(emitter, fraction, initialAge, exhaustDrift);
        }
        this._carry -= interval;
        sampleTime += interval;
      }
      this._previousEmitters.set(this._currentEmitters);
      this._hasPreviousEmitters = true;
    } else {
      this._carry = 0;
      this._hasPreviousEmitters = false;
    }

    let count = 0;
    for (let i = 0; i < this.cap; i++) {
      const age = this._ages[i];
      if (age >= LIFE_SECONDS) continue;
      const offset = i * 3;
      const basis = i * 6;
      const seed = this._seeds[i];
      const sideSwirl = Math.sin(age * 5.3 + seed * Math.PI * 2) * 0.08;
      const upSwirl = Math.cos(age * 4.1 + seed * Math.PI * 2) * 0.055;
      const target = count * 3;
      // Double-precision world storage, single-precision GPU offsets near the plane.
      this._positions[target] = this._world[offset] - this._origin.x
        + this._basis[basis] * sideSwirl + this._basis[basis + 3] * upSwirl;
      this._positions[target + 1] = this._world[offset + 1] - this._origin.y
        + this._basis[basis + 1] * sideSwirl + this._basis[basis + 4] * upSwirl;
      this._positions[target + 2] = this._world[offset + 2] - this._origin.z
        + this._basis[basis + 2] * sideSwirl + this._basis[basis + 5] * upSwirl;
      this._drawAges[count] = age;
      this._drawSeeds[count] = seed;
      count++;
    }
    this.geometry.setDrawRange(0, count);
    this.points.visible = count > 0;
    this._debug.count = count;
    if (count > 0) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aAge.needsUpdate = true;
      this.geometry.attributes.aSeed.needsUpdate = true;
    }
  }

  _emit(emitter, fraction, initialAge, exhaustDrift) {
    const index = this._cursor;
    this._cursor = (index + 1) % this.cap;
    const offset = index * 3;
    const basis = index * 6;
    const anchor = emitter * 3;
    const seed = Math.random();
    const sideDrift = (seed - 0.5) * 0.12;
    this._seeds[index] = seed;
    this._ages[index] = initialAge;
    this._basis[basis] = this._right.x;
    this._basis[basis + 1] = this._right.y;
    this._basis[basis + 2] = this._right.z;
    this._basis[basis + 3] = this._up.x;
    this._basis[basis + 4] = this._up.y;
    this._basis[basis + 5] = this._up.z;
    this._velocity[offset] = this._up.x * 0.22 + this._right.x * sideDrift
      + this._backward.x * exhaustDrift;
    this._velocity[offset + 1] = this._up.y * 0.22 + this._right.y * sideDrift
      + this._backward.y * exhaustDrift;
    this._velocity[offset + 2] = this._up.z * 0.22 + this._right.z * sideDrift
      + this._backward.z * exhaustDrift;
    for (let axis = 0; axis < 3; axis++) {
      this._world[offset + axis] = this._previousEmitters[anchor + axis]
        + (this._currentEmitters[anchor + axis] - this._previousEmitters[anchor + axis]) * fraction
        + this._velocity[offset + axis] * initialAge;
    }
  }

  clear() {
    this._ages.fill(LIFE_SECONDS);
    this._carry = 0;
    this._cursor = 0;
    this._hasPreviousEmitters = false;
    this._lastModel = null;
    this.geometry.setDrawRange(0, 0);
    this.points.visible = false;
    this._debug.count = 0;
    this._debug.emitterCount = 0;
  }

  debug() {
    return this._debug;
  }

  dispose() {
    this.clear();
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
