"""Build the editable parachutist studio from the actual game geometry and clips.

Usage (Blender 4.4+):
  blender --background --factory-startup --python scripts/blender/build_parachutist_studio.py

Run `node scripts/export-parachutist-studio.mjs` first.  This script writes a new
studio; it never opens or overwrites the user's original open Blender scene.
"""
import bpy
import json
import math
import os
from pathlib import Path
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
PACKET = ROOT / '.local-baselines/parachutist-blender-2026-09-15/runtime-model.json'
DESTINATION = ROOT / 'art/models/parachutist-studio.blend'
PREVIEWS = ROOT / 'art/previews'
data = json.loads(PACKET.read_text(encoding='utf-8'))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.name = 'PARACHUTIST | Animation Studio'
scene.render.fps = data['fps']
scene.frame_start = 1
scene.frame_end = max([clip['end'] for clip in data['clips']] or [90])
C = Matrix.Rotation(math.pi / 2, 4, 'X')  # THREE Y-up, -Z front => Blender Z-up, +Y front.
L = Matrix.Rotation(-math.pi / 2, 4, 'X')  # Recovered Vanguard has negative Y-up.


def collection(name):
    coll = bpy.data.collections.new(name)
    scene.collection.children.link(coll)
    return coll


def move_to(obj, coll):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    coll.objects.link(obj)


runtime_coll = collection('01 | GAME PILOT - articulated suit and canopy')
legacy_coll = collection('02 | VANGUARD - recovered 49 bone skin')
stage_coll = collection('03 | STUDIO - lights cameras and captions')
material_cache = {}


def material(item):
    key = json.dumps(item, sort_keys=True)
    if key in material_cache:
        return material_cache[key]
    mat = bpy.data.materials.new(item.get('name') or 'Pilot material')
    mat.diffuse_color = (*item['color'], item.get('opacity', 1))
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = mat.diffuse_color
    shader.inputs['Roughness'].default_value = item.get('roughness', .7)
    shader.inputs['Metallic'].default_value = item.get('metalness', 0)
    shader.inputs['Alpha'].default_value = item.get('opacity', 1)
    if item.get('emissive'):
        shader.inputs['Emission Color'].default_value = (*item['emissive'], 1)
        shader.inputs['Emission Strength'].default_value = item.get('emissiveIntensity', 0)
    kind = item.get('textureKind')
    if kind:
        path = ROOT / f'public/textures/parachutist/{kind}-albedo.png'
        if path.exists():
            texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
            texture.image = bpy.data.images.load(str(path), check_existing=True)
            tint = mat.node_tree.nodes.new('ShaderNodeMixRGB')
            tint.blend_type = 'MULTIPLY'
            tint.inputs[0].default_value = 1
            tint.inputs[2].default_value = (*item['color'], 1)
            mat.node_tree.links.new(texture.outputs['Color'], tint.inputs[1])
            mat.node_tree.links.new(tint.outputs[0], shader.inputs['Base Color'])
    material_cache[key] = mat
    return mat


def trs(item):
    p = Vector(item.get('position', (0, 0, 0)))
    x, y, z, w = item.get('quaternion', (0, 0, 0, 1))
    q = Quaternion((w, x, y, z))
    s = item.get('scale', (1, 1, 1))
    return Matrix.LocRotScale(p, q, Vector(s))


def set_transform(obj, item, frame=None):
    obj.location = item.get('position', (0, 0, 0))
    x, y, z, w = item.get('quaternion', (0, 0, 0, 1))
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (w, x, y, z)
    obj.scale = item.get('scale', (1, 1, 1))
    if frame is not None:
        for prop in ('location', 'rotation_quaternion', 'scale'):
            obj.keyframe_insert(data_path=prop, frame=frame, group='Editable joint transforms')
    if obj.type == 'MESH' and obj.data.shape_keys:
        for index, value in enumerate(item.get('morphTargetInfluences', [])):
            shape = obj.data.shape_keys.key_blocks[index + 1]
            shape.value = value
            if frame is not None:
                shape.keyframe_insert(data_path='value', frame=frame)


