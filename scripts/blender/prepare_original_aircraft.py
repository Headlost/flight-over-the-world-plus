"""Prepare locally supplied replacement aircraft for the browser game.

Run Blender with ``-- <key> <input.glb> <output.glb>``.  The input is never
changed.  Source meshes have baked propellers, so only their disconnected
blade islands are removed and explicit hub locators are exported; runtime draws and
spins independent blades on those locators.  Jet outlets receive locators too.
"""

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector


CONFIG = {
    "airbus-a380": {
        "span": 80.0,
        "jets": [(-0.242, -0.102, 0.040, 0.023, 1),
                 (0.242, -0.102, 0.040, 0.023, 1),
                 (-0.373, 0.022, 0.040, 0.021, 1),
                 (0.373, 0.022, 0.040, 0.021, 1)],
    },
    "boeing-737-800": {
        "span": 40.0,
        "jets": [(-0.161, -0.085, 0.030, 0.028, 1),
                 (0.161, -0.085, 0.030, 0.028, 1)],
    },
    "northrop-grumman-b-2-spirit": {
        "span": 52.4,
        "jets": [(-0.10, 0.123, 0.054, 0.037, 0.15),
                 (0.10, 0.123, 0.054, 0.037, 0.15)],
    },
    "lockheed-ac-130-hercules": {
        "span": 40.4,
        "triangles": 300_000,
        "blade_count": 4,
        "props": [(x, -0.156, 0.161, 0.077) for x in
                  (-0.358, -0.178, 0.178, 0.358)],
        "prop_min_y": -0.135,
        "prop_max_y": -0.12,
        "prop_depth": 0.055,
    },
    "mooney-m20m": {
        "span": 11.0,
        "triangles": 300_000,
        "blade_count": 3,
        "props": [(0.0, -0.367, 0.192, 0.139)],
        "prop_min_y": -0.30,
        "prop_max_y": -0.27,
        "prop_depth": 0.12,
    },
}


def triangle_count(obj):
    return sum(len(face.vertices) - 2 for face in obj.data.polygons)


def remove_mooney_duplicate_tail(obj):
    """Drop the detached, lower second horizontal tail, keeping the upper one.

    The supplied Mooney has two stacked tailplanes.  The lower plane is made of
    separate mesh islands, so removing complete islands preserves the fuselage
    and upper stabilizer instead of leaving the torn edges caused by face cuts.
    Coordinates here are in the untouched source asset's metre-sized frame.
    """
    mesh = obj.data
    editable = bmesh.new()
    editable.from_mesh(mesh)
    seen = set()
    lower_tail = []
    removed_islands = []
    for vertex in editable.verts:
        if vertex in seen:
            continue
        stack = [vertex]
        seen.add(vertex)
        island = []
        while stack:
            current = stack.pop()
            island.append(current)
            for edge in current.link_edges:
                other = edge.other_vert(current)
                if other not in seen:
                    seen.add(other)
                    stack.append(other)
        if len(island) < 3:
            continue
        points = [obj.matrix_world @ vert.co for vert in island]
        lo = [min(point[axis] for point in points) for axis in range(3)]
        hi = [max(point[axis] for point in points) for axis in range(3)]
        reaches_tailplane = (hi[0] - lo[0] > 0.08
                             or lo[0] < -0.10 or hi[0] > 0.10)
        central_lower_fragment = lo[1] > 0.33 and lo[2] < 0.07 and hi[2] < 0.10
        if (lo[1] > 0.13 and hi[1] > 0.32 and lo[2] > 0.015
                and ((reaches_tailplane and hi[2] < 0.07)
                     or central_lower_fragment)):
            lower_tail.extend(island)
            removed_islands.append((len(island), tuple(round(x, 4) for x in lo),
                                    tuple(round(x, 4) for x in hi)))
    removed_faces = len({face for vert in lower_tail for face in vert.link_faces})
    if lower_tail:
        bmesh.ops.delete(editable, geom=lower_tail, context="VERTS")
    editable.to_mesh(mesh)
    editable.free()
    mesh.update()
    print("MOONEY_LOWER_TAIL_ISLANDS=" + json.dumps(removed_islands))
    return removed_faces, len(lower_tail)


