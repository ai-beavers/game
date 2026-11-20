"""Paints our pictures of the animal onto the model ComfyUI made of it.

    Blender -b --factory-startup -P paint.py -- river-kit ~/dev/3d-gen/ComfyUI

Reads ComfyUI's newest output/3d/<name>_*.glb and the four views views.py left in its input folder
(<name>-front-rgba.png and so on), and writes output/3d/<name>-painted.glb: the same mesh with a new colour map.

Why: the model's own colour is its weakest part (eyes as dark blotches, a smeared muzzle, streaks on the flanks),
while its shape follows the pictures closely. The model stands in the frame of the workflow's cameras (front at -Y,
20 degrees wide, the unit cube 1/1.1 of the frame: comfy_extras/nodes_trellis2.py), so each picture is projected back
onto it through the camera it was read with. A picture counts on a surface the more squarely its camera looks at it
(the cosine to the power POWER); where no camera looks, on the belly and along the top of the back, the model's own
colour stays (it weighs OWN everywhere).

shortcut: a picture also lands on surface its camera faces but cannot see (the far legs' inner sides get the near
legs' picture). Fur on fur, not seen in play; cast rays for what a camera really sees if an animal shows it.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

name, comfy = sys.argv[sys.argv.index("--")+1:][:2]
comfy = Path(comfy).expanduser()
model = max((comfy / "output" / "3d").glob(f"{name}_*.glb"), key=lambda f: f.stat().st_mtime)
FOV, PAD, SIZE, POWER, OWN = math.radians(20), 1.1, 4096, 3.0, .04

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(model))
scene = bpy.context.scene
body = next(o for o in scene.objects if o.type == "MESH")
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
own_uv = body.data.uv_layers.active.name
tree = body.data.materials[0].node_tree
nodes, link = tree.nodes, tree.links.new
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
surface = nodes.new("ShaderNodeNewGeometry")


def number(operation, a, b):
    node = nodes.new("ShaderNodeMath")
    node.operation = operation
    for socket, value in zip(node.inputs, (a, b)):
        if isinstance(value, (int, float)):
            socket.default_value = value
        else:
            link(value, socket)
    return node.outputs[0]


def vector(operation, a, b=None, scale=None):
    node = nodes.new("ShaderNodeVectorMath")
    node.operation = operation
    for socket, value in ((node.inputs[0], a), (node.inputs[1], b), (node.inputs[3], scale)):
        if isinstance(value, Vector):
            socket.default_value = value
        elif value is not None:
            link(value, socket)
    return node.outputs["Value" if operation == "DOT_PRODUCT" else "Vector"]


own = nodes.new("ShaderNodeValue")
own.outputs[0].default_value = OWN
colour, weights = vector("SCALE", bsdf.inputs["Base Color"].links[0].from_socket, scale=own.outputs[0]), own.outputs[0]
distance = PAD*.5/math.tan(FOV/2)
for view, azimuth in (("front", 0), ("left", 90), ("back", 180), ("right", 270)):
    behind = Vector((math.sin(math.radians(azimuth)), -math.cos(math.radians(azimuth)), 0))
    camera = bpy.data.objects.new(view, bpy.data.cameras.new(view))
    scene.collection.objects.link(camera)
    camera.data.sensor_fit, camera.data.angle = "HORIZONTAL", FOV
    camera.location = behind*distance
    camera.rotation_euler = (-behind).to_track_quat("-Z", "Y").to_euler()
    body.data.uv_layers.new(name=view)
    project = body.modifiers.new(view, "UV_PROJECT")
    project.uv_layer, project.projector_count = view, 1
    project.projectors[0].object = camera
    bpy.context.view_layer.update()
    bpy.ops.object.modifier_apply(modifier=project.name)
    where = nodes.new("ShaderNodeUVMap")
    where.uv_map = view
    picture = nodes.new("ShaderNodeTexImage")
    picture.image = bpy.data.images.load(str(comfy / "input" / f"{name}-{view}-rgba.png"))
    picture.extension = "CLIP"
    link(where.outputs[0], picture.inputs[0])
    squarely = vector("DOT_PRODUCT", vector("NORMALIZE", vector("SUBTRACT", camera.location.copy(), surface.outputs["Position"])), surface.outputs["Normal"])
    weight = number("MULTIPLY", number("POWER", number("MAXIMUM", squarely, 0.0), POWER), picture.outputs["Alpha"])
    colour, weights = vector("ADD", colour, vector("SCALE", picture.outputs["Color"], scale=weight)), number("ADD", weights, weight)

body.data.uv_layers.active = body.data.uv_layers[own_uv]
glow = nodes.new("ShaderNodeEmission")
link(vector("SCALE", colour, scale=number("DIVIDE", 1.0, weights)), glow.inputs[0])
out = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
link(glow.outputs[0], out.inputs["Surface"])
painted = nodes.new("ShaderNodeTexImage")
painted.image = bpy.data.images.new("Painted coat", SIZE, SIZE, alpha=False)
nodes.active = painted
scene.render.engine, scene.cycles.samples, scene.render.bake.margin = "CYCLES", 1, 8
bpy.ops.object.bake(type="EMIT")
painted.image.pack()
link(bsdf.outputs[0], out.inputs["Surface"])
link(painted.outputs["Color"], bsdf.inputs["Base Color"])
for layer in [layer for layer in body.data.uv_layers if layer.name != own_uv]:
    body.data.uv_layers.remove(layer)
for camera in [o for o in scene.objects if o.type == "CAMERA"]:
    bpy.data.objects.remove(camera)
target = model.with_name(f"{name}-painted.glb")
bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", export_image_format="WEBP", export_image_quality=92)
print("painted", target)