runtime_basis = bpy.data.objects.new('GAME PILOT | Y-up to Z-up', None)
runtime_coll.objects.link(runtime_basis)
runtime_basis.matrix_world = Matrix.Translation(Vector((-2.2, 0, .35))) @ C
objects = {}
node_defs = {node['id']: node for node in data['nodes']}
for node in data['nodes']:
    geometry = node.get('geometry')
    mesh = None
    if geometry:
        mesh = bpy.data.meshes.new(node['name'] + ' geometry')
        positions = geometry['position']
        vertices = list(zip(positions[0::3], positions[1::3], positions[2::3]))
        indices = geometry.get('index') or list(range(len(vertices)))
        is_lines = node['type'] == 'LineSegments'
        faces = [] if is_lines else list(zip(indices[0::3], indices[1::3], indices[2::3]))
        edges = list(zip(indices[0::2], indices[1::2])) if is_lines else []
        mesh.from_pydata(vertices, edges, faces)
        mesh.update()
        if geometry.get('uv'):
            uv = geometry['uv']
            layer = mesh.uv_layers.new(name='Game UV')
            for loop in mesh.loops:
                index = loop.vertex_index * 2
                layer.data[loop.index].uv = uv[index:index + 2]
        for mat in node.get('materials', []):
            mesh.materials.append(material(mat))
        for group in geometry.get('groups', []):
            for index in range(group['start'] // 3, min(len(mesh.polygons), (group['start'] + group['count']) // 3)):
                mesh.polygons[index].material_index = group['materialIndex']
        for poly in mesh.polygons:
            poly.use_smooth = True
    obj = bpy.data.objects.new(node['name'], mesh)
    runtime_coll.objects.link(obj)
    objects[node['id']] = obj
    obj['game_node_id'] = node['id']
    if mesh and node['type'] == 'LineSegments':
        # Keep editable edge vertices and dynamic shape keys; generate real thin
        # round cords after deformation, rather than misreading segments as faces.
        tree = bpy.data.node_groups.new(node['name'] + ' | round cords', 'GeometryNodeTree')
        tree.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
        tree.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
        group_in = tree.nodes.new('NodeGroupInput')
        group_out = tree.nodes.new('NodeGroupOutput')
        curves = tree.nodes.new('GeometryNodeMeshToCurve')
        profile = tree.nodes.new('GeometryNodeCurvePrimitiveCircle')
        profile.inputs['Resolution'].default_value = 6
        profile.inputs['Radius'].default_value = .0015 if 'Stitched' in node['name'] else .0032
        sweep = tree.nodes.new('GeometryNodeCurveToMesh')
        assign = tree.nodes.new('GeometryNodeSetMaterial')
        assign.inputs['Material'].default_value = mesh.materials[0] if mesh.materials else None
        tree.links.new(group_in.outputs['Geometry'], curves.inputs['Mesh'])
        tree.links.new(curves.outputs['Curve'], sweep.inputs['Curve'])
        tree.links.new(profile.outputs['Curve'], sweep.inputs['Profile Curve'])
        tree.links.new(sweep.outputs['Mesh'], assign.inputs['Geometry'])
        tree.links.new(assign.outputs['Geometry'], group_out.inputs['Geometry'])
        modifier = obj.modifiers.new('Round suspension / seam cords', 'NODES')
        modifier.node_group = tree
    if mesh and geometry.get('morphTargets'):
        obj.shape_key_add(name='Basis')
        for morph in geometry['morphTargets']:
            shape = obj.shape_key_add(name=morph['name'])
            arr = morph['position']
            for i, point in enumerate(shape.data):
                value = Vector(arr[i * 3:i * 3 + 3])
                point.co = mesh.vertices[i].co + value if geometry.get('morphTargetsRelative') else value
    set_transform(obj, node)
    if not mesh:
        obj.empty_display_type = 'SPHERE'
        obj.empty_display_size = .028
for node in data['nodes']:
    objects[node['id']].parent = objects.get(node['parent'], runtime_basis)

# Import a clean, intact copy; the user's open scene had lost its armature.
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/parachutist.glb'))
imported = set(bpy.data.objects) - before
rig = next(obj for obj in imported if obj.type == 'ARMATURE')
for obj in imported:
    if obj.type in {'CAMERA', 'LIGHT'} or obj.name in {'Cube', 'Icosphere'}:
        bpy.data.objects.remove(obj, do_unlink=True)
    else:
        move_to(obj, legacy_coll)
rig.name = 'VANGUARD | Recovered deformation rig'
rig.rotation_euler = (-math.pi / 2, 0, 0)
rig.location = (2.2, 0, .35)
rig.show_in_front = True
rig.data.display_type = 'OCTAHEDRAL'
rig['recovery_note'] = 'Original open scene had no armature; recovered identical weighted Vanguard skin and 49 bone rig from public/models/parachutist.glb. Original is backed up unchanged.'
legacy_actions = list(bpy.data.actions)
for action in legacy_actions:
    action.name = 'SOURCE | ' + action.name
    action.use_fake_user = True
rig.animation_data_clear()
for obj in list(legacy_coll.objects):
    if obj != rig and obj.animation_data:
        obj.animation_data_clear()
    if obj.type == 'MESH':
        for poly in obj.data.polygons:
            poly.use_smooth = True

# glTF import preserves matrices but some source display tails are 100x too long.
# Shorten along the exact original Y axis so skin binding/rest orientations stay unchanged.
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for bone in rig.data.edit_bones:
    children = list(bone.children)
    distance = min(((child.head - bone.head).length for child in children), default=6)
    bone.length = max(1, min(48, distance))
bpy.ops.object.mode_set(mode='OBJECT')
for pb in rig.pose.bones:
    pb.matrix_basis.identity()
    pb.rotation_mode = 'QUATERNION'
rest = {bone.name: bone.matrix_local.copy() for bone in rig.data.bones}
semantic = data['character']
legacy_canopy_basis = bpy.data.objects.new('VANGUARD | Retargeted canopy coordinates', None)
legacy_coll.objects.link(legacy_canopy_basis)
legacy_canopy_basis.matrix_world = Matrix.Translation(Vector((2.2, 0, .35))) @ C
canopy_id = semantic['canopy']
canopy_ids = {canopy_id}
for node in data['nodes']:
    if node['parent'] in canopy_ids:
        canopy_ids.add(node['id'])
legacy_canopy = {}
for node_id in canopy_ids:
    source = objects[node_id]
    copy = source.copy()
    copy.name = 'VANGUARD | ' + source.name
    if source.data:
        copy.data = source.data.copy()
    copy.animation_data_clear()
    legacy_coll.objects.link(copy)
    legacy_canopy[node_id] = copy
for node_id, obj in legacy_canopy.items():
    obj.parent = legacy_canopy.get(node_defs[node_id]['parent'], legacy_canopy_basis)
toggle_ids = [node['id'] for node in data['nodes'] if node['name'] == 'Red brake toggle']


def world_matrices(frame_nodes):
    merged = {key: dict(value) for key, value in node_defs.items()}
    for node in frame_nodes:
        merged[node['id']].update(node)
    result = {}
    def recurse(node_id):
        if node_id not in result:
            node = merged[node_id]
            local = trs(node)
            result[node_id] = recurse(node['parent']) @ local if node['parent'] is not None else local
        return result[node_id]
    for node_id in merged:
        recurse(node_id)
    return result


K = (L.inverted() @ C).to_quaternion()
down = K @ Vector((0, -1, 0))
bone_nodes = {}
child_names = {}
for arm in semantic['arms']:
    side = 'Left' if arm['side'] < 0 else 'Right'
    for suffix, key, child in [('Arm', 'upper', 'ForeArm'), ('ForeArm', 'lower', 'Hand'), ('Hand', 'wrist', 'HandMiddle1')]:
        bone_nodes['mixamorig:' + side + suffix] = arm[key]
        child_names['mixamorig:' + side + suffix] = 'mixamorig:' + side + child
for leg in semantic['legs']:
    side = 'Left' if leg['side'] < 0 else 'Right'
    for suffix, key, child in [('UpLeg', 'upper', 'Leg'), ('Leg', 'lower', 'Foot')]:
        bone_nodes['mixamorig:' + side + suffix] = leg[key]
        child_names['mixamorig:' + side + suffix] = 'mixamorig:' + side + child
    bone_nodes['mixamorig:' + side + 'Foot'] = leg['boot']


def retarget(frame):
    worlds = world_matrices(frame['nodes'])
    body_q = worlds[semantic['body']].to_quaternion()
    body_rot = K @ body_q @ K.inverted()
    # Match live torso/limb directions; preserve Vanguard proportions and bind matrices.
    for pb in rig.pose.bones:
        name = pb.name
        rest_mat = rest[name]
        if name in bone_nodes:
            q = worlds[bone_nodes[name]].to_quaternion()
            rotated = K @ q @ K.inverted()
            if name.endswith('Foot'):
                orientation = rotated @ rest_mat.to_quaternion()
            else:
                direction = (rest[child_names[name]].translation - rest_mat.translation).normalized()
                correction = direction.rotation_difference(down)
                orientation = rotated @ correction @ rest_mat.to_quaternion()
        elif name.endswith('Head') or name.endswith('Neck'):
            q = worlds[semantic['head']].to_quaternion()
            orientation = (K @ q @ K.inverted()) @ rest_mat.to_quaternion()
        elif 'Hand' in name:
            pb.matrix_basis.identity()
            pb.rotation_quaternion = Quaternion((0, 0, 1), .35 if 'Left' in name else -.35)
            continue
        else:
            orientation = body_rot @ rest_mat.to_quaternion()
        if pb.parent:
            position = (pb.parent.matrix @ rest[pb.parent.name].inverted() @ rest_mat).translation
        else:
            # Pelvis centre follows the anatomical hips rather than the torso pivot.
            hips = [worlds[leg['upper']].translation for leg in semantic['legs']]
            position = K @ ((hips[0] + hips[1]) * 50)
            position.y -= 5.27
        pb.matrix = Matrix.LocRotScale(position, orientation, Vector((1, 1, 1)))
        bpy.context.view_layer.update()
    if frame.get('_grounded'):
        # Retargeted proportions differ; align the lowest sole to the studio floor.
        depsgraph = bpy.context.evaluated_depsgraph_get()
        min_z = min((obj.matrix_world @ Vector(v)).z for obj in legacy_coll.objects if obj.type == 'MESH' and obj not in legacy_canopy.values()
                    for v in obj.evaluated_get(depsgraph).bound_box)
        hips = rig.pose.bones['mixamorig:Hips']
        mat = hips.matrix.copy()
        lift = min(leg['footPosition'][1] - (-.32 + .101 * math.cos(leg['footRoll'])
                   + (.094 if leg['footRoll'] >= 0 else -.184) * math.sin(leg['footRoll']))
                   for leg in frame['pose']['legs'])
        mat.translation.y += (min_z - .03 - max(0, lift)) * 100
        hips.matrix = mat
    for pb in rig.pose.bones:
        for path in ('location', 'rotation_quaternion', 'scale'):
            pb.keyframe_insert(data_path=path, frame=frame['frame'], group=pb.name)


def vanguard_cords(dynamic):
    coords = list(dynamic['position'])
    is_lines = 'suspension' in objects[dynamic['id']].name.lower()
    bank_stride = len(coords) // 3 // 4 if is_lines else 4
    for bank in range(4):
        side = 'Left' if bank < 2 else 'Right'
        row = bank % 2
        hand = K.inverted() @ (rig.pose.bones[f'mixamorig:{side}HandMiddle1'].matrix.translation * .01)
        lower = K.inverted() @ (rig.pose.bones[f'mixamorig:{side}Arm'].matrix.translation * .01)
        lower.x += .04 if side == 'Left' else -.04
        lower.z += -.035 if row == 0 else .035
        upper = lower.copy()
        upper.y += .43
        upper.z = -.143 if row == 0 else .143
        if is_lines:
            index = bank * bank_stride * 3
            coords[index:index + 3] = upper
            brake_index = (bank * bank_stride + bank_stride - 2) * 3
            coords[brake_index:brake_index + 3] = hand
        else:
            index = bank * 12
            coords[index:index + 12] = [lower.x - .019, lower.y, lower.z, lower.x + .019, lower.y, lower.z,
                                        upper.x + .019, upper.y, upper.z, upper.x - .019, upper.y, upper.z]
    return coords


def insert_dynamic(obj, coords, number):
    if obj.data.shape_keys is None:
        obj.shape_key_add(name='Basis')
    shape = obj.shape_key_add(name=f'Rope geometry {number:04d}')
    shape.data.foreach_set('co', coords)
    for f, value in ((number - 1, 0), (number, 1), (number + 1, 0)):
        shape.value = value
        shape.keyframe_insert(data_path='value', frame=f)


def animate_toggles(target_objects, coords, number):
    stride = len(coords) // 3 // 4
    for index, node_id in enumerate(toggle_ids):
        brake_index = ((index * 2 + 1) * stride + stride - 2) * 3
        target_objects[node_id].location = coords[brake_index:brake_index + 3]
        target_objects[node_id].keyframe_insert(data_path='location', frame=number)


# One action per Vanguard movement, arranged as clearly labeled NLA strips.
# The game hierarchy keeps directly editable baked object channels on this same timeline.
dynamic_keys = {}
clip_summary = []
for clip in data['clips']:
    action = bpy.data.actions.new('PILOT | ' + clip['name'])
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame in clip['frames']:
        number = frame['frame']
        for node in frame['nodes']:
            set_transform(objects[node['id']], node, number)
            if node['id'] in legacy_canopy:
                set_transform(legacy_canopy[node['id']], node, number)
        frame['_grounded'] = clip.get('state') == 'grounded'
        retarget(frame)
        for dynamic in frame.get('dynamic', []):
            obj = objects[dynamic['id']]
            if obj.type != 'MESH':
                continue
            coords = dynamic['position']
            insert_dynamic(obj, coords, number)
            vanguard_coords = vanguard_cords(dynamic)
            insert_dynamic(legacy_canopy[dynamic['id']], vanguard_coords, number)
            if 'suspension' in obj.name.lower():
                animate_toggles(objects, coords, number)
                animate_toggles(legacy_canopy, vanguard_coords, number)
            dynamic_keys.setdefault(obj.name, 0)
            dynamic_keys[obj.name] += 1
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = clip['name']
    strip = track.strips.new(clip['name'], clip['start'], action)
    strip.action_frame_start = clip['start']
    strip.action_frame_end = clip['end']
    strip.frame_start = clip['start']
    strip.frame_end = clip['end']
    strip.extrapolation = 'HOLD_FORWARD'
    strip.blend_type = 'REPLACE'
    scene.timeline_markers.new(clip['name'].replace('_', ' '), frame=clip['start'])
    clip_summary.append({key: clip.get(key) for key in ('name', 'start', 'end', 'loop')})
    # Hide canopy with children while walking; object hide does not inherit in Blender.
    canopy = objects[semantic['canopy']]
    descendants = [canopy] + list(canopy.children_recursive) + list(legacy_canopy.values())
    for obj in descendants:
        for f in (clip['start'], clip['end']):
            obj.hide_render = clip.get('state') == 'grounded'
            obj.keyframe_insert(data_path='hide_render', frame=f)
            obj.hide_viewport = clip.get('state') == 'grounded'
            obj.keyframe_insert(data_path='hide_viewport', frame=f)
    print('AUTHORED', clip['name'], flush=True)

# Make sampled loops and shape curves linear and hide/show curves constant.
def action_curves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves
for action in bpy.data.actions:
    if action.name.startswith('SOURCE | '):
        continue
    for curve in action_curves(action):
        for key in curve.keyframe_points:
            key.interpolation = 'CONSTANT' if curve.data_path.startswith('hide_') else 'LINEAR'


def plain_material(name, color, metallic=0, roughness=.6):
    return material({'name': name, 'color': color, 'metalness': metallic, 'roughness': roughness})


floor_mat = plain_material('Studio charcoal', (.025, .038, .050), .1, .65)
trim_mat = plain_material('Stage edge teal', (.025, .32, .29), .35, .35)
text_mat = plain_material('Typography ivory', (.80, .87, .88), .1, .45)
for x in (-2.2, 2.2):
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1.35, depth=.075, location=(x, 0, -.018))
    obj = bpy.context.object
    obj.name = 'Pilot review plinth'
    obj.data.materials.append(floor_mat)
    move_to(obj, stage_coll)
    bevel = obj.modifiers.new('Soft machined stage edge', 'BEVEL')
    bevel.width = .025
    bevel.segments = 3
    bpy.ops.mesh.primitive_torus_add(major_radius=1.28, minor_radius=.008, major_segments=96, minor_segments=8, location=(x, 0, .024))
    obj = bpy.context.object
    obj.name = 'Teal stage ring'
    obj.data.materials.append(trim_mat)
    move_to(obj, stage_coll)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.063))