def paint_mooney_albedo(image):
    """Inpaint only the supplied texture's inscriptions and wing-top badges.

    Coordinates refer to its 1024-pixel atlas, regardless of export size.  The
    UV layout and all surrounding livery remain unchanged.  We remove ink via
    diffusion from neighbouring pixels; the two wing badges are entirely
    replaced with the adjacent cream paint rather than left as pale ghosts.
    """
    width, height = image.size
    rgba = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(rgba)
    pixels = rgba.reshape((height, width, 4))[::-1]
    ratio = width / 1024

    def repair(box, ellipse=None, iterations=160):
        x0, y0, x1, y1 = [round(value * ratio) for value in box]
        area = pixels[y0:y1, x0:x1, :3]
        if not area.size:
            return 0
        yy, xx = np.mgrid[y0:y1, x0:x1]
        if ellipse:
            cx, cy, rx, ry = ellipse
            mask = (((xx / ratio - cx) / rx) ** 2
                    + ((yy / ratio - cy) / ry) ** 2) < 1
        else:
            dark = area.mean(axis=2) < 0.53
            gold = ((area[:, :, 0] > area[:, :, 1] * 1.19)
                    & (area[:, :, 1] > area[:, :, 2] * 1.16))
            mask = dark & ~gold
            for _ in range(max(1, round(1.5 * ratio))):
                grown = mask.copy()
                grown[1:] |= mask[:-1]
                grown[:-1] |= mask[1:]
                grown[:, 1:] |= mask[:, :-1]
                grown[:, :-1] |= mask[:, 1:]
                mask = grown
        if not mask.any():
            return 0
        work = area.copy()
        boundary = area[~mask]
        work[mask] = np.median(boundary, axis=0) if len(boundary) else (0.82, 0.79, 0.72)
        for _ in range(iterations):
            padded = np.pad(work, ((1, 1), (1, 1), (0, 0)), mode="edge")
            average = (padded[:-2, 1:-1] + padded[2:, 1:-1]
                       + padded[1:-1, :-2] + padded[1:-1, 2:]) * 0.25
            work[mask] = average[mask]
        area[mask] = work[mask]
        return int(mask.sum())

    count = 0
    # Mirrored fuselage markings and tail-side fragments in the supplied atlas.
    for box in ((67, 0, 145, 70), (140, 24, 161, 65),
                (73, 674, 179, 740), (178, 683, 192, 735),
                (840, 210, 893, 302), (709, 922, 789, 985)):
        count += repair(box)
    # A fifth isolated glyph sits on a separate UV island near the tail stripe.
    count += repair((890, 568, 929, 611))
    # Two weathered black badges in the upper wing surfaces.
    count += repair((122, 450, 202, 523), (163, 486, 39, 35), 360)
    count += repair((516, 99, 604, 187), (560, 142, 43, 42), 360)
    count += repair((333, 545, 415, 617), (375, 581, 39, 34), 360)
    image.pixels.foreach_set(rgba)
    image.update()
    return count


