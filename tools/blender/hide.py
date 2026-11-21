"""An animal's hide at game size: its mesh and the two maps its fur is baked into, from the sculpt tools/comfyui made.

    Blender -b --factory-startup -P hide.py -- <sculpt.glb> tools/blender/kit-hide.glb 0.58 15000 [turn]

The sculpt (about 700,000 triangles, standing in ComfyUI's unit cube, nose towards -Y) is scaled until it is the
given length in metres from nose to tail tip, set with its feet on the ground, cut down to the given number of
triangles that keep its UVs, and its colour and the relief the cut took away are baked from the sculpt into two maps
of SIZE px. Run again only for another size or triangle count: the animal's own script (kit.py) works from the result.

With "turn" as a fifth word the sculpt is first turned to face -Y: one made from a single picture stands as that
picture saw it, not nose first. Its trunk's length (the upper half of it, without legs and tail) gives the line, the
end with its highest part (the head) the front, and it is set with its trunk's middle on x = 0.
"""
import math
import sys

import bpy
import numpy as np
from mathutils import Vector

source, out, length, triangles, *turn = sys.argv[sys.argv.index("--")+1:]
SIZE = 2048

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
scene = bpy.context.scene
high = next(o for o in scene.objects if o.type == "MESH")
bpy.ops.object.select_all(action="DESELECT")
high.select_set(True)
bpy.context.view_layer.objects.active = high
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if turn:
    at = np.array([v.co for v in high.data.vertices])
    low, top = at[:, 2].min(), at[:, 2].max()
    upper = at[at[:, 2] > low+.5*(top-low)]
    middle = upper[:, :2].mean(axis=0)
    line = np.linalg.eigh(np.cov((upper[:, :2]-middle).T))[1][:, -1]  # the trunk's long way
    head = at[at[:, 2] > low+.85*(top-low)][:, :2].mean(axis=0)-middle
    if head @ line < 0:
        line = -line
    high.location.x, high.location.y = -middle[0], -middle[1]
    bpy.ops.object.transform_apply(location=True)
    high.rotation_mode = "XYZ"  # a glb's objects turn by quaternion: the angle below would do nothing
    high.rotation_euler.z = -math.pi/2-math.atan2(line[1], line[0])
    print("hide: turned", round(math.degrees(high.rotation_euler.z)), "degrees")
    bpy.ops.object.transform_apply(rotation=True)
corners = [Vector(c) for c in high.bound_box]
high.scale = (float(length)/(max(c.y for c in corners)-min(c.y for c in corners)),)*3
bpy.ops.object.transform_apply(scale=True)
high.location.z = -min(Vector(c).z for c in high.bound_box)
bpy.ops.object.transform_apply(location=True)

bpy.ops.object.duplicate()
low = bpy.context.object
low.name = "Hide"
# A glb holds a vertex once for every patch of the map it lies on: one skin first, or the cut tears it there.
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-6)
bpy.ops.object.mode_set(mode="OBJECT")
cut = low.modifiers.new("Game size", "DECIMATE")
cut.ratio = int(triangles)/len(low.data.polygons)
cut.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=cut.name)
for face in low.data.polygons:
    face.use_smooth = True

mat = bpy.data.materials.new("Coat")
mat.use_nodes = True
mat.use_backface_culling = True
tree = mat.node_tree
bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Roughness"].default_value = .85
low.data.materials.clear()
low.data.materials.append(mat)
scene.render.engine = "CYCLES"
scene.cycles.samples = 1
bake = scene.render.bake
reach = float(length)*.012
bake.use_selected_to_active, bake.cage_extrusion, bake.max_ray_distance, bake.margin = True, reach, reach*3, 12
bpy.ops.object.select_all(action="DESELECT")
high.select_set(True)
low.select_set(True)
bpy.context.view_layer.objects.active = low
maps = {}
for name, kind, options in (("Coat colour", "DIFFUSE", {"pass_filter": {"COLOR"}}), ("Coat relief", "NORMAL", {})):
    image = bpy.data.images.new(name, SIZE, SIZE, alpha=False)
    if kind == "NORMAL":
        image.colorspace_settings.name = "Non-Color"
    maps[kind] = tree.nodes.new("ShaderNodeTexImage")
    maps[kind].image = image
    tree.nodes.active = maps[kind]
    bpy.ops.object.bake(type=kind, **options)
    image.pack()
tree.links.new(maps["DIFFUSE"].outputs["Color"], bsdf.inputs["Base Color"])
relief = tree.nodes.new("ShaderNodeNormalMap")
tree.links.new(maps["NORMAL"].outputs["Color"], relief.inputs["Color"])
tree.links.new(relief.outputs["Normal"], bsdf.inputs["Normal"])

bpy.ops.object.select_all(action="DESELECT")
low.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_format="GLB", export_animations=False,
                          export_image_format="WEBP", export_image_quality=90)
print("hide:", len(low.data.polygons), "triangles,", [round(d, 3) for d in low.dimensions], "m")