bpy.context.object.name = 'Seamless studio floor'
bpy.context.object.data.materials.append(floor_mat)
move_to(bpy.context.object, stage_coll)


def caption(text, location, size=.14):
    font = bpy.data.curves.new('Studio caption', 'FONT')
    font.body = text
    font.size = size
    font.align_x = 'CENTER'
    font.extrude = .0005
    obj = bpy.data.objects.new(text, font)
    stage_coll.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (math.pi / 2, 0, math.pi)
    obj.data.materials.append(text_mat)
    return obj


caption('GAME PILOT', (-2.2, 1.42, .12))
caption('VANGUARD / RECOVERED RIG', (2.2, 1.42, .12), .115)


def camera(name, position, target, lens):
    cam = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, cam)
    stage_coll.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    cam.lens = lens
    cam.clip_end = 300
    return obj


overview = camera('CAMERA | All models and canopy', (7.5, 11.5, 6.5), (0, 0, 1.8), 44)
closeup = camera('CAMERA | Body mechanics', (4.6, 9.4, 3.9), (0, 0, 1.05), 52)
game_closeup = camera('CAMERA | Hands knees and harness', (-.25, 5.5, 2.8), (-2.2, 0, 1.25), 67)
scene.camera = overview
for name, location, energy, color, size in [
    ('Key softbox', (2, 4, 7), 1700, (1, .90, .79), 5),
    ('Cool fill', (-5, 2, 4), 1250, (.67, .84, 1), 4),
    ('Edge softbox', (0, -4, 6), 2200, (.78, 1, .93), 4),
]:
    light_data = bpy.data.lights.new(name, 'AREA')
    light_data.energy = energy
    light_data.color = color
    light_data.shape = 'DISK'
    light_data.size = size
    light = bpy.data.objects.new(name, light_data)
    stage_coll.objects.link(light)
    light.location = location
    light.rotation_euler = (Vector((0, 0, 1.5)) - light.location).to_track_quat('-Z', 'Y').to_euler()
