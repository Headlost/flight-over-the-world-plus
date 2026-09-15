const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrap(value, size) {
  return ((value % size) + size) % size;
}

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function rgba(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * A deterministic 2D projection of an impossible, repeating 3D structure.
 * It deliberately uses Canvas rather than a second WebGL context so the effect
 * stays light enough to run while the Three.js world is still being rendered.
 */
export class TesseractTransit {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext?.("2d", { alpha: false }) || null;
    this.active = false;
    this.startedAt = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
    this.phase = "idle";
    this.phaseStartedAt = 0;
    this.phaseDurationMs = 1000;
    this.viewYaw = 0;
    this.viewPitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.pointer = null;
    this.random = mulberry32(0x7e55e4ac);
    this.dust = Array.from({ length: 150 }, () => ({
      x: (this.random() - 0.5) * 23,
      y: (this.random() - 0.5) * 14,
      z: 2 + this.random() * 58,
      size: 0.25 + this.random() * 1.5,
      cyan: this.random() > 0.82,
      phase: this.random() * TAU,
    }));
    this.resize = this.resize.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    globalThis.addEventListener?.("resize", this.resize, { passive: true });
    this.canvas?.addEventListener("pointerdown", this.onPointerDown);
    this.canvas?.addEventListener("pointermove", this.onPointerMove);
    this.canvas?.addEventListener("pointerup", this.onPointerUp);
    this.canvas?.addEventListener("pointercancel", this.onPointerUp);
  }

  start(now = performance.now(), phase = "approach", durationMs = 1000) {
    this.active = true;
    this.startedAt = now;
    this.phaseStartedAt = now;
    this.phase = phase;
    this.phaseDurationMs = Math.max(1, durationMs);
    this.viewYaw = 0;
    this.viewPitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.resize();
    this.render(now);
  }

  setPhase(phase, now = performance.now(), durationMs = 1000) {
    this.phase = phase;
    this.phaseStartedAt = now;
    this.phaseDurationMs = Math.max(1, durationMs);
  }

  stop() {
    this.active = false;
    this.phase = "idle";
    if (this.ctx && this.width && this.height) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.fillStyle = "#020303";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  onPointerDown(event) {
    if (!this.active || this.phase !== "transit") return;
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.pointer || event.pointerId !== this.pointer.id) return;
    const dx = event.clientX - this.pointer.x;
    const dy = event.clientY - this.pointer.y;
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    this.targetYaw += dx * 0.0062;
    this.targetPitch = clamp(this.targetPitch + dy * 0.0045, -1.12, 1.12);
  }

  onPointerUp(event) {
    if (!this.pointer || event.pointerId !== this.pointer.id) return;
    this.canvas.releasePointerCapture?.(event.pointerId);
    this.pointer = null;
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || globalThis.innerWidth || 1));
    const height = Math.max(1, Math.round(rect.height || globalThis.innerHeight || 1));
    const dpr = Math.min(globalThis.devicePixelRatio || 1, width < 760 ? 1.25 : 1.6);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  cameraAt(time) {
    const motion = this.reducedMotion ? 0.28 : 1;
    return {
      cx: this.width * (0.5 + Math.sin(time * 0.29) * 0.038 * motion + Math.sin(time * 0.73) * 0.012 * motion),
      cy: this.height * (0.5 + Math.cos(time * 0.37) * 0.034 * motion),
      roll: (Math.sin(time * 0.23) * 0.12 + Math.sin(time * 0.61) * 0.035) * motion,
      yaw: this.viewYaw,
      pitch: this.viewPitch,
      focal: Math.min(this.width, this.height) * 0.86,
    };
  }

  project(x, y, z, camera) {
    const cy = Math.cos(camera.yaw);
    const sy = Math.sin(camera.yaw);
    const cp = Math.cos(camera.pitch);
    const sp = Math.sin(camera.pitch);
    const yawX = x * cy - z * sy;
    const yawZ = x * sy + z * cy;
    const pitchY = y * cp - yawZ * sp;
    const pitchZ = y * sp + yawZ * cp;
    if (pitchZ <= 0.24) return null;
    const scale = camera.focal / pitchZ;
    const cos = Math.cos(camera.roll);
    const sin = Math.sin(camera.roll);
    const rx = yawX * cos - pitchY * sin;
    const ry = yawX * sin + pitchY * cos;
    return { x: camera.cx + rx * scale, y: camera.cy + ry * scale, scale, z: pitchZ };
  }

  pathOffset(z, time) {
    const bend = 1 - clamp((z - 2) / 52, 0, 1);
    return {
      x: (Math.sin(time * 0.41 + z * 0.12) * 0.36 + Math.sin(time * 0.17) * 0.22) * bend,
      y: (Math.cos(time * 0.33 + z * 0.1) * 0.25) * bend,
    };
  }

  orientedPortalPoints(axis, depth, centerA, centerB, half, camera) {
    const point = (a, b) => {
      if (axis === "x") return this.project(depth, centerA + a, centerB + b, camera);
      if (axis === "y") return this.project(centerA + a, depth, centerB + b, camera);
      return this.project(centerA + a, centerB + b, depth, camera);
    };
    return [point(-half, -half), point(half, -half), point(half, half), point(-half, half)];
  }

  drawAmbientPortal(axis, depth, centerA, centerB, half, camera, opacity, cyan = false) {
    const points = this.orientedPortalPoints(axis, depth, centerA, centerB, half, camera);
    if (!points.every(Boolean)) return;
    const scale = Math.min(...points.map((point) => point.scale));
    const beam = clamp(scale * 0.12, 1.2, 13);
    this.strokePath(points, "rgba(1, 3, 4, .9)", beam * 2.15, 0, true);
    this.strokePath(points, rgba(cyan ? "#50cbd6" : "#98602f", opacity), beam, 7 * opacity, true);
    this.strokePath(points, rgba(cyan ? "#8bf5f7" : "#ffd083", opacity * 0.82), clamp(beam * 0.14, 0.55, 2), 12 * opacity, true);
  }

  drawSurroundingStructure(camera, time, speed) {
    // Portal planes on all four walls keep the structure readable through a
    // full 360-degree look, not only while facing the flight direction.
    const span = 72;
    for (let i = 0; i < 18; i++) {
      const z = -18 + wrap(i * 4.5 - time * speed, span);
      const opacity = clamp(0.82 - Math.abs(z) / 105, 0.16, 0.76);
      this.drawAmbientPortal("x", -8.7, 0, z, 3.55, camera, opacity, i % 5 === 0);
      this.drawAmbientPortal("x", 8.7, 0, z + 1.2, 3.55, camera, opacity, i % 5 === 2);
      this.drawAmbientPortal("y", -7.2, 0, z + 0.5, 3.2, camera, opacity * 0.84, i % 6 === 0);
      this.drawAmbientPortal("y", 7.2, 0, z - 0.7, 3.2, camera, opacity * 0.84, i % 6 === 3);
    }
    // A second corridor behind the traveller completes the panorama.
    for (let i = 0; i < 8; i++) {
      const z = -(3 + wrap(i * 5.8 + time * speed * 0.32, 48));
      this.drawAmbientPortal("z", z, 0, 0, 5.5, camera, 0.28 + i * 0.025, i % 4 === 0);
    }
  }

  portalPoints(z, half, camera, time, offsetX = 0, offsetY = 0) {
    const path = this.pathOffset(z, time);
    const ox = offsetX + path.x;
    const oy = offsetY + path.y;
    return [
      this.project(ox - half, oy - half, z, camera),
      this.project(ox + half, oy - half, z, camera),
      this.project(ox + half, oy + half, z, camera),
      this.project(ox - half, oy + half, z, camera),
    ];
  }

  strokePath(points, colour, width, glow = 0, close = false) {
    if (!points?.every(Boolean)) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    if (close) ctx.closePath();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.shadowColor = colour;
    ctx.shadowBlur = glow;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  drawPortal(z, half, camera, time, opacity = 1, offsetX = 0, offsetY = 0) {
    const points = this.portalPoints(z, half, camera, time, offsetX, offsetY);
    if (!points.every(Boolean)) return;
    const scale = points[0].scale;
    const beam = clamp(scale * 0.18, 2.2, 24);
    const gold = rgba("#ffbd66", opacity);
    const darkGold = rgba("#5b381c", opacity * 0.95);

    this.strokePath(points, "rgba(2, 5, 6, .96)", beam * 1.9, 0, true);
    this.strokePath(points, darkGold, beam, 8 * opacity, true);
    this.strokePath(points, gold, clamp(beam * 0.15, 0.8, 3.2), 16 * opacity, true);

    // Nested metal channels turn each simple square into a modular frame.
    for (const inset of [0.82, 0.69]) {
      const inner = this.portalPoints(z + 0.02, half * inset, camera, time, offsetX, offsetY);
      this.strokePath(inner, rgba(inset > 0.75 ? "#b97938" : "#65dce6", opacity * (inset > 0.75 ? 0.66 : 0.72)), clamp(beam * 0.11, 0.6, 2), inset > 0.75 ? 7 : 12, true);
    }

    // Mechanical clamps and cold emissive strips punctuate the warm frame.
    for (let edge = 0; edge < 4; edge++) {
      const a = points[edge];
      const b = points[(edge + 1) % 4];
      for (const ratio of [0.22, 0.78]) {
        const x = a.x + (b.x - a.x) * ratio;
        const y = a.y + (b.y - a.y) * ratio;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        const span = clamp(scale * 0.42, 2, 28);
        this.strokePath([
          { x: x - dx / length * span, y: y - dy / length * span },
          { x: x + dx / length * span, y: y + dy / length * span },
        ], rgba(edge % 2 ? "#ffdc93" : "#6be8ef", opacity * 0.92), clamp(beam * 0.13, 0.7, 2.6), 13 * opacity);
      }
    }
  }

  drawConnectors(nearZ, farZ, half, camera, time, opacity) {
    const near = this.portalPoints(nearZ, half, camera, time);
    const far = this.portalPoints(farZ, half, camera, time);
    if (!near.every(Boolean) || !far.every(Boolean)) return;
    for (let corner = 0; corner < 4; corner++) {
      this.strokePath([far[corner], near[corner]], rgba("#96602e", opacity * 0.74), clamp(near[corner].scale * 0.1, 0.8, 10), 5 * opacity);
      this.strokePath([far[corner], near[corner]], rgba(corner % 3 === 0 ? "#5ddde8" : "#ffc878", opacity * 0.62), clamp(near[corner].scale * 0.018, 0.45, 1.8), 10 * opacity);
    }
  }

  drawSideCells(z, camera, time, opacity, index) {
    if (index % 3 !== 1) return;
    const side = index % 2 ? 1 : -1;
    const vertical = index % 4 < 2 ? 1 : -1;
    const cells = [
      [side * 10.8, vertical * 1.8, 3.4],
      [-side * 7.2, -vertical * 9.1, 3.0],
      [side * 4.6, vertical * 9.6, 2.55],
    ];
    for (let i = 0; i < cells.length; i++) {
      const [x, y, half] = cells[i];
      const cellOpacity = opacity * (0.34 + i * 0.1);
      this.drawPortal(z + i * 0.7, half, camera, time, cellOpacity, x, y);
      if (i === 0) this.drawPortal(z + 2.2, half * 0.72, camera, time, cellOpacity * 0.72, x, y);
    }
  }

  drawDust(camera, time, speed) {
    const ctx = this.ctx;
    for (const particle of this.dust) {
      const z = 1.1 + wrap(particle.z - time * speed, 58);
      const pulse = 0.55 + Math.sin(time * 2.4 + particle.phase) * 0.35;
      const point = this.project(particle.x, particle.y, z, camera);
      const previous = this.project(particle.x, particle.y, z + Math.min(2.8, speed * 0.11), camera);
      if (!point || !previous) continue;
      const alpha = clamp((1 - z / 59) * pulse, 0.05, 0.85);
      const colour = particle.cyan ? rgba("#8cf6ff", alpha) : rgba("#ffd58a", alpha);
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(point.x, point.y);
      ctx.strokeStyle = colour;
      ctx.lineWidth = clamp(particle.size * point.scale * 0.065, 0.45, 3.2);
      ctx.shadowColor = colour;
      ctx.shadowBlur = 7;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  drawLightPulse(camera, time) {
    const cycle = wrap(time * 0.36, 1);
    const radius = Math.min(this.width, this.height) * (0.04 + cycle * 0.68);
    const alpha = Math.sin(cycle * Math.PI) * 0.22;
    const gradient = this.ctx.createRadialGradient(camera.cx, camera.cy, 0, camera.cx, camera.cy, radius);
    gradient.addColorStop(0, `rgba(255, 240, 204, ${alpha * 0.72})`);
    gradient.addColorStop(0.08, `rgba(255, 190, 91, ${alpha})`);
    gradient.addColorStop(0.2, `rgba(92, 226, 238, ${alpha * 0.28})`);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  drawApproach(now) {
    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
    const age = Math.max(0, (now - this.phaseStartedAt) / 1000);
    const duration = Math.max(0.1, this.phaseDurationMs / 1000);
    const progress = clamp(age / duration, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    const cx = width * 0.5 + Math.sin(age * 2.1) * width * 0.006 * (1 - eased);
    const cy = height * 0.5 + Math.cos(age * 1.7) * height * 0.005 * (1 - eased);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    const radius = Math.max(1.5, Math.min(width, height) * (0.0015 + Math.pow(eased, 3.1) * 0.64));
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.9);
    glow.addColorStop(0, "rgba(255,255,244,1)");
    glow.addColorStop(0.025, "rgba(255,225,164,.98)");
    glow.addColorStop(0.11, "rgba(255,172,72,.78)");
    glow.addColorStop(0.34, "rgba(78,221,232,.24)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius * 2, cy - radius * 2, radius * 4, radius * 4);

    const rings = 3 + Math.floor(progress * 8);
    for (let i = rings; i >= 0; i--) {
      const ringRadius = radius * (0.16 + i * 0.105);
      ctx.strokeStyle = rgba(i % 4 === 0 ? "#76edf2" : "#ffc877", clamp(progress * 0.72 - i * 0.035, 0.04, 0.62));
      ctx.lineWidth = clamp(radius * 0.014, 0.65, 4);
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 18;
      ctx.strokeRect(cx - ringRadius, cy - ringRadius, ringRadius * 2, ringRadius * 2);
    }
    ctx.shadowBlur = 0;

    if (progress > 0.78) {
      const flash = Math.pow((progress - 0.78) / 0.22, 3);
      ctx.fillStyle = `rgba(255, 238, 202, ${flash * 0.92})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  drawVoid(now) {
    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
    const age = Math.max(0, (now - this.phaseStartedAt) / 1000);
    const cx = width * 0.5 + Math.sin(age * 0.37) * width * 0.014;
    const cy = height * 0.5 + Math.cos(age * 0.29) * height * 0.012;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    const pulse = 0.5 + 0.5 * Math.sin(age * 0.9);
    const radius = Math.min(width, height) * (0.035 + pulse * 0.012);
    const lens = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 6.5);
    lens.addColorStop(0, "rgba(0,0,0,1)");
    lens.addColorStop(0.38, "rgba(0,0,0,1)");
    lens.addColorStop(0.46, "rgba(95,128,155,.09)");
    lens.addColorStop(0.5, "rgba(224,233,238,.055)");
    lens.addColorStop(0.58, "rgba(0,0,0,1)");
    lens.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = lens;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(184, 205, 220, .075)";
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 24; i++) {
      const angle = i / 24 * TAU + age * 0.025;
      const inner = radius * (1.8 + (i % 3) * 0.45);
      const outer = Math.max(width, height) * (0.55 + (i % 5) * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle + 0.015) * outer, cy + Math.sin(angle + 0.015) * outer);
      ctx.stroke();
    }
  }

  render(now = performance.now()) {
    if (!this.active || !this.ctx) return;
    this.resize();
    if (this.phase === "void") {
      this.drawVoid(now);
      return;
    }
    if (this.phase === "approach") {
      this.drawApproach(now);
      return;
    }
    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
    const time = Math.max(0, (now - this.phaseStartedAt) / 1000);
    const speed = this.reducedMotion ? 4.2 : 11.5;
    this.viewYaw += (this.targetYaw - this.viewYaw) * 0.16;
    this.viewPitch += (this.targetPitch - this.viewPitch) * 0.16;
    const camera = this.cameraAt(time);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const background = ctx.createRadialGradient(camera.cx, camera.cy, 0, camera.cx, camera.cy, Math.max(width, height) * 0.72);
    background.addColorStop(0, "#26170b");
    background.addColorStop(0.16, "#100d09");
    background.addColorStop(0.48, "#030708");
    background.addColorStop(1, "#000203");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    this.drawSurroundingStructure(camera, time, speed);

    // Repeating rings move from the vanishing point past the viewer. Drawing
    // far-to-near gives proper visual stacking without a depth buffer.
    const spacing = 4.4;
    const range = 57.2;
    const portals = [];
    for (let i = 0; i < 14; i++) {
      portals.push({ z: 1.4 + wrap(i * spacing - time * speed, range), index: i });
    }
    portals.sort((a, b) => b.z - a.z);
    for (const portal of portals) {
      const opacity = clamp(1.08 - portal.z / 66, 0.16, 0.94);
      const farZ = portal.z + spacing * 0.88;
      if (farZ < 59) this.drawConnectors(portal.z, farZ, 5.65, camera, time, opacity);
      this.drawSideCells(portal.z, camera, time, opacity, portal.index);
      this.drawPortal(portal.z, 5.65, camera, time, opacity);
    }

    this.drawDust(camera, time, speed);
    this.drawLightPulse(camera, time);

    if (time < 0.72) {
      const flash = Math.pow(1 - time / 0.72, 2.4);
      ctx.fillStyle = `rgba(255, 239, 207, ${flash})`;
      ctx.fillRect(0, 0, width, height);
    }

    // Glass panels, scanlines and a dense vignette bring the projection closer
    // to the dark polished material language of the reference imagery.
    const glass = ctx.createLinearGradient(0, 0, width, height);
    glass.addColorStop(0, "rgba(82, 224, 234, .055)");
    glass.addColorStop(0.34, "rgba(0, 0, 0, 0)");
    glass.addColorStop(0.68, "rgba(255, 183, 79, .045)");
    glass.addColorStop(1, "rgba(0, 0, 0, .18)");
    ctx.fillStyle = glass;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(255, 214, 147, .028)";
    for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1);

    const vignette = ctx.createRadialGradient(width * 0.5, height * 0.5, Math.min(width, height) * 0.14, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.68, "rgba(0, 0, 0, .08)");
    vignette.addColorStop(1, "rgba(0, 0, 0, .88)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }
}
