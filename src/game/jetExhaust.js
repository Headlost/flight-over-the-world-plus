import {
  AdditiveBlending, BufferGeometry, CircleGeometry, DoubleSide,
  Float32BufferAttribute, Group, Mesh, ShaderMaterial,
} from 'three';

// Measured from the two eight-sided exhaust openings in public/models/jet.glb.
// These are GLB-local coordinates: the source nose points +Z. Parenting the
// effect to the model preserves prepareJet's turn, centering and uniform scale.
const NOZZLE_X = [-0.708985, 0.708979];
const NOZZLE_Y = 0.08542;
const NOZZLE_Z = -4.953342;
const OPENING_RADIUS = 0.15033;

const flameVertex = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vView = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const flameFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  uniform float uPower;
  uniform float uCore;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    #include <logdepthbuf_fragment>
    float axial = vUv.y;
    float flow = 0.88 + 0.12 * sin(axial * 28.0 - uTime * 42.0
      + 0.65 * sin(vUv.x * 18.8496 + uTime * 7.0));
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float edge = smoothstep(0.0, 0.52, facing);
    float tail = 1.0 - smoothstep(0.3, 1.0, axial);
    float entry = mix(0.65, 1.0, smoothstep(0.0, 0.06, axial));
    vec3 blue = mix(vec3(0.22, 0.3, 1.0), vec3(0.5, 0.8, 1.0), uCore);
    vec3 amber = mix(vec3(1.0, 0.23, 0.025), vec3(1.0, 0.78, 0.3), uCore);
    vec3 color = mix(blue, amber, smoothstep(0.12, 0.66, axial));
    float alpha = tail * entry * edge * flow * (0.5 + uPower * 0.32)
      * mix(0.68, 1.0, uCore);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

const glowFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  uniform float uPower;
  varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    float radius = length(vUv * 2.0 - 1.0);
    float alpha = (1.0 - smoothstep(0.2, 1.0, radius))
      * (0.62 + 0.28 * uPower) * (0.96 + 0.04 * sin(uTime * 53.0));
    vec3 color = mix(vec3(0.68, 0.84, 1.0), vec3(0.3, 0.28, 1.0), radius);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

function flameGeometry() {
  const profile = [1, 1.02, 1.08, 0.97, 0.78, 0.59, 0.38, 0.18, 0.005];
  const radialSegments = 12;
  const positions = [], uv = [], indices = [];
  for (let ring = 0; ring < profile.length; ring++) {
    const t = ring / (profile.length - 1);
    for (let segment = 0; segment <= radialSegments; segment++) {
      const angle = segment / radialSegments * Math.PI * 2;
      positions.push(Math.cos(angle) * profile[ring], Math.sin(angle) * profile[ring], -t);
      uv.push(segment / radialSegments, t);
      if (ring < profile.length - 1 && segment < radialSegments) {
        const a = ring * (radialSegments + 1) + segment;
        const b = a + radialSegments + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function material(uniforms, fragmentShader) {
  return new ShaderMaterial({
    uniforms, vertexShader: flameVertex, fragmentShader,
    transparent: true, blending: AdditiveBlending,
    depthTest: true, depthWrite: false, toneMapped: false,
    side: DoubleSide, forceSinglePass: true,
  });
}

/** Attach only to the fighter GLB after its normal prepare/normalize step. */
export function attachJetExhaust(root, model) {
  if (!root?.isObject3D || !model?.isObject3D) return null;
  if (root.userData.jetExhaust) return root.userData.jetExhaust;
  const exhaust = new Group();
  exhaust.name = 'fighter-jet-exhaust';
  exhaust.visible = false;
  const time = { value: 0 }, power = { value: 0 };
  const shellMaterial = material({ uTime: time, uPower: power, uCore: { value: 0 } }, flameFragment);
  const coreMaterial = material({ uTime: time, uPower: power, uCore: { value: 1 } }, flameFragment);
  const glowMaterial = material({ uTime: time, uPower: power }, glowFragment);
  // Shared within this aircraft only, so the usual disposeModel traversal
  // releases each resource once without affecting another player's aircraft.
  const shape = flameGeometry();
  const disk = new CircleGeometry(OPENING_RADIUS * 0.98, 20);
  const flames = [];
  for (let side = 0; side < NOZZLE_X.length; side++) {
    const nozzle = new Group();
    nozzle.name = `fighter-exhaust-nozzle-${side + 1}`;
    nozzle.position.set(NOZZLE_X[side], NOZZLE_Y, NOZZLE_Z - 0.004);
    const shell = new Mesh(shape, shellMaterial);
    shell.name = 'exhaust-blue-amber-envelope';
    shell.scale.set(OPENING_RADIUS * 0.88, OPENING_RADIUS * 0.88, 0.42);
    const core = new Mesh(shape, coreMaterial);
    core.name = 'exhaust-bright-core';
    core.scale.set(OPENING_RADIUS * 0.88 * 0.53, OPENING_RADIUS * 0.88 * 0.53, 0.42 * 0.78);
    const glow = new Mesh(disk, glowMaterial);
    glow.name = 'exhaust-nozzle-glow';
    glow.position.z = -0.002;
    // Exhaust is translucent decoration, never terrain/camera collision data.
    shell.raycast = core.raycast = glow.raycast = () => {};
    nozzle.add(shell, core, glow);
    exhaust.add(nozzle);
    flames.push(shell, core);
  }
  exhaust.userData.flames = flames;
  exhaust.userData.time = time;
  exhaust.userData.power = power;
  model.add(exhaust);
  root.userData.jetExhaust = exhaust;
  updateJetExhaust(root, false, 0, 0);
  return exhaust;
}

/** Mutates only existing uniforms/scales; no particles or per-frame objects. */
export function updateJetExhaust(root, active, throttle = 0, elapsed = 0) {
  const exhaust = root?.userData?.jetExhaust;
  if (!exhaust) return;
  exhaust.visible = Boolean(active && root.visible);
  if (!exhaust.visible) return;
  const power = Number.isFinite(throttle) ? Math.max(0, Math.min(1, throttle)) : 0;
  // Keep shader time small enough for Float32 precision in long sessions.
  const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) % (Math.PI * 2 * 100) : 0;
  exhaust.userData.time.value = time;
  exhaust.userData.power.value = power;
  const flames = exhaust.userData.flames;
  for (let side = 0; side < 2; side++) {
    const flicker = 1 + Math.sin(time * 47 + side * 1.7) * 0.035
      + Math.sin(time * 71 + side * 2.3) * 0.015;
    const length = (0.42 + power * 0.82) * flicker;
    const radius = OPENING_RADIUS * (0.88 + power * 0.1);
    flames[side * 2].scale.set(radius, radius, length);
    flames[side * 2 + 1].scale.set(radius * 0.53, radius * 0.53, length * 0.78);
  }
}
