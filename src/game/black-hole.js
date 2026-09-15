import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";

// The lensing integrator and thin-disk profile follow the MIT-licensed
// Adriwin06/black-hole and oseiskar/black-hole projects. This compact port is
// tailored to the simulator's existing Three.js scene and adaptive renderer.
const relativeCamera = new Vector3();

export function createRelativisticBlackHole(body, { raySteps = 64 } = {}) {
  const root = new Group();
  root.name = body.name;
  root.position.set(...body.position);
  root.userData.body = body;

  const eventHorizon = new Mesh(
    new SphereGeometry(body.radius, 56, 32),
    new MeshBasicMaterial({ color: 0x000000 }),
  );
  eventHorizon.name = "Event horizon";
  root.add(eventHorizon);

  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uInclination: { value: 0.22 },
      uProximity: { value: 0 },
    },
    defines: { RAY_STEPS: Math.max(32, Math.min(80, Math.round(raySteps))) },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uInclination;
      uniform float uProximity;

      const float PI = 3.141592653589793;
      const float TAU = 6.283185307179586;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 345.45));
        p += dot(p, p + 34.345);
        return fract(p.x * p.y);
      }

      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
      }

      float fbm(vec2 p) {
        float sum = 0.0;
        float amp = 0.52;
        for (int i = 0; i < 4; i++) {
          sum += valueNoise(p) * amp;
          p = mat2(1.62, 1.18, -1.18, 1.62) * p + 7.13;
          amp *= 0.48;
        }
        return sum;
      }

      vec2 rotate2(vec2 p, float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat2(c, -s, s, c) * p;
      }

      // Schwarzschild null geodesics in geometrized units (r_s = 1):
      // u'' = -u + 1.5u^2. Leapfrog integration preserves the orbit well
      // enough for a real-time photon ring while keeping the shader practical.
      float traceSchwarzschild(float impact, out float captured) {
        float u = 0.001;
        float du = 1.0 / max(impact, 0.04);
        float phi = 0.0;
        float stepSize = TAU * 2.0 / float(RAY_STEPS);
        captured = 0.0;
        for (int i = 0; i < RAY_STEPS; i++) {
          float accel = -u + 1.5 * u * u;
          du += 0.5 * accel * stepSize;
          u += du * stepSize;
          du += 0.5 * (-u + 1.5 * u * u) * stepSize;
          phi += stepSize;
          if (u >= 1.0) {
            captured = 1.0;
            break;
          }
          if (phi > 1.0 && u <= 0.0) break;
        }
        return max(0.0, phi - PI);
      }

      vec3 diskColour(float radius, float angle, float turbulence) {
        float innerEdge = max(1.0 - sqrt(3.05 / max(radius, 3.06)), 0.02);
        float temperature = pow(3.05 / max(radius, 3.05), 0.75) * pow(innerEdge, 0.25);
        float approaching = 0.5 + 0.5 * cos(angle + 0.22);
        float doppler = pow(clamp(0.42 + 1.33 * approaching, 0.22, 1.8), 2.35);
        vec3 receding = vec3(1.0, 0.105, 0.012);
        vec3 thermal = vec3(1.0, 0.49, 0.095);
        vec3 approachingHot = vec3(0.83, 0.93, 1.0);
        vec3 colour = mix(receding, thermal, smoothstep(0.0, 0.72, temperature));
        colour = mix(colour, approachingHot, pow(approaching, 4.0) * temperature * 0.72);
        float gravitationalShift = sqrt(max(1.0 - 1.0 / max(radius, 1.001), 0.025));
        return colour * doppler * gravitationalShift * (0.72 + turbulence * 1.5);
      }

      void main() {
        vec2 p = (vUv - 0.5) * 16.0;
        float impact = length(p);
        if (impact > 7.92) discard;

        float captured;
        float deflection = traceSchwarzschild(impact, captured);
        float angle = atan(p.y, p.x);
        float flatten = mix(0.17, 0.92, smoothstep(0.0, 1.0, uInclination));
        vec2 diskP = vec2(p.x, p.y / flatten);
        float diskRadius = length(diskP);
        float diskAngle = atan(diskP.y, diskP.x);

        float radialMask = smoothstep(3.02, 3.18, diskRadius) * (1.0 - smoothstep(6.55, 7.35, diskRadius));
        float flow = fbm(vec2(diskRadius * 2.15, diskAngle * 4.2 - uTime * (0.7 + 5.2 / max(diskRadius, 3.0))));
        float filaments = 0.54 + 0.46 * sin(diskAngle * 17.0 - uTime * 2.1 + flow * 8.0 + log(max(diskRadius, 1.0)) * 18.0);
        float diskEmission = radialMask * (0.45 + 0.55 * filaments) * (0.62 + flow * 0.78);
        vec3 disk = diskColour(diskRadius, diskAngle, flow) * diskEmission * 2.15;

        // Secondary lensed image and photon ring wrap the far side of the disk
        // over and under the shadow. Their width grows near the critical orbit.
        float photonRing = exp(-abs(impact - 2.60) * 24.0);
        float secondaryRadius = 2.82 + 0.18 * sin(angle * 2.0 + 0.35);
        float secondary = exp(-abs(impact - secondaryRadius) * 8.5);
        secondary *= 0.38 + 0.62 * smoothstep(0.08, 0.72, abs(sin(angle)));
        float secondaryFlow = fbm(vec2(angle * 5.0 - uTime * 0.7, impact * 11.0));
        vec3 lensedDisk = diskColour(3.15 + abs(sin(angle)) * 1.8, angle, secondaryFlow)
          * secondary * (1.1 + uProximity * 0.65);

        // The escaping ray direction is rotated by the integrated bend angle,
        // producing a moving Einstein-ring star field without a remote texture.
        vec2 lensed = rotate2(normalize(p) * (impact + deflection * 0.42), deflection * 0.28);
        vec2 starCell = floor(lensed * 6.0 + 31.7);
        float starSeed = hash21(starCell);
        float star = smoothstep(0.994, 1.0, starSeed);
        star *= exp(-12.0 * length(fract(lensed * 6.0 + 31.7) - 0.5));
        star *= 0.22 + min(deflection, 5.0) * 0.18;
        vec3 starColour = mix(vec3(0.42, 0.62, 1.0), vec3(1.0, 0.76, 0.47), hash21(starCell + 9.4));

        float horizon = 1.0 - smoothstep(2.54, 2.62, impact);
        float ringGlow = photonRing * (2.2 + 1.5 * uProximity);
        vec3 colour = disk + lensedDisk + starColour * star + vec3(1.0, 0.72, 0.39) * ringGlow;
        if (captured > 0.5 || horizon > 0.5) colour *= 1.0 - horizon;

        float emissionAlpha = clamp(max(max(diskEmission, secondary * 0.86), max(photonRing, star * 1.4)), 0.0, 1.0);
        float alpha = max(horizon, emissionAlpha);
        alpha *= 1.0 - smoothstep(7.35, 7.92, impact);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(colour, alpha);
      }
    `,
  });

  const lensPlane = new Mesh(
    new PlaneGeometry(body.radius * 16, body.radius * 16),
    material,
  );
  lensPlane.name = "Schwarzschild ray-traced lens and accretion disk";
  lensPlane.renderOrder = 12;
  lensPlane.frustumCulled = false;
  root.add(lensPlane);

  root.userData.update = (elapsed, cameraPosition, proximity = 0) => {
    material.uniforms.uTime.value = elapsed;
    material.uniforms.uProximity.value = proximity;
    if (!cameraPosition) return;
    lensPlane.lookAt(cameraPosition);
    relativeCamera.copy(cameraPosition).sub(root.position);
    const length = Math.max(1e-5, relativeCamera.length());
    material.uniforms.uInclination.value = Math.abs(relativeCamera.y) / length;
  };
  root.userData.raySteps = material.defines.RAY_STEPS;
  return root;
}
