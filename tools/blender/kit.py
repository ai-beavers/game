"""The river kit, the beavers' child: its hide on a skeleton, its clips, exported as assets/kit.glb.

    Blender -b --factory-startup -P kit.py -- assets/kit.glb

The hide (mesh, colour and relief of the fur) is tools/blender/kit-hide.glb, made by tools/comfyui from our own
pictures of the kit (river-kit-smooth) and cut to game size by hide.py. Everything that moves is from here: 18 bones laid into it (the
bear's sixteen and two for the tail), its skin bound to them, and the clips, each a pose as a function of time.

Metres, 0.58 m from nose to tail tip, facing -Y (+Z in glTF), standing on z = 0.
Clips: stand, walk (one stride of WALK m), run (one stride of RUN m), forage (nose to the ground, a paw scraping),
look (nose in the wind), sit (down on its haunches). A clip's stride is the way it goes in one loop: the game plays
walk and run by the distance covered, so the feet do not slide.
"""
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

sin, cos, pi = math.sin, math.cos, math.pi
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

bpy.ops.import_scene.gltf(filepath=str(Path(__file__).with_name("kit-hide.glb")))
body = next(o for o in scene.objects if o.type == "MESH")
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for empty in [o for o in scene.objects if o.type == "EMPTY"]:
    bpy.data.objects.remove(empty)
body.name = "Kit hide"
# One skin again: a glb holds a vertex once for every patch of the map it lies on, and a skin bound patch by patch
# tears along the patches' edges when it bends.
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-6)
bpy.ops.object.mode_set(mode="OBJECT")

# The joints, read off the hide (y from the middle of its length, z from the ground), m.
HIP = (0, .095, .155)
NECK = (0, -.170, .165)
TAIL = (0, .135, .105)
bones = {"haunch": (HIP, (0, .135, .140), None), "back": (HIP, NECK, "haunch"),
         "skull": (NECK, (0, -.285, .165), "back"),
         "jaw": ((0, -.230, .145), (0, -.285, .140), "skull"),
         "tail1": (TAIL, (0, .215, .100), "haunch"), "tail2": ((0, .215, .100), (0, .298, .098), "tail1")}
legs = {}
for side, sign in (("R", -1), ("L", 1)):
    for fore in (True, False):
        x = sign * (.050 if fore else .058)
        points = [(x, y, z) for y, z in (
            [(-.125, .150), (-.105, .085), (-.120, .025), (-.160, .008)] if fore else
            [(.095, .150), (.075, .090), (.100, .028), (.060, .008)])]
        names = [part+"_"+side for part in (("arm", "forearm", "paw") if fore else ("thigh", "shin", "foot"))]
        legs[fore, side] = points, names
        parent = "back" if fore else "haunch"
        for name, a, b in zip(names, points, points[1:]):
            bones[name] = a, b, parent
            parent = name
# The poses are the bear's (tools/blender/bear.py), whose hip stands .92 m high: every length in them times M.
M = HIP[2]/.92
WALK, RUN = 1.5*M, 2.4*M


def clamp(x, low=0, high=1):
    return min(high, max(low, x))


def ramp(x):
    t = clamp(x)
    return t*t*(3-2*t)


armature = bpy.data.armatures.new("Kit skeleton")
rig = bpy.data.objects.new("Kit", armature)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for name, (a, b, parent) in bones.items():
    bone = armature.edit_bones.new(name)
    bone.head, bone.tail = a, b
    if parent:
        bone.parent = armature.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")
# The mouth is shut in the hide and has no inside: the jaw is in the skeleton, but carries no skin.
armature.bones["jaw"].use_deform = False
# Blender finds each bone's share of the skin by letting heat flow over it, which needs one closed surface. The
# hide is a generated sculpt with holes and loose bits (whiskers), so the heat flows over a closed copy of it, a
# shell of small cubes melted together, and each vertex of the hide takes the weights of the shell beside it.
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.duplicate()
shell = bpy.context.object
shell.data.remesh_voxel_size = .006
bpy.ops.object.voxel_remesh()
bpy.ops.object.select_all(action="DESELECT")
shell.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
assert any(v.groups for v in shell.data.vertices), "the shell got no weights: its surface is not closed"
for group in shell.vertex_groups:
    body.vertex_groups.new(name=group.name)
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
take = body.modifiers.new("Weights of the shell", "DATA_TRANSFER")
take.object, take.use_vert_data, take.data_types_verts, take.vert_mapping = shell, True, {"VGROUP_WEIGHTS"}, "POLYINTERP_NEAREST"
bpy.ops.object.modifier_apply(modifier=take.name)
bpy.data.objects.remove(shell)
body.parent = rig
body.modifiers.new("Kit skeleton", "ARMATURE").object = rig
print("kit: skin of", len(body.data.vertices), "vertices")
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.context.view_layer.objects.active = rig
pb = rig.pose.bones
rest = {b.name: b.matrix_local.to_quaternion() for b in armature.bones}


def turn(name, pitch=0, roll=0, yaw=0, parent=0):
    # Positive pitch raises the nose (or the tail's tip). Angles are relative to the parent's rotation, but for yaw,
    # which turns about the upright axis: `parent` is the parent's own pitch, taken out for it.
    q = Quaternion((-1, 0, 0), -parent) @ Quaternion((0, 0, 1), yaw) @ Quaternion((0, 1, 0), roll) @ Quaternion((-1, 0, 0), parent+pitch)
    pb[name].rotation_quaternion = rest[name].inverted() @ q @ rest[name]


