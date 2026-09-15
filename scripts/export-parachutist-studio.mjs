// Export the actual game geometry and deterministic animation poses for Blender.
// Run after updating the runtime: node scripts/export-parachutist-studio.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Group } from 'three';
import { createParachutistCharacter } from '../src/game/parachutistCharacter.js';
import { createParachutistCanopy, updateParachutistSuspension } from '../src/game/parachutistCanopy.js';

const destination = resolve(process.argv[2] || '.local-baselines/parachutist-blender-2026-09-15/runtime-model.json');
const root = new Group();
const character = createParachutistCharacter();
const canopy = createParachutistCanopy(character);
root.add(character.pilot, canopy);
const objects = [];
root.traverse(object => objects.push(object));
const ids = new Map(objects.map((object, i) => [object, i]));
const vec = value => value.toArray();
const transform = object => ({ id: ids.get(object), position: vec(object.position),
  quaternion: vec(object.quaternion), scale: vec(object.scale), visible: object.visible,
  ...(object.morphTargetInfluences ? { morphTargetInfluences: [...object.morphTargetInfluences] } : {}) });
const packet = {
  fps: 30, coordinateSystem: 'THREE_Y_UP_FORWARD_NEG_Z',
  source: 'src/game/parachutistCharacter.js + parachutistCanopy.js + parachutistMotion.js',
  character: { pilot: ids.get(character.pilot), body: ids.get(character.body), head: ids.get(character.headGroup),
    canopy: ids.get(canopy),
    arms: character.arms.map(arm => Object.fromEntries(Object.entries(arm)
      .filter(([key]) => ['upper', 'lower', 'wrist', 'grip', 'side'].includes(key))
      .map(([key, value]) => [key, typeof value === 'number' ? value : ids.get(value)]))),
    legs: character.legs.map(leg => ({ side: leg.side, upper: ids.get(leg.upper), lower: ids.get(leg.lower), boot: ids.get(leg.boot) })) },
  nodes: objects.map(object => {
    const geometry = object.geometry;
    return { ...transform(object), name: object.name || `node-${ids.get(object)}`,
      parent: ids.get(object.parent) ?? null, type: object.type,
      ...(geometry ? { geometry: {
        position: Array.from(geometry.attributes.position.array),
        ...(geometry.attributes.normal ? { normal: Array.from(geometry.attributes.normal.array) } : {}),
        ...(geometry.attributes.uv ? { uv: Array.from(geometry.attributes.uv.array) } : {}),
        ...(geometry.index ? { index: Array.from(geometry.index.array) } : {}),
        groups: geometry.groups, morphTargetsRelative: geometry.morphTargetsRelative,
        morphTargets: (geometry.morphAttributes.position || []).map((attribute, i) => ({
          name: Object.entries(object.morphTargetDictionary || {}).find(([, index]) => index === i)?.[0] || `shape-${i}`,
          position: Array.from(attribute.array),
        })),
      }, materials: [object.material].flat().map(material => ({ name: material.name,
        color: material.color?.toArray() || [1, 1, 1], roughness: material.roughness ?? .8,
        metalness: material.metalness ?? 0, opacity: material.opacity, doubleSided: material.side === 2,
        emissive: material.emissive?.toArray(), emissiveIntensity: material.emissiveIntensity,
        textureKind: material.name === 'parachutist-face' ? 'face'
          : material.name.startsWith('parachutist-suit') ? 'nylon' : null,
      })) } : {}),
    };
  }), clips: [],
};

if (!process.argv.includes('--geometry-only')) {
  const { sampleParachutistPose, applyParachutistPose, parachutistGait } = await import('../src/game/parachutistMotion.js');
  const joints = objects.filter(object => !object.geometry || object.morphTargetInfluences
    || object.name === 'Red brake toggle');
  const dynamic = objects.filter(object => ['Branched suspension and brake lines', 'Four load-bearing webbing risers'].includes(object.name));
  const definitions = [
    { name: '01_Idle', duration: 2, loop: true, state: 'grounded', speed: 0, cycles: 1 },
    { name: '02_Walk', duration: 2 / parachutistGait(2.5).cadence, loop: true, state: 'grounded', speed: 2.5, cycles: 2 },
    { name: '03_Run', duration: 2 / parachutistGait(4.8).cadence, loop: true, state: 'grounded', speed: 4.8, cycles: 2 },
    { name: '04_Flight', duration: 3, loop: false, state: 'airborne', speed: 10.5, cycles: 1 },
    { name: '05_Pull_Left', duration: 2.5, state: 'airborne', speed: 10.5, steering: -1 },
    { name: '06_Pull_Right', duration: 2.5, state: 'airborne', speed: 10.5, steering: 1 },
    { name: '07_Flare_Both_Hands', duration: 2.5, state: 'airborne', speed: 6.7, brake: 1 },
    { name: '08_Soft_Landing', duration: 2, state: 'grounded', speed: 0, landingImpact: 1.5 },
    { name: '09_Hard_Landing', duration: 2, state: 'grounded', speed: 0, landingImpact: 6 },
  ];
  let start = 1;
  for (const definition of definitions) {
    const count = Math.round(definition.duration * packet.fps);
    const clip = { ...definition, start, end: start + count, frames: [] };
    for (let i = 0; i <= count; i++) {
      const time = i / packet.fps;
      const envelope = Math.sin(Math.PI * i / count) ** 2;
      const options = { ...definition, time, phase: (definition.cycles || 1) * Math.PI * 2 * i / count,
        steering: (definition.steering || 0) * envelope, brake: (definition.brake || 0) * envelope,
        landingTime: definition.landingImpact ? time : -1 };
      // Ground loops also close the tiny head stabilization channel exactly.
      if (definition.loop) options.time = Math.PI * 2 / 1.5 * i / count;
      const pose = sampleParachutistPose(options);
      applyParachutistPose(character, pose);
      canopy.visible = definition.state !== 'grounded';
      updateParachutistSuspension(canopy);
      root.updateMatrixWorld(true);
      clip.frames.push({ frame: start + i, pose, nodes: joints.map(transform),
        dynamic: dynamic.map(object => ({ id: ids.get(object), position: Array.from(object.geometry.attributes.position.array) })) });
    }
    packet.clips.push(clip);
    start = clip.end + 12;
  }
}
mkdirSync(resolve(destination, '..'), { recursive: true });
writeFileSync(destination, JSON.stringify(packet));
console.log(JSON.stringify({ destination, nodes: packet.nodes.length, clips: packet.clips.map(({ name, start, end }) => ({ name, start, end })), bytes: JSON.stringify(packet).length }));