def paint_hercules_tail_albedo(image):
    """Retouch red tail decals while preserving the actual navigation lights.

    The supplied atlas has two large tailplane discs, two detached slivers
    reaching the same top surfaces through separate UV islands, and an emblem
    on each side of the vertical fin.  Do not touch the wing insignia or the
    red light at the tail tip.  Coordinates track the original 2048 atlas.
    """
    width, height = image.size
    if width != height:
        raise ValueError("Hercules albedo atlas must be square")
    rgba = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(rgba)
    pixels = rgba.reshape((height, width, 4))[::-1]
    ratio = width / 2048
    painted = 0
    olive_colors = []
    for cx_source, cy_source in ((238, 1562), (1570, 1616)):
        cx, cy = cx_source * ratio, cy_source * ratio
        outer = round(64 * ratio)
        x0, y0 = max(0, int(cx) - outer), max(0, int(cy) - outer)
        x1, y1 = min(width, int(cx) + outer + 1), min(height, int(cy) + outer + 1)
        area = pixels[y0:y1, x0:x1, :3]
        yy, xx = np.mgrid[y0:y1, x0:x1]
        radius = np.hypot(xx - cx, yy - cy)
        ring = (radius >= 49 * ratio) & (radius <= 61 * ratio)
        # Discard nearby metal, trim and red pixels: only the olive tail skin
        # should contribute to the replacement color.
        ring &= ((area[:, :, 1] > area[:, :, 0] * 1.035)
                 & (area[:, :, 1] > area[:, :, 2] * 1.10)
                 & (area[:, :, 1] > 0.065))
        if ring.sum() < 32 * ratio * ratio:
            raise ValueError("Could not sample Hercules tail's green texture")
        olive = np.median(area[ring], axis=0)
        olive_colors.append(olive)
        blend = np.clip((48 * ratio - radius) / (3 * ratio), 0, 1)
        active = blend > 0
        area[active] = (area[active] * (1 - blend[active, None])
                        + olive * blend[active, None])
        painted += int(np.count_nonzero(active))
        print("HERCULES_TAIL_OLIVE=" + json.dumps({
            "center": [cx_source, cy_source],
            "color": [round(float(channel), 4) for channel in olive],
            "sample_pixels": int(ring.sum()),
        }))

    # The source atlas also puts red fragments on two unrelated small UV
    # islands sampled by the upper horizontal stabilizers.  Keep these masks
    # confined to the middle of the tail, away from the red tip light.
    for cx_source, cy_source, rx_source, ry_source, olive_index in (
            (585, 1807, 34, 24, 0),
            (143, 990, 27, 37, 1),
            (269, 1657, 13, 20, 1),
            (157, 958, 14, 17, 1)):
        cx, cy = cx_source * ratio, cy_source * ratio
        rx, ry = rx_source * ratio, ry_source * ratio
        x0, y0 = max(0, int(cx - rx - 2)), max(0, int(cy - ry - 2))
        x1, y1 = min(width, int(cx + rx + 3)), min(height, int(cy + ry + 3))
        area = pixels[y0:y1, x0:x1, :3]
        yy, xx = np.mgrid[y0:y1, x0:x1]
        distance = np.hypot((xx - cx) / rx, (yy - cy) / ry)
        blend = np.clip((1.0 - distance) / 0.08, 0, 1)
        active = blend > 0
        olive = olive_colors[olive_index]
        area[active] = (area[active] * (1 - blend[active, None])
                        + olive * blend[active, None])
        painted += int(np.count_nonzero(active))

    # Red badges on both white sides of the vertical fin appear as a smeared
    # stripe from the overhead camera.  Diffuse the neighbouring white fin
    # paint across just those rectangular decals; black artwork and the real
    # red navigation lamp remain unchanged.
    for x0_source, y0_source, x1_source, y1_source in (
            (1161, 423, 1214, 489),
            (1175, 905, 1227, 970)):
        border = max(4, round(8 * ratio))
        x0, y0 = round(x0_source * ratio), round(y0_source * ratio)
        x1, y1 = round(x1_source * ratio), round(y1_source * ratio)
        area = pixels[y0 - border:y1 + border,
                      x0 - border:x1 + border, :3]
        mask = np.zeros(area.shape[:2], dtype=bool)
        mask[border:border + y1 - y0, border:border + x1 - x0] = True
        work = area.copy()
        outside = area[~mask]
        neutral = outside[(outside.min(axis=1) > 0.32)
                          & ((outside.max(axis=1) - outside.min(axis=1)) < 0.18)]
        if len(neutral) < 16:
            raise ValueError("Could not sample white Hercules fin paint")
        work[mask] = np.median(neutral, axis=0)
        for _ in range(260):
            padded = np.pad(work, ((1, 1), (1, 1), (0, 0)), mode="edge")
            average = (padded[:-2, 1:-1] + padded[2:, 1:-1]
                       + padded[1:-1, :-2] + padded[1:-1, 2:]) * 0.25
            work[mask] = average[mask]
        area[mask] = work[mask]
        painted += int(mask.sum())

    # Small UV-edge contamination on the mid-fin (well below the red top
    # lamp) still shows as red flecks from above.  Inpaint only red pixels and
    # a narrow antialias fringe, retaining the white/green surface and lines.
    for bx0, by0, bx1, by1 in (
            (350, 55, 381, 86),
            (409, 1719, 445, 1759),
            (1428, 847, 1464, 884),
            (1314, 1091, 1341, 1122),
            (1074, 412, 1101, 434),
            (1067, 425, 1102, 519),
            (1966, 1435, 1993, 1543),
            (250, 88, 307, 115),
            (427, 2014, 453, 2041),
            (431, 243, 453, 265)):
        x0, y0 = round(bx0 * ratio), round(by0 * ratio)
        x1, y1 = round(bx1 * ratio), round(by1 * ratio)
        area = pixels[y0:y1, x0:x1, :3]
        red = ((area[:, :, 0] > area[:, :, 1] * 1.42)
               & (area[:, :, 0] > area[:, :, 2] * 1.42)
               & (area[:, :, 0] > 0.18))
        mask = red.copy()
        for _ in range(max(2, round(3 * ratio))):
            grown = mask.copy()
            grown[1:] |= mask[:-1]
            grown[:-1] |= mask[1:]
            grown[:, 1:] |= mask[:, :-1]
            grown[:, :-1] |= mask[:, 1:]
            mask = grown
        if not mask.any():
            continue
        work = area.copy()
        work[mask] = np.median(area[~mask], axis=0)
        for _ in range(90):
            padded = np.pad(work, ((1, 1), (1, 1), (0, 0)), mode="edge")
            average = (padded[:-2, 1:-1] + padded[2:, 1:-1]
                       + padded[1:-1, :-2] + padded[1:-1, 2:]) * 0.25
            work[mask] = average[mask]
        area[mask] = work[mask]
        painted += int(mask.sum())
    image.pixels.foreach_set(rgba)
    image.update()
    return painted


