"""Re-import and validate the generated Free Flight GLB in a clean Blender scene."""

import bpy
import json
from pathlib import Path
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
GLB_PATH = ROOT / "public/models/free-flyer.glb"
REPORT_PATH = ROOT / "art/previews/free-flyer-glb-validation.json"
FPS = 30
REQUIRED_MESHES = {
    "BODY", "EYES", "TSHIRT_WHITE", "SHIRT_BLUE",
    "PANTS_BROWN", "SHOES_WHITE", "HAIR",
}
REQUIRED_ACTIONS = {"Idle", "Walk", "Run", "Flight", "Takeoff", "Land"}
REQUIRED_BONES = {
    "root", "pelvis", "spine.001", "spine.002", "chest", "neck", "head",
    "upper_arm.L", "forearm.L", "hand.L", "upper_arm.R", "forearm.R", "hand.R",
    "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R",
    "hair.front", "hair.crown", "hair.back.L", "hair.back.R",
    "shirt_flap.L", "shirt_flap.R",
}


if not GLB_PATH.is_file():
    raise FileNotFoundError(GLB_PATH)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
bpy.context.view_layer.update()

armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
if len(armatures) != 1:
    raise RuntimeError(f"Expected one armature, found {len(armatures)}")
rig = armatures[0]
meshes = sorted((
    obj for obj in bpy.context.scene.objects
    if obj.type == "MESH" and any(
        modifier.type == "ARMATURE" and modifier.object == rig
        for modifier in obj.modifiers
    )
), key=lambda item: item.name)

mesh_names = {obj.name for obj in meshes}
if mesh_names != REQUIRED_MESHES:
    raise RuntimeError(f"Unexpected GLB mesh names: {sorted(mesh_names)}")

bone_names = set(rig.data.bones.keys())
missing_bones = REQUIRED_BONES - bone_names
if missing_bones:
    raise RuntimeError(f"Missing GLB bones: {sorted(missing_bones)}")

action_names = {action.name for action in bpy.data.actions}
missing_actions = REQUIRED_ACTIONS - action_names
if missing_actions:
    raise RuntimeError(f"Missing GLB actions: {sorted(missing_actions)}")

skinned = []
for obj in meshes:
    modifiers = [mod for mod in obj.modifiers if mod.type == "ARMATURE" and mod.object == rig]
    if not modifiers:
        raise RuntimeError(f"{obj.name} was not re-imported as a skinned mesh")
    if not obj.vertex_groups:
        raise RuntimeError(f"{obj.name} has no skin weights")
    skinned.append(obj.name)

points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
lower = Vector(tuple(min(point[index] for point in points) for index in range(3)))
upper = Vector(tuple(max(point[index] for point in points) for index in range(3)))
bounds = upper - lower
if not (1.75 <= bounds.y <= 1.90):
    # glTF is Y-up after Blender's coordinate conversion.
    raise RuntimeError(f"Unexpected imported GLB height: {bounds.y:.5f} m")

for obj in meshes:
    obj.data.calc_loop_triangles()

report = {
    "file": GLB_PATH.relative_to(ROOT).as_posix(),
    "bytes": GLB_PATH.stat().st_size,
    "sceneRoots": sorted(obj.name for obj in bpy.context.scene.collection.objects),
    "armature": rig.name,
    "skinnedMeshes": skinned,
    "meshCount": len(meshes),
    "vertices": sum(len(obj.data.vertices) for obj in meshes),
    "triangles": sum(len(obj.data.loop_triangles) for obj in meshes),
    "boneCount": len(rig.data.bones),
    "bones": [bone.name for bone in rig.data.bones],
    "actions": sorted({
        action.name: {
            "start": round(action.frame_range[0], 3),
            "end": round(action.frame_range[1], 3),
        }
        for action in bpy.data.actions
    }.items()),
    "boundsMeters": {
        "x": round(bounds.x, 5),
        "y": round(bounds.y, 5),
        "z": round(bounds.z, 5),
    },
    "materials": sorted({material.name for obj in meshes for material in obj.data.materials}),
}
REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
print("FREE_FLYER_GLB_VALIDATION_OK")
print(json.dumps(report, indent=2))
