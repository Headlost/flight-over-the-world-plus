import {
  AdditiveBlending, Box3, BufferGeometry, CircleGeometry, DoubleSide,
  Float32BufferAttribute, Group, Mesh, ShaderMaterial, Vector3,
} from 'three';

// These GLBs arrive centred, metric and -Z-forward. Positions are measured
// from the actual aft outlets, rather than guessed from the aircraft tail.
function nozzleLayout(root, model, vehicle) {
  const markers = [];
  model.traverse(object => {
    if (/^EXHAUST_NOZZLE_\d+$/.test(object.name)) markers.push(object);
  });
  if (markers.length) {
    root.updateMatrixWorld(true);
    const rootScale = root.getWorldScale(new Vector3());
    const nozzles = markers
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(marker => {
        const position = marker.getWorldPosition(new Vector3());
        root.worldToLocal(position);
        const markerScale = marker.getWorldScale(new Vector3());
        return {
          x: position.x, y: position.y, z: position.z,
          radius: Number(marker.userData.radius) * markerScale.x / rootScale.x,
          height: Number(marker.userData.height) || 1,
        };
      }).filter(outlet => Number.isFinite(outlet.radius) && outlet.radius > 0);
    if (nozzles.length) {
      const radius = nozzles.reduce((sum, outlet) => sum + outlet.radius, 0) / nozzles.length;
      return {
        nozzles, radius,
        // The B-2 exhausts are recessed, shallow slots. Their blue light
        // should live inside the outlet instead of becoming a detached plume.
        lengthBase: radius * (vehicle === 'b2' ? 0.12 : 0.36),
        lengthGain: radius * (vehicle === 'b2' ? 0.20 : 0.66),
        opacity: vehicle === 'b2' ? 0.82 : 0.16,
        blueOnly: vehicle === 'b2',
      };
    }
  }
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const nozzle = (x, y, z, radius, height = 1) => ({ x, y, z, radius, height });
  if (vehicle === 'boeing737') return {
    nozzles: [-1, 1].map(side => nozzle(
      centre.x + side * size.x * 0.144, box.min.y + size.y * 0.087,
      centre.z - size.z * 0.065, size.y * 0.075)),
    lengthBase: 0.22, lengthGain: 0.36, opacity: 0.48,
  };
  if (vehicle === 'a380') return {
    nozzles: [-1, 1].flatMap(side => [
      nozzle(centre.x + side * size.x * 0.185, box.min.y + size.y * 0.13,
        centre.z - size.z * 0.103, size.y * 0.053),
      nozzle(centre.x + side * size.x * 0.3225, box.min.y + size.y * 0.15,
        centre.z - size.z * 0.007, size.y * 0.053),
    ]),
    lengthBase: 0.25, lengthGain: 0.42, opacity: 0.46,
  };
  if (vehicle === 'b2') return {
    nozzles: [-1, 1].map(side => nozzle(
      centre.x + side * size.x * 0.083, centre.y + size.y * 0.12,
      centre.z + size.z * 0.257, 1.12, 0.2)),
    lengthBase: 0.13, lengthGain: 0.21, opacity: 0.82, blueOnly: true,
  };
  const radius = Math.max(0.12, size.y * 0.11);
  return {
    nozzles: [-1, 1].map(side => nozzle(
      centre.x + side * size.x * 0.07, box.min.y + size.y * 0.30,
      box.max.z - size.z * 0.055, radius)),
    radius, lengthBase: 0.42, lengthGain: 0.82, opacity: 1,
  };
}

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
  uniform float uOpacity;
  uniform float uBlueOnly;
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
    vec3 color = mix(blue, amber, smoothstep(0.12, 0.66, axial) * (1.0 - uBlueOnly));
    float alpha = tail * entry * edge * flow * (0.5 + uPower * 0.32)
      * mix(0.68, 1.0, uCore) * uOpacity;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