def angle(a, b):
    return math.atan2(a[1]-b[1], a[2]-b[2])


def footpath(phase, stance, stride, height):
    # A planted foot moves backward exactly as far as the root travels.
    if phase < stance:
        return (.5*stance-phase)*stride, 0
    t = (phase-stance)/(1-stance)
    return (ramp(t)-.5)*stance*stride, height*sin(pi*t)**2


def pose(clip, t):
    wave = sin(2*pi*t)
    run, walk = clip == "run", clip == "walk"
    forage, look, sit = clip == "forage", clip == "look", clip == "sit"
    pitch = (-.05*wave if run else .013*wave) + (-.2 if forage else .5 if sit else 0)
    lift = (.016*cos(4*pi*t)-.085 if walk else .038*wave-.09 if run else .008*wave) - (.42 if sit else 0)
    head = -1+.05*sin(4*pi*t) if forage else .4+.03*sin(12*pi*t) if look else .1 if sit else 0
    gaze = (.28 if forage else .6 if look else .45 if sit else 0)*wave
    pb["haunch"].location = rest["haunch"].inverted() @ Vector((0, 0, lift*M))
    turn("back", pitch)
    turn("skull", -.88*pitch+.025*wave+head, 0, gaze, pitch)
    turn("jaw", -.06 if run else 0)
    # The flat tail trails: it sways with the stride, lifts a little at a run and lies on the ground when it sits.
    sway = (.22 if walk else .12 if run else .06)*sin(2*pi*t+.6)
    turn("tail1", (.10 if run else -.35 if sit else 0)+.03*wave, 0, sway)
    turn("tail2", (.06 if run else -.15 if sit else 0), 0, sway*.8)
    for (fore, side), ((a, b, c, d), names) in legs.items():
        parent = pitch if fore else 0
        upper0, lower0 = angle(a, b), angle(b, c)
        offset = (.10 if side == "L" else 0)+(.48 if fore else 0) if run else (.5 if side == "L" else 0)+(.18 if fore else 0)
        swing = (.24 if run else .115)*M
        f, h = footpath((t-offset) % 1, .35 if run else .62, RUN if run else WALK, swing) if walk or run else (0, 0)
        if forage and fore and side == "R" and t > .5:
            f, h = footpath((t-.5)*6 % 1, .6, .3*M, .08*M)  # three scrapes at the ground
        if sit:
            f = (-.3 if fore else .5)*M  # front paws drawn back under the chest, hind feet out in front of the rump
        # Two-link sagittal IK keeps a planted wrist or ankle at its ground target as the body bobs.
        af, az = HIP[1]-a[1], a[2]-HIP[2]
        df = (a[1]-c[1])+f+af*(1-cos(parent))+az*sin(parent)
        dz = c[2]+h-a[2]-lift*M-af*sin(parent)+az*(1-cos(parent))
        u, l = (Vector(b)-Vector(a)).length, (Vector(c)-Vector(b)).length
        dist = clamp(math.hypot(df, dz), abs(u-l)+.0002, u+l-.0002)
        direction = math.atan2(df, -dz)
        bend = -1 if fore else 1
        upper = direction+bend*math.acos(clamp((u*u+dist*dist-l*l)/(2*u*dist), -1, 1))
        lower = direction-bend*math.acos(clamp((l*l+dist*dist-u*u)/(2*l*dist), -1, 1))
        foot = -.22*h/swing
        ua, la = upper-upper0, lower-lower0
        turn(names[0], ua-parent)
        turn(names[1], la-ua)
        turn(names[2], foot-la)


rig.animation_data_create()
for name, frames in [("stand", 48), ("walk", 30), ("run", 20), ("forage", 120), ("look", 120), ("sit", 120)]:
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    for frame in range(frames+1):
        pose(name, frame/frames)
        pb["haunch"].keyframe_insert("location", frame=1+frame)
        for bone in pb:
            bone.keyframe_insert("rotation_quaternion", frame=1+frame)
    slot = rig.animation_data.action_slot
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    strip.action_slot = slot

if "--" in sys.argv:
    path = os.path.abspath(sys.argv[sys.argv.index("--")+1])
    bpy.ops.object.select_all(action="DESELECT")
    for obj in (rig, body):
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format="GLB",
        export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_def_bones=False,
        export_image_format="WEBP", export_image_quality=90)
    cli = ["bunx", "@gltf-transform/cli@4.5.1"]
    with tempfile.TemporaryDirectory() as temp:
        packed = Path(temp) / "kit.gltf"
        subprocess.run([*cli, "quantize", "--pattern", "{NORMAL,TEXCOORD_*,WEIGHTS_*}", path, packed], check=True)
        # CLI 4.5.1 checks POSITION when deciding whether to declare quantized normals. Positions here stay floats.
        gltf = json.loads(packed.read_text())
        for field in ("extensionsUsed", "extensionsRequired"):
            if "KHR_mesh_quantization" not in gltf[field]:
                gltf[field].append("KHR_mesh_quantization")
        packed.write_text(json.dumps(gltf))
        subprocess.run([*cli, "copy", packed, path], check=True)
