"""Bring the source parachutist's splayed legs together without thinning them.

The original replacement GLB has boot centres at about +/-0.30 m. Moving each
leg 0.12 m toward the midline gives a grounded stance without scaling its boot,
calf or thigh cross-section. The previous global X scale made the limbs look
emaciated. This non-destructive studio source keeps the original alongside it.
It does not touch the separate canopy, risers, brake lines or their animations.

Usage:
  E:/blender.exe --background --factory-startup --python scripts/blender/repair_parachutist_body.py
"""
import bpy
import json
from collections import defaultdict
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'art/models/parachutist-body-original-2026-09-23.glb'
BLEND = ROOT / 'art/models/parachutist-body-corrected.blend'
OUTPUT = ROOT / 'public/models/parachutist-body.glb'
REPORT = ROOT / 'art/previews/parachutist-body-repair.json'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
if len(meshes) != 1:
    raise ValueError(f'Expected one body mesh, found {len(meshes)}')
body = meshes[0]
body.name = 'Parachutist | corrected anatomical bind pose'
group = body.vertex_groups.new(name='Grounded leg-stance correction')
inverse = body.matrix_world.inverted()
changed = 0
centre_guarded = 0
non_leg_vertices_changed = 0
glove_vertices_changed = 0
samples = {'before': [], 'after': []}
LEG_SHIFT = 0.12
MIN_CENTRE_CLEARANCE = 0.008

# The scan is thousands of overlapping garment islands. Their topology is
# useful for an audit but not an exhaustive anatomical selection: restricting
# motion to apparent leg islands leaves detached knee-pad and pocket fragments.
# Runtime masks the source's lowered arms and replaces them with articulated
# game-rig arms. A continuous below-waist field gives the intact visible body.
source_points = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
parent = list(range(len(source_points)))

def find(vertex):
    while parent[vertex] != vertex:
        parent[vertex] = parent[parent[vertex]]
        vertex = parent[vertex]
    return vertex

for polygon in body.data.polygons:
    first = find(polygon.vertices[0])
    for vertex in polygon.vertices[1:]:
        parent[find(vertex)] = first

components = defaultdict(list)
for vertex in range(len(source_points)):
    components[find(vertex)].append(vertex)

leg_components = set()
glove_components = set()
for component, vertices in components.items():
    xs = [source_points[vertex].x for vertex in vertices]
    ys = [source_points[vertex].y for vertex in vertices]
    zs = [source_points[vertex].z for vertex in vertices]
    wholly_one_leg = max(xs) < -0.02 or min(xs) > 0.02
    outer_x = max(abs(min(xs)), abs(max(xs)))
    lowered_glove = (min(zs) > 0.32 and max(zs) < 0.68
                     and outer_x > 0.25 and min(ys) > -0.06
                     and max(ys) > 0.11
                     and (max(xs) < -0.16 or min(xs) > 0.16))
    if lowered_glove:
        glove_components.add(component)
    # Boots/calves, free knee-pad islands, and the rear/core thigh shell.
    # Hands/sleeves at this height project farther forward and extend above
    # 0.45 m. The upper-thigh shell is accepted only behind the hand plane.
    lower_leg = min(zs) < 0.30
    knee_detail = min(zs) < 0.40 and max(zs) < 0.55
    upper_thigh_shell = min(zs) < 0.40 and max(ys) < 0.145
    if wholly_one_leg and not lowered_glove and max(zs) < 0.72 and (
            lower_leg or knee_detail or upper_thigh_shell):
        leg_components.add(component)
leg_component_vertices = sum(len(components[part]) for part in leg_components)

def smoothstep(value):
    t = min(1.0, max(0.0, value))
    return t * t * (3 - 2 * t)

for vertex in body.data.vertices:
    point = source_points[vertex.index].copy()
    if -0.35 < point.z < -0.15 and abs(point.x) > 0.01:
        samples['before'].append(abs(point.x))
    # The field is full at the boots, fades through the thigh and reaches zero
    # at the waist. Translating all overlapping low garment islands together
    # keeps knee guards, trousers and pockets joined in the final silhouette.
    weight = 1 - smoothstep((point.z + 0.08) / 0.72)
    if weight > 0:
        group.add([vertex.index], weight, 'REPLACE')
        proposed_shift = LEG_SHIFT * weight
        # A handful of central garment details are not part of either leg.
        # Keep them on their original side of the body instead of folding them
        # across the midline as the thigh correction fades into the pelvis.
        allowed_shift = max(0.0, abs(point.x) - MIN_CENTRE_CLEARANCE)
        actual_shift = min(proposed_shift, allowed_shift)
        if actual_shift < proposed_shift - 1e-6:
            centre_guarded += 1
        if actual_shift > 0:
            point.x -= (1 if point.x > 0 else -1) * actual_shift
            vertex.co = inverse @ point
            changed += 1
            component = find(vertex.index)
            if component not in leg_components:
                non_leg_vertices_changed += 1
            if component in glove_components:
                glove_vertices_changed += 1
    if -0.35 < point.z < -0.15 and abs(point.x) > 0.01:
        samples['after'].append(abs(point.x))

body.data.update()
for image in bpy.data.images:
    if image.source == 'FILE':
        image.pack()
notes = bpy.data.texts.new('READ ME | body correction')
notes.write('Original source: art/models/parachutist-body-original-2026-09-23.glb\n'
            'Continuous below-waist X translation preserves clothing/armor overlap.\n'
            'Source low gloves also move slightly; the game hides these faces and uses articulated arms.\n'
            'Above-waist coordinates, limb cross-sections, UVs and topology are unchanged.\n'
            'Original UV, texture, topology, materials and world-Y/world-Z unchanged.\n'
            'The full game rig and link mechanics remain in src/game/.\n')
body['source_glb'] = SOURCE.relative_to(ROOT).as_posix()
body['corrected_2026_09_24'] = 'Continuous low-body centre shift 0.12 m; original limb width retained'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True,
    export_animations=False, export_materials='EXPORT', export_normals=True,
    export_texcoords=True)

def quantile(values, fraction):
    values.sort()
    return round(values[min(len(values) - 1, int(fraction * len(values)))], 4)

report = {'source': SOURCE.relative_to(ROOT).as_posix(),
          'blend': BLEND.relative_to(ROOT).as_posix(),
          'output': OUTPUT.relative_to(ROOT).as_posix(),
          'verticesChanged': changed,
          'verticesUnchanged': len(source_points) - changed,
          'sourceComponents': len(components),
          'estimatedLegComponents': len(leg_components),
          'estimatedLegComponentVertices': leg_component_vertices,
          'otherLowerGarmentVerticesChanged': non_leg_vertices_changed,
          'sourceGloveVerticesChanged': glove_vertices_changed,
          'centreGuardedVertices': centre_guarded,
          'legShiftMetres': LEG_SHIFT,
          'bootX05Before': quantile(samples['before'], .05),
          'bootXMedianBefore': quantile(samples['before'], .5),
          'bootX95Before': quantile(samples['before'], .95),
          'bootX05After': quantile(samples['after'], .05),
          'bootXMedianAfter': quantile(samples['after'], .5),
          'bootX95After': quantile(samples['after'], .95),
          'outputBytes': OUTPUT.stat().st_size}
REPORT.write_text(json.dumps(report, indent=2), encoding='utf-8')
print('PARACHUTIST_REPAIR=' + json.dumps(report))