scene.world.color = (.15, .15, .15)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.threads_mode = 'FIXED'
scene.render.threads = 4
scene.render.resolution_x = 1440
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
scene['animation_chapters'] = json.dumps(clip_summary)
scene['fps_and_usage'] = '30 fps. Space: play. Timeline markers separate movements. Vanguard: NLA Editor or Action Editor; game pilot: select named shoulder/elbow/wrist/hip/knee controller.'
scene['original_scene_preserved'] = 'Original authoring scene retained separately outside this distributed studio.'
# Wings retain their real 9.2 m span. Separate the airborne review stations so
# the two full-size canopies never intersect; close ground views stay compact.
for clip in data['clips']:
    spread = 5.2 if clip.get('state') == 'airborne' else 2.2
    for obj, side in [(runtime_basis, -1), (rig, 1), (legacy_canopy_basis, 1)]:
        for number in (clip['start'], clip['end']):
            obj.location.x = side * spread
            obj.keyframe_insert(data_path='location', index=0, frame=number)
            obj.location.z = .75 if clip.get('state') == 'airborne' else .35
            obj.keyframe_insert(data_path='location', index=2, frame=number)
    scene.timeline_markers.get(clip['name'].replace('_', ' ')).camera = overview if clip.get('state') == 'airborne' else closeup
