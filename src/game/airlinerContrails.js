import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';

const LIFE_SECONDS = 12;
const MAX_EMITTERS = 4;
const NO_OPTIONS = Object.freeze({});

/** Long-lived but bounded condensation trails from an airliner's actual engine outlets. */
export class AirlinerContrails {
  constructor(scene, { mobile = false } = NO_OPTIONS) {
    this.cap = mobile ? 2048 : 3584;
    // A two-engine jet needs closer-spaced samples to read as continuous
    // ribbons at 800+ km/h. Four-engine aircraft already overlap enough at
    // the lower rate, avoiding a broad merged haze under their wings.
    this._twoEngineInterval = 1 / (mobile ? 80 : 100);
    this._fourEngineInterval = 1 / (mobile ? 40 : 70);
    this._world = new Float64Array(this.cap * 3);
    this._ages = new Float32Array(this.cap);
    this._seeds = new Float32Array(this.cap);
    this._strengths = new Float32Array(this.cap);
    this._positions = new Float32Array(this.cap * 3);
    this._drawAges = new Float32Array(this.cap);
    this._drawSeeds = new Float32Array(this.cap);
    this._drawStrengths = new Float32Array(this.cap);
    this._previousEmitters = new Float64Array(MAX_EMITTERS * 3);
    this._currentEmitters = new Float64Array(MAX_EMITTERS * 3);
    this._origin = new Vector3();
    this._emitterPosition = new Vector3();
    this._backward = new Vector3();
    this._up = new Vector3();
    this._cursor = 0;
    this._carry = 0;
    this._lastModel = null;
    this._hasPreviousEmitters = false;
    this._debug = { count: 0, cap: this.cap, emitterCount: 0, lifeSeconds: LIFE_SECONDS };
    this._ages.fill(LIFE_SECONDS);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this._positions, 3).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute('aAge', new BufferAttribute(this._drawAges, 1).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute('aSeed', new BufferAttribute(this._drawSeeds, 1).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute('aStrength', new BufferAttribute(this._drawStrengths, 1).setUsage(DynamicDrawUsage));
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
        attribute float aStrength;
        uniform float uViewportHeight;
        varying float vAlpha;
        varying float vSeed;
        void main() {
          float ageFraction = clamp(aAge / 12.0, 0.0, 1.0);
          // Adjacent puffs overlap even at high airliner speeds to read as a stripe.
          float radius = mix(2.3, 4.0, pow(ageFraction, 0.7))
            * mix(0.85, 1.15, clamp(aStrength, 0.0, 1.0));
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float distanceFromCamera = length(mvPosition.xyz);
          float nearFade = smoothstep(5.0, 15.0, distanceFromCamera);
          float birthFade = smoothstep(0.0, 0.1, aAge);
          vAlpha = 0.72 * birthFade * pow(1.0 - ageFraction, 0.52)
            * nearFade * mix(0.82, 1.0, clamp(aStrength, 0.0, 1.0));
          vSeed = aSeed;
          gl_Position = projectionMatrix * mvPosition;
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
          float radial = dot(p, p);
          if (radial >= 1.0) discard;
          float feather = pow(1.0 - radial, 1.25);
          float wisps = 0.88 + 0.12 * sin(p.x * 7.0 + vSeed * 10.0)
            * sin(p.y * 9.0 - vSeed * 8.0);
          float alpha = vAlpha * feather * wisps;
          if (alpha < 0.003) discard;
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(vec3(0.99, 0.995, 1.0), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.name = 'Airliner engine condensation trails';
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
    if (Number.isFinite(options.viewportHeight)) {
      this.material.uniforms.uViewportHeight.value = Math.max(1, Math.min(16384, options.viewportHeight));
    }

    // Keep emitted positions in double-precision world space. Only GPU offsets
    // are relative to the current aircraft; turns and translation never drag
    // already emitted trails along with it.
    for (let i = 0; i < this.cap; i++) {
      if (this._ages[i] < LIFE_SECONDS) this._ages[i] += elapsed;
    }

    const nozzles = model?.userData?.jetExhaust?.children;
    let emitterCount = 0;
    if (options.active && model?.visible && nozzles) {
      for (let i = 0; i < Math.min(MAX_EMITTERS, nozzles.length); i++) {
        const nozzle = nozzles[i];
        if (!nozzle?.isObject3D) continue;
        nozzle.getWorldPosition(this._emitterPosition);
        const offset = emitterCount * 3;
        this._currentEmitters[offset] = this._emitterPosition.x;
        this._currentEmitters[offset + 1] = this._emitterPosition.y;
        this._currentEmitters[offset + 2] = this._emitterPosition.z;
        emitterCount++;
      }
    }
    this._debug.emitterCount = emitterCount;

    if (emitterCount) {
      if (!this._hasPreviousEmitters || elapsed > 0.25) {
        this._previousEmitters.set(this._currentEmitters);
      }
      const matrix = model.matrixWorld.elements;
      this._backward.set(matrix[8], matrix[9], matrix[10]).normalize();
      this._up.copy(this._origin);
      if (this._up.lengthSq() > 1000000) this._up.normalize();
      else this._up.set(0, 1, 0);
      const speed = Number.isFinite(options.speed) ? Math.max(0, options.speed) : 0;
      const drift = 0.55 + Math.min(speed, 300) * 0.008;
      const strength = Number.isFinite(options.throttle)
        ? Math.max(0, Math.min(1, options.throttle)) : 1;
      // A restored background tab must not interpolate across a huge teleport
      // or emit seconds' worth of particles in a single frame.
      const emissionElapsed = elapsed > 0.25 ? 0 : Math.min(elapsed, 0.1);
      const interval = emitterCount <= 2 ? this._twoEngineInterval : this._fourEngineInterval;
      let sampleTime = interval - this._carry;
      this._carry += emissionElapsed;
      while (this._carry >= interval) {
        const fraction = emissionElapsed > 0 ? Math.min(1, sampleTime / emissionElapsed) : 1;
        const initialAge = Math.max(0, emissionElapsed - sampleTime);
        for (let emitter = 0; emitter < emitterCount; emitter++) {
          this._emit(emitter, fraction, initialAge, drift, strength);
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
      const target = count * 3;
      // Slow vertical widening gives an organic edge while keeping the ribbon
      // coherent. The random seed is stored per puff rather than per frame.
      const upwardDrift = age * (0.07 + this._seeds[i] * 0.08);
      this._positions[target] = this._world[offset] - this._origin.x + this._up.x * upwardDrift;
      this._positions[target + 1] = this._world[offset + 1] - this._origin.y + this._up.y * upwardDrift;
      this._positions[target + 2] = this._world[offset + 2] - this._origin.z + this._up.z * upwardDrift;
      this._drawAges[count] = age;
      this._drawSeeds[count] = this._seeds[i];
      this._drawStrengths[count] = this._strengths[i];
      count++;
    }
    this.geometry.setDrawRange(0, count);
    this.points.visible = count > 0;
    this._debug.count = count;
    if (count) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aAge.needsUpdate = true;
      this.geometry.attributes.aSeed.needsUpdate = true;
      this.geometry.attributes.aStrength.needsUpdate = true;
    }
  }

  _emit(emitter, fraction, initialAge, drift, strength) {
    const index = this._cursor;
    this._cursor = (index + 1) % this.cap;
    const offset = index * 3;
    const anchor = emitter * 3;
    this._ages[index] = initialAge;
    this._seeds[index] = Math.random();
    this._strengths[index] = strength;
    for (let axis = 0; axis < 3; axis++) {
      const exhaust = this._backward.getComponent(axis) * drift
        + this._up.getComponent(axis) * 0.09;
      this._world[offset + axis] = this._previousEmitters[anchor + axis]
        + (this._currentEmitters[anchor + axis] - this._previousEmitters[anchor + axis]) * fraction
        + exhaust * initialAge;
    }
  }

  clear() {
    this._ages.fill(LIFE_SECONDS);
    this._cursor = 0;
    this._carry = 0;
    this._lastModel = null;
    this._hasPreviousEmitters = false;
    this.geometry.setDrawRange(0, 0);
    this.points.visible = false;
    this._debug.count = 0;
    this._debug.emitterCount = 0;
  }

  debug() { return this._debug; }

  dispose() {
    this.clear();
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