def finish_mooney_wingtips(obj):
    """Replace black outer caps with rounded golden-yellow painted tips."""
    yellow = bpy.data.materials.new("Mooney rounded golden-yellow wingtips")
    yellow.use_nodes = True
    shader = yellow.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (0.96, 0.67, 0.06, 1)
    shader.inputs["Metallic"].default_value = 0.12
    shader.inputs["Roughness"].default_value = 0.38
    obj.data.materials.append(yellow)
    index = len(obj.data.materials) - 1
    painted = 0
    for face in obj.data.polygons:
        point = obj.matrix_world @ face.center
        if (abs(point.x) > 0.50 and -0.19 < point.y < 0.07
                and 0.065 < point.z < 0.19):
            face.material_index = index
            painted += 1
    return painted


def cut_baked_props(obj, config):
    """Remove whole detached blades, never slice faces from the airframe."""
    if not config.get("props"):
        return 0, 0
    mesh = obj.data
    editable = bmesh.new()
    editable.from_mesh(mesh)
    blades = []
    seen = set()
    for vertex in editable.verts:
        if vertex in seen:
            continue
        stack = [vertex]
        seen.add(vertex)
        island = []
        while stack:
            current = stack.pop()
            island.append(current)
            for edge in current.link_edges:
                other = edge.other_vert(current)
                if other not in seen:
                    seen.add(other)
                    stack.append(other)
        points = [obj.matrix_world @ vert.co for vert in island]
        lo = [min(point[axis] for point in points) for axis in range(3)]
        hi = [max(point[axis] for point in points) for axis in range(3)]
        center = [(lo[axis] + hi[axis]) / 2 for axis in range(3)]
        if not (lo[1] < config["prop_min_y"]
                and hi[1] < config["prop_max_y"]
                and hi[1] - lo[1] < config["prop_depth"]):
            continue
        for x, _, z, radius in config["props"]:
            radial = [math.hypot(point.x - x, point.z - z) for point in points]
            if (math.hypot(center[0] - x, center[2] - z) < radius * 1.25
                    and max(radial) > radius * 0.58
                    and max(radial) < radius * 1.5
                    and hi[0] - lo[0] < radius * 2.3
                    and hi[2] - lo[2] < radius * 2.3):
                blades.extend(island)
                break
    removed_faces = len({face for vert in blades for face in vert.link_faces})
    if blades:
        bmesh.ops.delete(editable, geom=blades, context="VERTS")
    editable.to_mesh(mesh)
    editable.free()
    mesh.update()
    return removed_faces, len(blades)