for obj in stage_coll.objects:
    if obj.type in {'MESH', 'FONT'} and abs(abs(obj.location.x) - 2.2) < .01:
        side = 1 if obj.location.x > 0 else -1
        for clip in data['clips']:
            spread = 5.2 if clip.get('state') == 'airborne' else 2.2
            for number in (clip['start'], clip['end']):
                obj.location.x = side * spread
                obj.keyframe_insert(data_path='location', index=0, frame=number)


def fit_overview():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = [obj.matrix_world @ Vector(point) for coll in (runtime_coll, legacy_coll)
              for obj in coll.objects if obj.type == 'MESH' and not obj.hide_render
              for point in obj.evaluated_get(depsgraph).bound_box]
    lower = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    upper = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    centre = (lower + upper) * .5
    overview.location = centre + Vector((12, 28, 16))
    overview.rotation_euler = (centre - overview.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    camera_points = [overview.matrix_world.inverted() @ p for p in points]
    width = max(p.x for p in camera_points) - min(p.x for p in camera_points)
    height = max(p.y for p in camera_points) - min(p.y for p in camera_points)
    overview.data.type = 'ORTHO'
    overview.data.ortho_scale = max(width, height * scene.render.resolution_x / scene.render.resolution_y) * 1.14


# q and -q mean the same orientation, but sampled component curves must stay in
# one hemisphere to avoid an interpolated zero quaternion between adjacent keys.
for action in bpy.data.actions:
    if action.name.startswith('SOURCE | '):
        continue
    groups = {}
    for curve in action_curves(action):
        if curve.data_path.endswith('rotation_quaternion'):
            groups.setdefault(curve.data_path, {})[curve.array_index] = curve
    for channels in groups.values():
        if len(channels) != 4:
            continue
        previous = None
        for index in range(min(len(channels[i].keyframe_points) for i in range(4))):
            values = [channels[i].keyframe_points[index].co.y for i in range(4)]
            if previous and sum(a * b for a, b in zip(previous, values)) < 0:
                values = [-value for value in values]
                for i in range(4):
                    point = channels[i].keyframe_points[index]
                    point.co.y *= -1
                    point.handle_left.y *= -1
                    point.handle_right.y *= -1
            previous = values


notes = bpy.data.texts.new('READ ME | Animation Studio')
notes.write('PARACHUTIST ANIMATION STUDIO\n\n'
    'Two actual project variants are loaded: the game pilot with its canopy and the recovered Vanguard skin.\n'
    'The original open file contained skin weights but no armature. Its untouched backup is preserved.\n'
    'The intact 49 bone rig was recovered from the project GLB; original Idle / Walk / Run / TPose actions remain as SOURCE assets.\n\n'
    'EDITING\nVanguard: select the recovered rig, Pose Mode; named PILOT actions and NLA tracks.\n'
    'Game pilot: named shoulder / elbow / wrist / hip / knee controllers, baked transform channels.\n'
    'Hands have curl shape keys. Suspension follows actual hand/riser points using geometry shape keys.\n'
    'Timeline: Idle, Walk, Run, Flight, Pull Left, Pull Right, Flare, Soft Landing, Hard Landing.\n\n'
    'Clips are sampled from the same deterministic motion used in the game.\n'
    'The studio is a local editable source artifact; no public deployment was performed.\n\n'
    + json.dumps(clip_summary, indent=2))
scene.frame_set(next((clip['start'] + 35 for clip in data['clips'] if 'Flight' in clip['name']), 1))
fit_overview()
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
for workspace in bpy.data.workspaces:
    for screen in [workspace.screens[0]] if workspace.screens else []:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
                area.spaces.active.overlay.show_floor = False
                area.spaces.active.shading.type = 'MATERIAL'
DESTINATION.parent.mkdir(parents=True, exist_ok=True)
PREVIEWS.mkdir(parents=True, exist_ok=True)
bpy.ops.file.pack_all()
bpy.context.preferences.filepaths.save_version = 0
scene.render.filepath = '//../previews/'
bpy.ops.wm.save_as_mainfile(filepath=str(DESTINATION))
report = {'blend': DESTINATION.relative_to(ROOT).as_posix(), 'rigBones': len(rig.data.bones), 'runtimeNodes': len(objects), 'clips': clip_summary, 'dynamicKeys': dynamic_keys}
(PREVIEWS / 'parachutist-studio-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
if '--no-render' not in __import__('sys').argv:
    for word, offset, cam in [('Flight', 35, overview), ('Walk', 16, closeup), ('Hard_Landing', 6, closeup)]:
        clip = next((clip for clip in data['clips'] if word in clip['name']), None)
        if clip:
            scene.camera = cam
            scene.frame_set(min(clip['end'], clip['start'] + offset))
            scene.render.filepath = str(PREVIEWS / f'parachutist-{word.lower()}.png')
            bpy.ops.render.render(write_still=True)
            # Remove PNG metadata without touching image pixels or color chunks.
            # Blender otherwise stores the absolute local .blend path in tEXt.
            png_path = Path(scene.render.filepath)
            png = png_path.read_bytes()
            if png[:8] != b'\x89PNG\r\n\x1a\n':
                raise ValueError('Expected PNG render output')
            clean = bytearray(png[:8])
            offset = 8
            while offset < len(png):
                length = int.from_bytes(png[offset:offset + 4], 'big')
                end = offset + length + 12
                if png[offset + 4:offset + 8] not in (b'tEXt', b'iTXt', b'zTXt', b'eXIf'):
                    clean.extend(png[offset:end])
                offset = end
            png_path.write_bytes(clean)
print('STUDIO_COMPLETE', json.dumps(report), flush=True)
