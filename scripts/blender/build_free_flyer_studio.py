"""Build the editable civilian Free Flight character and its web GLB.

Usage (Blender 5.2 LTS):
  blender --background --factory-startup --python scripts/blender/build_free_flyer_studio.py

The source is deterministic and self-contained.  It creates a compact skinned
character in metres, six baked actions, an editable studio .blend and the GLB
consumed by the game.  The control-friendly source armature is also the clean
deformation/export armature; no Rigify widgets or constraints leak into GLB.
"""

import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
STUDIO_PATH = ROOT / "art/models/free-flyer-studio.blend"
GLB_PATH = ROOT / "public/models/free-flyer.glb"
PREVIEW_PATH = ROOT / "art/previews/free-flyer-studio.png"
REPORT_PATH = ROOT / "art/previews/free-flyer-studio-report.json"
CHARACTER_HEIGHT = 1.82
FPS = 30


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures,
                       bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def new_collection(name):
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def move_to_collection(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_transform(obj):
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def material(name, color, roughness=0.8, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if shader.inputs.get("Coat Weight"):
        shader.inputs["Coat Weight"].default_value = 0.08
    return mat


def finish_mesh(obj, mat, smooth=True):
    obj.data.materials.append(mat)
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def ellipsoid(name, location, scale, mat, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=1.0,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    apply_transform(obj)
    return finish_mesh(obj, mat)


def capsule(name, start, end, radii, mat, segments=18, rings=10):
    start = Vector(start)
    end = Vector(end)
    direction = end - start
    obj = ellipsoid(
        name,
        (start + end) * 0.5,
        (radii[0], radii[1], max(direction.length * 0.56, radii[0])),
        mat,
        segments,
        rings,
    )
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    apply_transform(obj)
    return obj


def tapered_segment(name, start, end, radius_start, radius_end, mat, vertices=20, bevel=0.012):
    start = Vector(start)
    end = Vector(end)
    direction = end - start
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius_start,
        radius2=radius_end,
        depth=direction.length,
        location=(start + end) * 0.5,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    apply_transform(obj)
    modifier = obj.modifiers.new("Soft trouser seam", "BEVEL")
    modifier.width = bevel
    modifier.segments = 2
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return finish_mesh(obj, mat)


def cone_between(name, start, end, radius, mat, vertices=10):
    start = Vector(start)
    end = Vector(end)
    direction = end - start
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius,
        radius2=radius * 0.08,
        depth=direction.length,
        location=(start + end) * 0.5,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    apply_transform(obj)
    return finish_mesh(obj, mat)


def rounded_box(name, location, scale, mat, bevel=0.018, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    apply_transform(obj)
    modifier = obj.modifiers.new("Soft garment edge", "BEVEL")
    modifier.width = bevel
    modifier.segments = 2
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return finish_mesh(obj, mat, smooth=False)


def extruded_panel(name, points, y, depth, mat, bevel=0.01):
    """Create a thin tailored garment panel from an x/z outline."""
    count = len(points)
    front_y = y - depth * 0.5
    back_y = y + depth * 0.5
    vertices = [(x, front_y, z) for x, z in points] + [(x, back_y, z) for x, z in points]
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    mesh = bpy.data.meshes.new(name + " geometry")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    modifier = obj.modifiers.new("Soft tailored edge", "BEVEL")
    modifier.width = bevel
    modifier.segments = 2
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return finish_mesh(obj, mat, smooth=False)


def torus(name, location, major_radius, minor_radius, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=24,
        minor_segments=8,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, mat)


def add_weights(obj, weights):
    indices = list(range(len(obj.data.vertices)))
    for bone_name, weight in weights.items():
        group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
        group.add(indices, float(weight), "REPLACE")


def join_parts(name, parts, collection, rig):
    if not parts:
        raise ValueError(f"No pieces supplied for {name}")
    activate(parts[0])
    for obj in parts[1:]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    result.data.name = f"{name}_MESH"
    move_to_collection(result, collection)
    result.parent = rig
    modifier = result.modifiers.new("RIG_DEFORM", "ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    result["part"] = name
    return result


def weighted(obj, weights):
    add_weights(obj, weights)
    return obj


clear_scene()
scene = bpy.context.scene
scene.name = "FREE FLYER | Civilian Animation Studio"
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = 60
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0
scene.world.color = (0.045, 0.055, 0.07)

character_collection = new_collection("01 | CHARACTER_GUY | export")
stage_collection = new_collection("02 | STUDIO | not exported")

skin = material("MAT_SKIN_WARM", (0.58, 0.34, 0.22), 0.82)
skin_soft = material("MAT_SKIN_FACE", (0.66, 0.40, 0.27), 0.86)
lip = material("MAT_LIP_NATURAL", (0.28, 0.085, 0.065), 0.9)
eye_white = material("MAT_EYE_WHITE", (0.93, 0.95, 0.96), 0.32)
iris = material("MAT_EYE_HAZEL", (0.15, 0.085, 0.045), 0.38)
tshirt = material("MAT_TSHIRT_WHITE", (0.91, 0.92, 0.91), 0.94)
shirt = material("MAT_SHIRT_BLUE", (0.14, 0.34, 0.64), 0.88)
shirt_dark = material("MAT_SHIRT_STITCH", (0.055, 0.18, 0.40), 0.9)
pants = material("MAT_PANTS_BROWN", (0.105, 0.044, 0.017), 0.94)
shoes = material("MAT_SHOES_WHITE", (0.92, 0.93, 0.92), 0.7)
sole = material("MAT_SHOE_SOLE", (0.68, 0.70, 0.70), 0.9)
hair = material("MAT_HAIR_BROWN", (0.075, 0.04, 0.022), 0.96)
button = material("MAT_BUTTON_LIGHT", (0.79, 0.84, 0.89), 0.65)


# ---------------------------------------------------------------------------
# Export/deformation rig.  The A-pose is stored at real scale and uses stable,
# semantic bone names so runtime animation can address it without index lookup.
# ---------------------------------------------------------------------------
armature = bpy.data.armatures.new("RIG_DEFORM_DATA")
rig = bpy.data.objects.new("RIG_DEFORM", armature)
character_collection.objects.link(rig)
rig.show_in_front = True
armature.display_type = "STICK"
rig["characterHeight"] = CHARACTER_HEIGHT
rig["forwardAxis"] = "Blender -Y; glTF +Z after exporter conversion"
rig["runtimeSecondaryBones"] = json.dumps([
    "hair.front", "hair.crown", "hair.back.L", "hair.back.R",
    "shirt_flap.L", "shirt_flap.R",
])

activate(rig)
bpy.ops.object.mode_set(mode="EDIT")


def edit_bone(name, head, tail, parent=None, deform=True):
    bone = armature.edit_bones.new(name)
    bone.head = head
    bone.tail = tail
    bone.use_deform = deform
    if parent:
        bone.parent = armature.edit_bones[parent]
        bone.use_connect = (Vector(head) - armature.edit_bones[parent].tail).length < 1e-6
    return bone


edit_bone("root", (0, 0, 0.0), (0, 0, 0.12))
edit_bone("pelvis", (0, 0, 0.84), (0, 0, 0.99), "root")
edit_bone("spine.001", (0, 0, 0.99), (0, 0, 1.15), "pelvis")
edit_bone("spine.002", (0, 0, 1.15), (0, 0, 1.31), "spine.001")
edit_bone("chest", (0, 0, 1.31), (0, 0, 1.47), "spine.002")
edit_bone("breath", (0, -0.025, 1.31), (0, -0.025, 1.43), "chest")
edit_bone("neck", (0, 0, 1.47), (0, 0, 1.56), "chest")
edit_bone("head", (0, 0, 1.56), (0, 0, 1.77), "neck")

for side, suffix in [(-1, ".L"), (1, ".R")]:
    shoulder = (side * 0.19, 0, 1.43)
    elbow = (side * 0.305, 0, 1.19)
    wrist = (side * 0.32, -0.005, 0.98)
    palm = (side * 0.33, -0.012, 0.89)
    edit_bone("clavicle" + suffix, (side * 0.035, 0, 1.44), shoulder, "chest")
    edit_bone("upper_arm" + suffix, shoulder, elbow, "clavicle" + suffix)
    edit_bone("upper_arm_twist" + suffix, Vector(shoulder).lerp(Vector(elbow), 0.5), elbow, "upper_arm" + suffix)
    edit_bone("forearm" + suffix, elbow, wrist, "upper_arm" + suffix)
    edit_bone("forearm_twist" + suffix, Vector(elbow).lerp(Vector(wrist), 0.5), wrist, "forearm" + suffix)
    edit_bone("hand" + suffix, wrist, palm, "forearm" + suffix)
    for index, finger in enumerate(("index", "middle", "ring", "pinky")):
        y = -0.035 + index * 0.022
        start = (side * 0.326, y, 0.915 - index * 0.003)
        end = (side * (0.337 - index * 0.002), y, 0.842 + index * 0.002)
        edit_bone(finger + ".01" + suffix, start, end, "hand" + suffix)
    edit_bone("thumb.01" + suffix, (side * 0.325, -0.045, 0.92), (side * 0.35, -0.065, 0.875), "hand" + suffix)

    hip = (side * 0.105, 0, 0.89)
    knee = (side * 0.11, 0, 0.51)
    ankle = (side * 0.105, 0.0, 0.13)
    toe = (side * 0.105, -0.25, 0.07)
    edit_bone("thigh" + suffix, hip, knee, "pelvis")
    edit_bone("thigh_twist" + suffix, Vector(hip).lerp(Vector(knee), 0.5), knee, "thigh" + suffix)
    edit_bone("shin" + suffix, knee, ankle, "thigh" + suffix)
    edit_bone("shin_twist" + suffix, Vector(knee).lerp(Vector(ankle), 0.5), ankle, "shin" + suffix)
    edit_bone("foot" + suffix, ankle, toe, "shin" + suffix)
    edit_bone("toe" + suffix, toe, (side * 0.105, -0.34, 0.065), "foot" + suffix)

edit_bone("hair.front", (0, -0.035, 1.70), (0, -0.09, 1.82), "head")
edit_bone("hair.crown", (0, 0.0, 1.72), (0, 0.01, 1.82), "head")
edit_bone("hair.back.L", (-0.045, 0.035, 1.70), (-0.08, 0.085, 1.79), "head")
edit_bone("hair.back.R", (0.045, 0.035, 1.70), (0.08, 0.085, 1.79), "head")
edit_bone("shirt_flap.L", (-0.095, -0.12, 1.08), (-0.105, -0.145, 0.84), "spine.001")
edit_bone("shirt_flap.R", (0.095, -0.12, 1.08), (0.105, -0.145, 0.84), "spine.001")

bpy.ops.object.mode_set(mode="POSE")
for pose_bone in rig.pose.bones:
    pose_bone.rotation_mode = "XYZ"
    if pose_bone.name.startswith("hair."):
        pose_bone.bone["secondaryMotion"] = "hair"
        pose_bone.bone["stiffness"] = 0.75
        pose_bone.bone["damping"] = 0.65
    elif pose_bone.name.startswith("shirt_flap"):
        pose_bone.bone["secondaryMotion"] = "shirt"
        pose_bone.bone["stiffness"] = 0.58
        pose_bone.bone["damping"] = 0.72
bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------------------
# Character geometry.  Each visible logical part remains a separately named
# mesh, while overlapping rounded forms hide joints at game camera distance.
# ---------------------------------------------------------------------------
body_parts = []
body_parts.append(weighted(ellipsoid("head", (0, -0.006, 1.64), (0.092, 0.084, 0.128), skin_soft, 24, 16), {"head": 1}))
body_parts.append(weighted(ellipsoid("jaw", (0, -0.016, 1.592), (0.080, 0.076, 0.077), skin_soft, 22, 14), {"head": 1}))
body_parts.append(weighted(ellipsoid("nose", (0, -0.091, 1.637), (0.014, 0.022, 0.026), skin_soft, 14, 8), {"head": 1}))
body_parts.append(weighted(ellipsoid("mouth", (0, -0.091, 1.595), (0.022, 0.003, 0.0055), lip, 14, 7), {"head": 1}))
body_parts.append(weighted(capsule("neck", (0, 0, 1.45), (0, 0, 1.56), (0.049, 0.046), skin, 18, 10), {"neck": 0.7, "head": 0.3}))
for side, suffix in [(-1, ".L"), (1, ".R")]:
    body_parts.append(weighted(ellipsoid("ear" + suffix, (side * 0.094, 0, 1.64), (0.013, 0.009, 0.026), skin_soft, 14, 8), {"head": 1}))
    body_parts.append(weighted(capsule("forearm" + suffix, (side * 0.297, 0, 1.205), (side * 0.32, -0.005, 0.98), (0.039, 0.034), skin, 18, 10), {"forearm" + suffix: 0.78, "forearm_twist" + suffix: 0.22}))
    body_parts.append(weighted(capsule("palm" + suffix, (side * 0.318, -0.005, 0.98), (side * 0.33, -0.012, 0.89), (0.039, 0.026), skin_soft, 16, 9), {"hand" + suffix: 1}))
    for index, finger in enumerate(("index", "middle", "ring", "pinky")):
        y = -0.035 + index * 0.022
        start = (side * 0.326, y, 0.915 - index * 0.003)
        end = (side * (0.337 - index * 0.002), y, 0.842 + index * 0.002)
        body_parts.append(weighted(capsule(finger + suffix, start, end, (0.0075 - index * 0.0005, 0.006), skin_soft, 12, 7), {finger + ".01" + suffix: 1}))
    body_parts.append(weighted(capsule("thumb" + suffix, (side * 0.325, -0.045, 0.92), (side * 0.35, -0.065, 0.875), (0.010, 0.008), skin_soft, 12, 7), {"thumb.01" + suffix: 1}))
body_obj = join_parts("BODY", body_parts, character_collection, rig)

eye_parts = []
for side in (-1, 1):
    eye_parts.append(weighted(ellipsoid("eye.white", (side * 0.035, -0.083, 1.66), (0.017, 0.007, 0.009), eye_white, 16, 8), {"head": 1}))
    eye_parts.append(weighted(ellipsoid("eye.iris", (side * 0.035, -0.089, 1.66), (0.0055, 0.0025, 0.0055), iris, 12, 7), {"head": 1}))
eyes_obj = join_parts("EYES", eye_parts, character_collection, rig)

tshirt_parts = [
    weighted(ellipsoid("tshirt.chest", (0, 0, 1.265), (0.195, 0.125, 0.235), tshirt, 22, 14), {"chest": 0.65, "spine.002": 0.35}),
    weighted(ellipsoid("tshirt.waist", (0, 0.003, 1.07), (0.168, 0.11, 0.16), tshirt, 20, 12), {"spine.001": 0.72, "pelvis": 0.28}),
    weighted(torus("tshirt.collar", (0, -0.012, 1.465), 0.068, 0.008, tshirt), {"chest": 0.6, "neck": 0.4}),
]
tshirt_obj = join_parts("TSHIRT_WHITE", tshirt_parts, character_collection, rig)

shirt_parts = [
    weighted(rounded_box("shirt.back", (0, 0.102, 1.245), (0.182, 0.020, 0.255), shirt, 0.02), {"chest": 0.55, "spine.002": 0.3, "spine.001": 0.15}),
    weighted(rounded_box("shirt.side.L", (-0.177, 0.0, 1.235), (0.024, 0.095, 0.242), shirt, 0.018), {"chest": 0.55, "spine.002": 0.3, "spine.001": 0.15}),
    weighted(rounded_box("shirt.side.R", (0.177, 0.0, 1.235), (0.024, 0.095, 0.242), shirt, 0.018), {"chest": 0.55, "spine.002": 0.3, "spine.001": 0.15}),
    weighted(extruded_panel("shirt.front.L", [(-0.18, 1.46), (-0.083, 1.46), (-0.040, 1.32), (-0.042, 1.055), (-0.155, 1.00), (-0.18, 1.04)], -0.128, 0.025, shirt), {"chest": 0.58, "spine.002": 0.28, "spine.001": 0.14}),
    weighted(extruded_panel("shirt.front.R", [(0.18, 1.46), (0.083, 1.46), (0.040, 1.32), (0.042, 1.055), (0.155, 1.00), (0.18, 1.04)], -0.128, 0.025, shirt), {"chest": 0.58, "spine.002": 0.28, "spine.001": 0.14}),
    weighted(extruded_panel("shirt.tail.L", [(-0.155, 1.055), (-0.042, 1.055), (-0.055, 0.915), (-0.145, 0.94)], -0.132, 0.025, shirt), {"shirt_flap.L": 0.86, "spine.001": 0.14}),
    weighted(extruded_panel("shirt.tail.R", [(0.155, 1.055), (0.042, 1.055), (0.055, 0.915), (0.145, 0.94)], -0.132, 0.025, shirt), {"shirt_flap.R": 0.86, "spine.001": 0.14}),
]
for side, suffix in [(-1, ".L"), (1, ".R")]:
    shirt_parts.append(weighted(capsule("shirt.sleeve" + suffix, (side * 0.185, 0, 1.43), (side * 0.295, 0, 1.215), (0.066, 0.058), shirt, 20, 11), {"upper_arm" + suffix: 0.82, "upper_arm_twist" + suffix: 0.18}))
    shirt_parts.append(weighted(torus("shirt.cuff" + suffix, (side * 0.295, 0, 1.215), 0.053, 0.009, shirt_dark, rotation=(0, math.radians(8) * side, 0)), {"upper_arm_twist" + suffix: 0.55, "forearm" + suffix: 0.45}))
for side in (-1, 1):
    shirt_parts.append(weighted(rounded_box("shirt.lapel", (side * 0.060, -0.151, 1.405), (0.026, 0.009, 0.078), shirt_dark, 0.009, rotation=(0, side * math.radians(24), 0)), {"chest": 1}))
for index in range(4):
    shirt_parts.append(weighted(ellipsoid("shirt.button", (0.046, -0.166, 1.37 - index * 0.09), (0.008, 0.004, 0.008), button, 10, 6), {"chest" if index < 2 else "spine.002": 1}))
shirt_obj = join_parts("SHIRT_BLUE", shirt_parts, character_collection, rig)

pants_parts = [
    # The waistband intentionally overlaps both the tucked T-shirt/shirt hem and
    # the pelvis shell. This avoids a dark horizontal slit when the character
    # bends while keeping every moving leg surface below it independent.
    weighted(rounded_box("pants.waistband_overlap", (0, 0.004, 0.958), (0.176, 0.119, 0.062), pants, 0.024), {"pelvis": 1}),
    weighted(ellipsoid("pants.waist", (0, 0.006, 0.855), (0.174, 0.12, 0.165), pants, 22, 14), {"pelvis": 1}),
    weighted(ellipsoid("pants.crotch", (0, -0.002, 0.745), (0.11, 0.098, 0.115), pants, 20, 12), {"pelvis": 1}),
    # Thin front/back gusset faces mask the concave seam between the pelvis and
    # the two thigh shells. Their narrow lower edge ends in the upper-crotch
    # area, leaving the independently skinned leg shafts free to separate.
    weighted(extruded_panel("pants.crotch_bridge.front", [(-0.112, 0.875), (0.112, 0.875), (0.078, 0.720), (0.052, 0.645), (-0.052, 0.645), (-0.078, 0.720)], -0.110, 0.034, pants, 0.016), {"pelvis": 1}),
    weighted(extruded_panel("pants.crotch_bridge.back", [(-0.112, 0.875), (0.112, 0.875), (0.078, 0.720), (0.052, 0.645), (-0.052, 0.645), (-0.078, 0.720)], 0.104, 0.030, pants, 0.014), {"pelvis": 1}),
]
for side, suffix in [(-1, ".L"), (1, ".R")]:
    pants_parts.append(weighted(ellipsoid("pants.hip_overlap" + suffix, (side * 0.102, 0, 0.73), (0.098, 0.083, 0.145), pants, 20, 12), {"pelvis": 0.48, "thigh" + suffix: 0.52}))
    pants_parts.append(weighted(tapered_segment("pants.thigh" + suffix, (side * 0.102, 0, 0.82), (side * 0.11, 0, 0.475), 0.09, 0.071, pants, 22, 0.015), {"thigh" + suffix: 0.78, "thigh_twist" + suffix: 0.22}))
    pants_parts.append(weighted(ellipsoid("pants.knee_overlap" + suffix, (side * 0.11, 0, 0.487), (0.073, 0.064, 0.070), pants, 18, 10), {"thigh" + suffix: 0.42, "shin" + suffix: 0.58}))
    pants_parts.append(weighted(tapered_segment("pants.shin" + suffix, (side * 0.11, 0, 0.50), (side * 0.105, 0, 0.135), 0.072, 0.055, pants, 22, 0.013), {"shin" + suffix: 0.78, "shin_twist" + suffix: 0.22}))
pants_obj = join_parts("PANTS_BROWN", pants_parts, character_collection, rig)

shoe_parts = []
for side, suffix in [(-1, ".L"), (1, ".R")]:
    shoe_parts.append(weighted(capsule("shoe.upper" + suffix, (side * 0.105, 0.015, 0.105), (side * 0.105, -0.205, 0.072), (0.075, 0.055), shoes, 20, 11), {"foot" + suffix: 0.82, "toe" + suffix: 0.18}))
    shoe_parts.append(weighted(ellipsoid("shoe.toe" + suffix, (side * 0.105, -0.22, 0.068), (0.080, 0.080, 0.048), shoes, 20, 11), {"toe" + suffix: 0.72, "foot" + suffix: 0.28}))
    shoe_parts.append(weighted(ellipsoid("sole" + suffix, (side * 0.105, -0.105, 0.027), (0.065, 0.115, 0.010), sole, 20, 8), {"foot" + suffix: 0.78, "toe" + suffix: 0.22}))
    for lace_y in (-0.085, -0.12, -0.155):
        shoe_parts.append(weighted(rounded_box("shoe.lace" + suffix, (side * 0.105, lace_y, 0.125), (0.048, 0.005, 0.004), sole, 0.004), {"foot" + suffix: 0.82, "toe" + suffix: 0.18}))
shoes_obj = join_parts("SHOES_WHITE", shoe_parts, character_collection, rig)

hair_parts = [weighted(ellipsoid("hair.cap", (0, 0.014, 1.72), (0.108, 0.10, 0.088), hair, 22, 13), {"head": 0.72, "hair.crown": 0.28})]
hair_specs = [
    ((-0.070, -0.065, 1.755), (-0.090, -0.105, 1.815), 0.027, "hair.front"),
    ((-0.030, -0.078, 1.765), (-0.045, -0.125, 1.825), 0.028, "hair.front"),
    ((0.012, -0.082, 1.765), (0.018, -0.125, 1.827), 0.029, "hair.front"),
    ((0.055, -0.070, 1.76), (0.078, -0.11, 1.815), 0.027, "hair.front"),
    ((-0.080, -0.018, 1.775), (-0.105, -0.025, 1.825), 0.030, "hair.crown"),
    ((-0.035, -0.015, 1.785), (-0.050, -0.025, 1.84), 0.031, "hair.crown"),
    ((0.015, -0.015, 1.785), (0.025, -0.025, 1.84), 0.031, "hair.crown"),
    ((0.065, -0.010, 1.775), (0.09, -0.012, 1.825), 0.029, "hair.crown"),
    ((-0.075, 0.040, 1.76), (-0.105, 0.075, 1.805), 0.027, "hair.back.L"),
    ((-0.025, 0.060, 1.77), (-0.050, 0.105, 1.815), 0.028, "hair.back.L"),
    ((0.025, 0.060, 1.77), (0.050, 0.105, 1.815), 0.028, "hair.back.R"),
    ((0.075, 0.040, 1.76), (0.105, 0.075, 1.805), 0.027, "hair.back.R"),
]
for index, (start, end, radius, bone_name) in enumerate(hair_specs):
    hair_parts.append(weighted(cone_between(f"hair.clump.{index:02d}", start, end, radius, hair), {bone_name: 0.78, "head": 0.22}))
for side in (-1, 1):
    hair_parts.append(weighted(rounded_box("eyebrow", (side * 0.042, -0.105, 1.692), (0.031, 0.006, 0.006), hair, 0.005, rotation=(0, side * math.radians(8), 0)), {"head": 1}))
hair_obj = join_parts("HAIR", hair_parts, character_collection, rig)

export_meshes = [body_obj, eyes_obj, tshirt_obj, shirt_obj, pants_obj, shoes_obj, hair_obj]


# ---------------------------------------------------------------------------
# Baked actions.  They are deliberately compact and loop-safe; the browser can
# blend them and add small procedural head/hair/shirt offsets at runtime.
# ---------------------------------------------------------------------------
rig.animation_data_create()


def reset_pose():
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = "XYZ"
        pose_bone.location = (0, 0, 0)
        pose_bone.rotation_euler = (0, 0, 0)
        pose_bone.scale = (1, 1, 1)


def insert_pose(action, frame, rotations=None, locations=None, scales=None):
    rig.animation_data.action = action
    reset_pose()
    for name, degrees in (rotations or {}).items():
        rig.pose.bones[name].rotation_euler = tuple(math.radians(value) for value in degrees)
    for name, value in (locations or {}).items():
        rig.pose.bones[name].location = value
    for name, value in (scales or {}).items():
        rig.pose.bones[name].scale = value
    for pose_bone in rig.pose.bones:
        pose_bone.keyframe_insert(data_path="location", frame=frame, group=pose_bone.name)
        pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=pose_bone.name)
        pose_bone.keyframe_insert(data_path="scale", frame=frame, group=pose_bone.name)


def new_action(name, end, loop):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    action["clip"] = name
    action["fps"] = FPS
    action["loop"] = bool(loop)
    action["frameEnd"] = end
    return action


actions = {}

idle = new_action("Idle", 60, True)
for frame, breath_value in [(1, 0), (15, 1), (30, 0), (45, -0.7), (60, 0)]:
    actions["Idle"] = idle
    insert_pose(idle, frame, {
        "chest": (breath_value * 0.8, 0, 0),
        "head": (-breath_value * 0.35, 0, breath_value * 0.4),
        "hair.front": (breath_value * 0.6, 0, 0),
        "shirt_flap.L": (breath_value * 0.35, 0, 0.25),
        "shirt_flap.R": (breath_value * 0.35, 0, -0.25),
    }, {"pelvis": (0, 0, abs(breath_value) * 0.002)})


def gait_action(name, end, stride, knee, arm_swing, bob, run=False):
    action = new_action(name, end, True)
    actions[name] = action
    samples = 8
    for index in range(samples + 1):
        frame = 1 + round((end - 1) * index / samples)
        phase = math.tau * index / samples
        swing = math.sin(phase)
        lift_l = max(0.0, -swing)
        lift_r = max(0.0, swing)
        rotations = {
            "pelvis": (0, 0, swing * 3.0),
            "spine.002": (0, 0, -swing * 2.2),
            "head": (0, 0, swing * 0.7),
            "thigh.L": (swing * stride, 0, 0),
            "thigh.R": (-swing * stride, 0, 0),
            "shin.L": (-lift_l * knee, 0, 0),
            "shin.R": (-lift_r * knee, 0, 0),
            "foot.L": (lift_l * 11 - lift_r * 5, 0, 0),
            "foot.R": (lift_r * 11 - lift_l * 5, 0, 0),
            "upper_arm.L": (-swing * arm_swing, 0, 0),
            "upper_arm.R": (swing * arm_swing, 0, 0),
            "forearm.L": (-8 - lift_r * (20 if run else 8), 0, 0),
            "forearm.R": (-8 - lift_l * (20 if run else 8), 0, 0),
            "hair.front": (-swing * (2.2 if run else 0.8), 0, 0),
            "hair.crown": (-abs(swing) * (1.8 if run else 0.5), 0, 0),
            "shirt_flap.L": (swing * (5.0 if run else 2.0), 0, swing * 1.2),
            "shirt_flap.R": (-swing * (5.0 if run else 2.0), 0, swing * 1.2),
        }
        insert_pose(action, frame, rotations, {"pelvis": (0, 0, abs(math.sin(phase * 2)) * bob)})
    return action


gait_action("Walk", 32, 25, 38, 20, 0.014)
gait_action("Run", 24, 43, 62, 36, 0.032, run=True)

flight = new_action("Flight", 48, True)
actions["Flight"] = flight
for frame, wave in [(1, 0), (12, 1), (24, 0), (36, -1), (48, 0)]:
    insert_pose(flight, frame, {
        "root": (78, 0, 0),
        "spine.002": (-5, 0, 0),
        "neck": (18, 0, 0),
        "head": (-12, 0, 0),
        "upper_arm.L": (-12, -66, -8),
        "upper_arm.R": (-12, 66, 8),
        "forearm.L": (-8, 0, 0),
        "forearm.R": (-8, 0, 0),
        "thigh.L": (-10 + wave * 1.5, 0, 2),
        "thigh.R": (-10 - wave * 1.5, 0, -2),
        "shin.L": (12, 0, 0),
        "shin.R": (12, 0, 0),
        "hair.front": (-8 - wave * 2.5, 0, 0),
        "hair.crown": (-6 - wave * 1.5, 0, 0),
        "hair.back.L": (-4 - wave * 2.0, 0, 0),
        "hair.back.R": (-4 - wave * 2.0, 0, 0),
        "shirt_flap.L": (-12 - wave * 4, 0, 3),
        "shirt_flap.R": (-12 - wave * 4, 0, -3),
    })

takeoff = new_action("Takeoff", 30, False)
actions["Takeoff"] = takeoff
for frame, amount in [(1, 0.0), (10, 0.28), (20, 0.7), (30, 1.0)]:
    insert_pose(takeoff, frame, {
        "root": (78 * amount, 0, 0),
        "pelvis": (-7 * amount, 0, 0),
        "upper_arm.L": (-12 * amount, -66 * amount, -8 * amount),
        "upper_arm.R": (-12 * amount, 66 * amount, 8 * amount),
        "thigh.L": (-10 * amount, 0, 2 * amount),
        "thigh.R": (-10 * amount, 0, -2 * amount),
        "shin.L": (12 * amount, 0, 0),
        "shin.R": (12 * amount, 0, 0),
        "hair.front": (-8 * amount, 0, 0),
        "shirt_flap.L": (-12 * amount, 0, 3 * amount),
        "shirt_flap.R": (-12 * amount, 0, -3 * amount),
    }, {"root": (0, 0, amount * 0.06)})

land = new_action("Land", 30, False)
actions["Land"] = land
for frame, amount, crouch in [(1, 1.0, 0), (12, 0.52, 0.25), (20, 0.12, 1.0), (30, 0.0, 0.0)]:
    insert_pose(land, frame, {
        "root": (78 * amount, 0, 0),
        "pelvis": (crouch * 9, 0, 0),
        "spine.001": (-crouch * 11, 0, 0),
        "thigh.L": (-10 * amount - crouch * 34, 0, 2 * amount),
        "thigh.R": (-10 * amount - crouch * 34, 0, -2 * amount),
        "shin.L": (12 * amount + crouch * 54, 0, 0),
        "shin.R": (12 * amount + crouch * 54, 0, 0),
        "upper_arm.L": (-12 * amount + crouch * 18, -66 * amount, -8 * amount),
        "upper_arm.R": (-12 * amount + crouch * 18, 66 * amount, 8 * amount),
        "hair.front": (-8 * amount + crouch * 5, 0, 0),
        "shirt_flap.L": (-12 * amount + crouch * 8, 0, 3 * amount),
        "shirt_flap.R": (-12 * amount + crouch * 8, 0, -3 * amount),
    }, {"pelvis": (0, 0, -crouch * 0.08)})

rig.animation_data.action = idle
scene.frame_set(1)
scene["animationClips"] = json.dumps({name: {
    "start": 1,
    "end": int(action.get("frameEnd", 1)),
    "loop": bool(action.get("loop", False)),
} for name, action in actions.items()})


# Studio-only floor, lighting and camera.
floor_mat = material("MAT_STUDIO_FLOOR", (0.16, 0.17, 0.19), 0.92)
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
floor = bpy.context.object
floor.name = "STUDIO_FLOOR"
floor.data.materials.append(floor_mat)
move_to_collection(floor, stage_collection)

for name, location, energy, color, size in [
    ("Key softbox", (-3.2, -4.0, 5.2), 1150, (1.0, 0.88, 0.76), 3.4),
    ("Fill softbox", (3.5, -2.0, 3.6), 850, (0.66, 0.82, 1.0), 3.0),
    ("Rim softbox", (0.0, 3.2, 4.2), 1250, (0.78, 0.9, 1.0), 2.8),
]:
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.energy = energy
    light_data.color = color
    light_data.shape = "DISK"
    light_data.size = size
    light_obj = bpy.data.objects.new(name, light_data)
    stage_collection.objects.link(light_obj)
    light_obj.location = location
    light_obj.rotation_euler = (Vector((0, 0, 1.0)) - light_obj.location).to_track_quat("-Z", "Y").to_euler()

camera_data = bpy.data.cameras.new("Free Flyer Studio Camera")
camera = bpy.data.objects.new("Free Flyer Studio Camera", camera_data)
stage_collection.objects.link(camera)
camera.location = (1.70, -4.70, 1.72)
camera.rotation_euler = (Vector((0, 0, 0.94)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.lens = 60
scene.camera = camera
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 720
scene.render.resolution_y = 960
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.filepath = str(PREVIEW_PATH)
scene.view_settings.look = "AgX - Medium High Contrast"

notes = bpy.data.texts.new("READ ME | Free Flyer Studio")
notes.write(
    "FREE FLYER CIVILIAN CHARACTER\n\n"
    "Real-world scale: 1 unit = 1 metre; authored height about 1.82 m.\n"
    "Named export meshes: BODY, EYES, TSHIRT_WHITE, SHIRT_BLUE, "
    "PANTS_BROWN, SHOES_WHITE, HAIR.\n"
    "RIG_DEFORM contains semantic limbs, twist bones, fingers, head/neck, "
    "hair springs and two open-shirt flap bones.\n"
    "Actions: Idle, Walk, Run, Flight, Takeoff, Land.\n"
    "The browser may layer small procedural offsets onto hair.* and "
    "shirt_flap.*; stiffness/damping defaults are stored on those bones.\n"
    "The source is generated locally and no publication is performed.\n"
)


# Validate the editable scene before writing either deliverable.
required_meshes = {"BODY", "EYES", "TSHIRT_WHITE", "SHIRT_BLUE", "PANTS_BROWN", "SHOES_WHITE", "HAIR"}
required_actions = {"Idle", "Walk", "Run", "Flight", "Takeoff", "Land"}
required_bones = {
    "root", "pelvis", "spine.001", "spine.002", "chest", "neck", "head",
    "upper_arm.L", "forearm.L", "hand.L", "upper_arm.R", "forearm.R", "hand.R",
    "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R",
    "hair.front", "hair.crown", "hair.back.L", "hair.back.R", "shirt_flap.L", "shirt_flap.R",
}
if {obj.name for obj in export_meshes} != required_meshes:
    raise RuntimeError("Export mesh names do not match the required contract")
if not required_actions.issubset({action.name for action in bpy.data.actions}):
    raise RuntimeError("One or more required animation clips are missing")
if not required_bones.issubset(set(armature.bones.keys())):
    raise RuntimeError("One or more required deformation bones are missing")
for obj in export_meshes:
    if not any(mod.type == "ARMATURE" and mod.object == rig for mod in obj.modifiers):
        raise RuntimeError(f"{obj.name} is not bound to RIG_DEFORM")
    if any(not vertex.groups for vertex in obj.data.vertices):
        raise RuntimeError(f"{obj.name} contains unweighted vertices")

points = [obj.matrix_world @ Vector(corner) for obj in export_meshes for corner in obj.bound_box]
lower = Vector(tuple(min(point[index] for point in points) for index in range(3)))
upper = Vector(tuple(max(point[index] for point in points) for index in range(3)))
bounds = upper - lower
if not (1.75 <= bounds.z <= 1.90):
    raise RuntimeError(f"Unexpected character height: {bounds.z:.4f} m")

for obj in export_meshes:
    obj.data.calc_loop_triangles()
vertex_count = sum(len(obj.data.vertices) for obj in export_meshes)
triangle_count = sum(len(obj.data.loop_triangles) for obj in export_meshes)
if triangle_count > 45000:
    raise RuntimeError(f"Web geometry budget exceeded: {triangle_count} triangles")

STUDIO_PATH.parent.mkdir(parents=True, exist_ok=True)
GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.file.pack_all()
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(STUDIO_PATH))

activate(rig)
for obj in export_meshes:
    obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(GLB_PATH),
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=False,
    export_materials="EXPORT",
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_cameras=False,
    export_lights=False,
    export_extras=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_def_bones=True,
    export_leaf_bone=False,
    export_optimize_animation_size=True,
    export_skins=True,
    export_all_influences=False,
    export_morph=False,
)

if "--no-render" not in sys.argv:
    rig.animation_data.action = idle
    scene.frame_set(1)
    bpy.ops.render.render(write_still=True)

report = {
    "blend": STUDIO_PATH.relative_to(ROOT).as_posix(),
    "glb": GLB_PATH.relative_to(ROOT).as_posix(),
    "preview": PREVIEW_PATH.relative_to(ROOT).as_posix(),
    "declaredHeightMeters": CHARACTER_HEIGHT,
    "measuredBoundsMeters": {
        "x": round(bounds.x, 5),
        "y": round(bounds.y, 5),
        "z": round(bounds.z, 5),
        "minZ": round(lower.z, 5),
        "maxZ": round(upper.z, 5),
    },
    "vertices": vertex_count,
    "triangles": triangle_count,
    "meshNames": sorted(required_meshes),
    "boneCount": len(armature.bones),
    "bones": [bone.name for bone in armature.bones],
    "actions": [{
        "name": name,
        "start": 1,
        "end": int(action.get("frameEnd", 1)),
        "loop": bool(action.get("loop", False)),
    } for name, action in actions.items()],
    "secondaryMotionBones": [
        "hair.front", "hair.crown", "hair.back.L", "hair.back.R",
        "shirt_flap.L", "shirt_flap.R",
    ],
    "glbBytes": GLB_PATH.stat().st_size,
}
REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
print("FREE_FLYER_BUILD_OK")
print(json.dumps(report, indent=2))