const glowFragment = /* glsl */`
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  uniform float uPower;
  uniform float uOpacity;
  uniform float uBlueOnly;
  varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    float radius = length(vUv * 2.0 - 1.0);
    float alpha = (1.0 - smoothstep(0.2, 1.0, radius))
      * (0.62 + 0.28 * uPower) * (0.96 + 0.04 * sin(uTime * 53.0)) * uOpacity;
    vec3 whiteBlue = mix(vec3(0.68, 0.84, 1.0), vec3(0.3, 0.28, 1.0), radius);
    vec3 nozzleBlue = mix(vec3(0.18, 0.43, 1.0), vec3(0.07, 0.16, 0.82), radius);
    vec3 color = mix(whiteBlue, nozzleBlue, uBlueOnly);
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

/** Attach subtle exhaust to each real nozzle after normalizing the GLB. */
export function attachJetExhaust(root, model, vehicle = 'jet') {
  if (!root?.isObject3D || !model?.isObject3D) return null;
  if (root.userData.jetExhaust) return root.userData.jetExhaust;
  const exhaust = new Group();
  exhaust.name = `${vehicle}-jet-exhaust`;
  exhaust.visible = false;
  const time = { value: 0 }, power = { value: 0 };
  const layout = nozzleLayout(root, model, vehicle);
  const opacity = { value: layout.opacity }, blueOnly = { value: layout.blueOnly ? 1 : 0 };
  const glowOpacity = { value: vehicle === 'jet' || layout.blueOnly
    ? layout.opacity : layout.opacity * 0.12 };
  const shellMaterial = material({ uTime: time, uPower: power, uCore: { value: 0 }, uOpacity: opacity, uBlueOnly: blueOnly }, flameFragment);
  const coreMaterial = material({ uTime: time, uPower: power, uCore: { value: 1 }, uOpacity: opacity, uBlueOnly: blueOnly }, flameFragment);
  const glowMaterial = material({ uTime: time, uPower: power, uOpacity: glowOpacity,
    uBlueOnly: blueOnly }, glowFragment);
  // Shared within this aircraft only, so the usual disposeModel traversal
  // releases each resource once without affecting another player's aircraft.
  const shape = flameGeometry();
  const disk = new CircleGeometry(1, 20);
  const flames = [];
  const flameNozzles = [];
  for (let side = 0; side < layout.nozzles.length; side++) {
    const outlet = layout.nozzles[side];
    const nozzle = new Group();
    nozzle.name = `${vehicle}-exhaust-nozzle-${side + 1}`;
    nozzle.position.set(outlet.x, outlet.y, outlet.z);
    nozzle.rotation.y = Math.PI;
    const shell = new Mesh(shape, shellMaterial);
    shell.name = 'exhaust-blue-amber-envelope';
    shell.scale.set(outlet.radius * 0.88, outlet.radius * outlet.height * 0.88, layout.lengthBase);
    const core = new Mesh(shape, coreMaterial);
    core.name = 'exhaust-bright-core';
    core.scale.set(outlet.radius * 0.88 * 0.53, outlet.radius * outlet.height * 0.88 * 0.53, layout.lengthBase * 0.78);
    const glow = new Mesh(disk, glowMaterial);
    glow.name = 'exhaust-nozzle-glow';
    glow.position.z = -0.002;
    glow.scale.set(outlet.radius * 0.98, outlet.radius * outlet.height * 0.98, 1);
    // Exhaust is translucent decoration, never terrain/camera collision data.
    shell.raycast = core.raycast = glow.raycast = () => {};
    nozzle.add(shell, core, glow);
    exhaust.add(nozzle);
    flames.push(shell, core);
    flameNozzles.push({ shell, core, ...outlet });
  }
  exhaust.userData.flames = flames;
  exhaust.userData.flameNozzles = flameNozzles;
  exhaust.userData.layout = layout;
  exhaust.userData.time = time;
  exhaust.userData.power = power;
  exhaust.userData.radius = layout.radius;
  root.add(exhaust);
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
  for (let side = 0; side < exhaust.userData.flameNozzles.length; side++) {
    const outlet = exhaust.userData.flameNozzles[side];
    const flicker = 1 + Math.sin(time * 47 + side * 1.7) * 0.035
      + Math.sin(time * 71 + side * 2.3) * 0.015;
    const length = (exhaust.userData.layout.lengthBase
      + power * exhaust.userData.layout.lengthGain) * flicker;
    const radius = outlet.radius * (0.88 + power * 0.1);
    outlet.shell.scale.set(radius, radius * outlet.height, length);
    outlet.core.scale.set(radius * 0.53, radius * outlet.height * 0.53, length * 0.78);
  }
}