args = sys.argv[sys.argv.index("--") + 1:]
key, source, destination = args[0], Path(args[1]).resolve(), Path(args[2]).resolve()
config = CONFIG[key]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes = [obj for obj in bpy.data.objects if obj.type == "MESH" and not obj.hide_render]
if len(meshes) != 1:
    raise ValueError(f"Expected one source mesh, got {len(meshes)}")
obj = meshes[0]
bpy.context.view_layer.update()
source_matrix = obj.matrix_world.copy()
tail_faces, tail_vertices = remove_mooney_duplicate_tail(obj) if key == "mooney-m20m" else (0, 0)
removed, fragments = (0, 0) if "--keep-props" in args else cut_baked_props(obj, config)
wingtip_faces = finish_mooney_wingtips(obj) if key == "mooney-m20m" else 0

# All five new source files have their noses along -Y.  Rotate to Blender +Y
# so GLTFLoader sees -Z forward.  Normalize once, preserving locator precision.
rotation = Matrix.Rotation(math.pi, 4, "Z")
corners = [rotation @ source_matrix @ Vector(corner) for corner in obj.bound_box]
lower = Vector(min(point[axis] for point in corners) for axis in range(3))
upper = Vector(max(point[axis] for point in corners) for axis in range(3))
size = upper - lower
scale = config["span"] / size.x
centre = (lower + upper) / 2
transform = Matrix.Scale(scale, 4) @ Matrix.Translation(-centre) @ rotation
obj.parent = None
obj.matrix_world = transform @ source_matrix
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
obj.name = key + "-airframe"

for prefix, entries in (("PROP_HUB", config.get("props", [])),
                        ("EXHAUST_NOZZLE", config.get("jets", []))):
    for index, entry in enumerate(entries, 1):
        x, y, z, radius, *rest = entry
        marker = bpy.data.objects.new(f"{prefix}_{index}", None)
        bpy.context.scene.collection.objects.link(marker)
        marker.location = transform @ Vector((x, y, z))
        marker["radius"] = radius * scale
        if prefix == "PROP_HUB":
            marker["blades"] = config["blade_count"]
        if rest:
            marker["height"] = rest[0]
        marker.empty_display_size = radius * scale

before = triangle_count(obj)
budget = config.get("triangles", 120_000)
if before > budget:
    modifier = obj.modifiers.new("Browser triangle budget", "DECIMATE")
    modifier.ratio = budget / before
    bpy.ops.object.modifier_apply(modifier=modifier.name)

repainted_pixels = 0
hercules_tail_pixels = 0
for image in bpy.data.images:
    if image.source != "FILE" or min(image.size) <= 0:
        continue
    width, height = image.size
    ratio = min(1, 2048 / max(width, height))
    if ratio < 1:
        image.scale(round(width * ratio), round(height * ratio))
    if key == "mooney-m20m" and image.name == "texture_pbr_20250901":
        repainted_pixels = paint_mooney_albedo(image)
    if key == "lockheed-ac-130-hercules" and image.name == "texture_pbr_20250901":
        hercules_tail_pixels = paint_hercules_tail_albedo(image)
    image.pack()

bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
for marker in bpy.data.objects:
    if marker.type == "EMPTY" and marker.name.startswith(("PROP_HUB_", "EXHAUST_NOZZLE_")):
        marker.select_set(True)
bpy.context.view_layer.objects.active = obj
destination.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(destination), export_format="GLB", use_selection=True,
    export_animations=False, export_materials="EXPORT",
    export_texcoords=True, export_normals=True, export_extras=True,
)
print("PREPARED=" + json.dumps({
    "key": key, "output": str(destination), "bytes": destination.stat().st_size,
    "source_triangles": before, "triangles": triangle_count(obj),
    "removed_prop_faces": removed, "scale": scale,
    "removed_prop_fragment_vertices": fragments,
    "removed_duplicate_tail_faces": tail_faces,
    "removed_duplicate_tail_vertices": tail_vertices,
    "repainted_albedo_pixels": repainted_pixels,
    "yellow_wingtip_faces": wingtip_faces,
    "green_hercules_tail_pixels": hercules_tail_pixels,
    "markers": len(config.get("props", [])) + len(config.get("jets", [])),
}))
