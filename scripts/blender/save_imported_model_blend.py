"""Save an editable Blender project from a local GLB, keeping embedded images.

Run Blender with ``-- <input.glb> <output.blend>``.  The imported source is
preserved as a mesh with its UV map, materials, and optional marker empties.
"""

import sys
from pathlib import Path

import bpy


asset = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
output = Path(sys.argv[sys.argv.index("--") + 2]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(asset))
mesh = next(obj for obj in bpy.data.objects if obj.type == "MESH")
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.file.pack_all()
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(output))
print("BLEND_SAVED=" + str(output))
