"""The river kit, the beavers' child: its hide on a skeleton, its clips, exported as assets/kit.glb.

    Blender -b --factory-startup -P kit.py -- assets/kit.glb

The hide (mesh, colour and relief of the fur) is tools/blender/kit-hide.glb, made by tools/comfyui from our own
pictures of the kit (river-kit-smooth) and cut to game size by hide.py. Everything that moves is from here: 18 bones laid into it (the
bear's sixteen and two for the tail), its skin bound to them, and the clips, each a pose as a function of time.

Metres, 0.58 m from nose to tail tip, facing -Y (+Z in glTF), standing on z = 0.
Clips: stand, walk (a waddle, one stride of WALK m), run (a bound, hind pair then fore pair, one stride of RUN m),
forage (nose to the ground, a paw scraping), look (nose in the wind), sit (down on its haunches), up (upright on its
haunches, paws at its chest, looking round), groom (upright, both paws rubbing its muzzle), lie (flat on its belly,
hind legs out behind, head up), sleep (as it lies, chin on the ground, nose and tail curled to its left, breathing). A clip's stride is the way it goes in one loop:
the game plays walk and run by the distance covered, so the feet do not slide.

The hide's vertex colours are the coat mask of the game's fur shader (src/beaver/fur.ts): red is the hair's length,
none on the tail, the eyes and the nose, short on the paws and the face.
"""
import json
import math
import os
import random
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np
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



def clamp(x, low=0, high=1):
    return min(high, max(low, x))


def ramp(x):
    t = clamp(x)
    return t*t*(3-2*t)


# The hide is long, low-bellied and long-legged, as the pictures it was made from. The reference (tools/comfyui/
# river-kit/target.png) is a round little animal: short legs, a deep wide trunk, a big head, round ears that stand
# out. shape() moves a point of the hide, and of the skeleton laid into it, from the one to the other.
LEGS, KNEE = 1.0, .085  # the legs' length kept, below this height
GIRTH, DEPTH, LENGTH, HEAD, EARS = 1.3, 1.08, .9, 1.0, .45
TAIL_LONG, STOUT = 1.4, .2  # the tail's length, and how much thicker the legs are at the paws
LEG_AT = [(x, y) for x in (-.05, .05) for y in (-.125,)]+[(x, .095) for x in (-.058, .058)]
EAR, THROAT, TAIL = Vector((.036, -.208, .19)), Vector((0, -.170, .165)), (0, .135, .105)


def shape(p):
    p = Vector(p)
    for sign in (-1, 1):
        ear = Vector((sign*EAR.x, EAR.y, EAR.z))
        p += (p-ear)*EARS*clamp(1-(p-ear).length/.03)
    p = THROAT+(p-THROAT)*(1+(HEAD-1)*ramp((-.15-p.y)/.04))
    if p.y > .03:
        p.y = .03+(p.y-.03)*.9  # a shorter rump
    # Stout legs: the skin round each leg's middle line stands further off it, most at the paw.
    for x, y in LEG_AT:
        off = Vector((p.x-x, p.y-y))
        if p.z < .075 and off.length < .045:
            more = 1+STOUT*(1-off.length/.045)*ramp((.075-p.z)/.04)
            p.x, p.y = x+off.x*more, y+off.y*more
    # A full chest under the chin: the skin there comes forward.
    p.y -= .04*max(0, 1-((p.y+.15)/.06)**2)*max(0, 1-((p.z-.105)/.055)**2)
    swell = sin(pi*clamp((p.y+.19)/.34))*ramp((p.z-KNEE*.6)/.04)  # most at the trunk's middle, none at the feet
    z = p.z*LEGS if p.z < KNEE else p.z-KNEE*(1-LEGS)
    middle = .14-KNEE*(1-LEGS)
    # A short trunk between a head of its own size and a long tail.
    along = TAIL[1]*LENGTH+(p.y-TAIL[1])*TAIL_LONG if p.y > TAIL[1] else p.y*LENGTH if p.y > THROAT.y else THROAT.y*LENGTH+(p.y-THROAT.y)
    return (p.x*(1+(GIRTH-1)*swell), along, middle+(z-middle)*(1+(DEPTH-1)*swell))


for v in body.data.vertices:
    v.co = shape(v.co)
low = min(v.co.z for v in body.data.vertices)
for v in body.data.vertices:
    v.co.z -= low

# The joints, read off the hide as it came (y from the middle of its length, z from the ground), m, and moved with it.
HIP = shape((0, .095, .155))
NECK = shape((0, -.170, .165))
TAIL = shape(TAIL)
bones = {"haunch": (HIP, shape((0, .135, .140)), None), "back": (HIP, NECK, "haunch"),
         "skull": (NECK, shape((0, -.285, .165)), "back"),
         "jaw": (shape((0, -.230, .145)), shape((0, -.285, .140)), "skull"),
         "tail1": (TAIL, shape((0, .215, .100)), "haunch"), "tail2": (shape((0, .215, .100)), shape((0, .298, .098)), "tail1")}
legs = {}
for side, sign in (("R", -1), ("L", 1)):
    for fore in (True, False):
        x = sign * (.050 if fore else .058)
        points = [shape((x, y, z)) for y, z in (
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
STAND_TAIL = .9  # rad the tail lies swung to its right as it stands, as the reference's
WALK, RUN = 1.5*M, 2.4*M
print("kit: strides", round(WALK, 3), round(RUN, 3), "m; hip", [round(c, 3) for c in HIP])


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

# The coat mask, from what each vertex hangs on: a beaver's tail is bare, its paws and face short-haired, and no hair
# grows on its nose or round its eyes.
FUR = .6  # its guard hairs (the under-fur ends at .72 of them), of the fur shader's longest hair, which is the grown beaver's
colour = next(n for n in body.active_material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image.colorspace_settings.name == "sRGB").image
width, height = colour.size
pixels = np.array(colour.pixels[:]).reshape(height, width, 4)[:, :, :3].mean(axis=2)
dark = {}
for loop, at in zip(body.data.loops, body.data.uv_layers.active.data):
    u, v = at.uv
    shade = pixels[min(height-1, int(v % 1*height)), min(width-1, int(u % 1*width))]
    dark[loop.vertex_index] = min(shade, dark.get(loop.vertex_index, 1))
EYEBALL = .0085  # m
tip = min(body.data.vertices, key=lambda v: v.co.y).co.copy()  # of the muzzle
nose = tip.y
# The colour map has the pictures' own nose too, a dark patch a little under the muzzle's tip, where the nose pad
# goes: beside the pad it shows as a second nose, so it is painted over below (with the eyes' smudges).
front = sorted((v for v in body.data.vertices if (v.co-tip).length < .03 and abs(v.co.x) < .014), key=lambda v: dark[v.index])[:10]
painted = sum((v.co for v in front), Vector())/len(front)
print("kit: muzzle tip", [round(c, 3) for c in tip], "painted nose", [round(c, 3) for c in painted])
# One place for both eyes, mirrored: the darkest of the head's sides, behind the nose and before the ears (which are
# dark inside too), and the way the skin faces there.
sides = sorted((v for v in body.data.vertices if abs(v.co.x) > .012 and nose+.035 < v.co.y < nose+.082 and v.co.z > NECK[2]-.02),
               key=lambda v: dark[v.index])[:8]
socket = sum((Vector((abs(v.co.x), v.co.y, v.co.z)) for v in sides), Vector())/len(sides)
facing = sum((Vector((abs(v.normal.x), v.normal.y, v.normal.z)) for v in sides), Vector()).normalized()
print("kit: eyes at", [round(c, 3) for c in socket])
# The mouth, drawn on the muzzle's skin: the cleft from under the nose down to the lips, and the lips' line back to
# each corner, turned up a little there.
on_skin = lambda p: (lambda hit: hit[1]+hit[2]*.0008)(body.closest_point_on_mesh(Vector(p)))
def mouth_lines():
    cleft = [on_skin((0, tip.y+.004+.004*t/5, tip.z-.008-.016*t/5)) for t in range(6)]
    lips = {sign: [on_skin((sign*.017*t/8, tip.y+.008+.02*t/8, tip.z-.024+.006*(t/8)**2-.003*sin(pi*t/8))) for t in range(9)] for sign in (-1, 1)}
    for line in (cleft, lips[-1], lips[1]):  # the skin is in triangles: the lines are drawn smooth over them
        for _ in range(3):
            line[1:-1] = [(a+2*b+c)/4 for a, b, c in zip(line, line[1:], line[2:])]
    return cleft, lips, cleft+lips[-1]+lips[1]


# The lips are a groove in the skin, not only a line on it: the skin along the lines sinks in, and the lines are laid
# anew into the groove.
cleft, lips, drawn = mouth_lines()
for v in body.data.vertices:
    near = min((v.co-p).length for p in drawn)
    if near < .0045:
        v.co -= v.normal*.002*(1-near/.0045)
body.data.update()
bpy.context.view_layer.update()
cleft, lips, drawn = mouth_lines()
named = [g.name for g in body.vertex_groups]
mask = body.data.color_attributes.new("fur", "FLOAT_COLOR", "POINT")
for v in body.data.vertices:
    on = {}
    for g in v.groups:
        part = named[g.group].split("_")[0]
        on[part] = on.get(part, 0)+g.weight
    bare = on.get("tail1", 0)+on.get("tail2", 0)+on.get("paw", 0)+on.get("foot", 0)  # dark skin: the tail and the paws
    hair = 1-bare-.35*(on.get("forearm", 0)+on.get("shin", 0))-.72*on.get("skull", 0)
    hair *= ramp(((Vector((abs(v.co.x), v.co.y, v.co.z))-socket).length-EYEBALL*.9)/(EYEBALL*.6))*ramp((v.co-tip).length/.012-.6)
    # Short on the muzzle, so its shape and the mouth show, and none on the lips.
    hair *= (.3+.7*ramp((v.co-tip).length/.07))*ramp(min((v.co-p).length for p in drawn)/.005)
    # The ears, behind and above the eyes: short-haired and dark, as the reference's.
    ear = on.get("skull", 0)*ramp((v.co.y-socket.y-.012)/.01)*ramp((v.co.z-socket.z-.004)/.008)*ramp((abs(v.co.x)-.02)/.008)
    hair, bare = hair*(1-.85*ear), bare+ear
    # A dark rim of skin round each eye.
    bare += .9*(1-ramp(((Vector((abs(v.co.x), v.co.y, v.co.z))-socket).length/EYEBALL-1)/.9))
    mask.data[v.index].color = (FUR*clamp(hair), 0, 1-clamp(bare), 1)  # blue: the shader darkens where it is low
body.data.color_attributes.active_color = mask

# The pictures' own eyes are painted on the colour map a little off the eyeballs, and show as a dark smudge beside
# them: the skin round each socket is painted over with the colour of the fur about it.
texels = np.array(colour.pixels[:]).reshape(height, width, 4)
uvs = body.data.uv_layers.active.data
aside = lambda c: (Vector((abs(c.x), c.y, c.z))-socket).length/EYEBALL
about = [texels[min(height-1, int(uvs[l].uv.y % 1*height)), min(width-1, int(uvs[l].uv.x % 1*width)), :3]
         for f in body.data.polygons for l, i in zip(f.loop_indices, f.vertices) if 3 < aside(body.data.vertices[i].co) < 4.5]
fur_there = np.mean(about, axis=0)
for f in body.data.polygons:
    if max(aside(body.data.vertices[i].co) for i in f.vertices) > 2.6:
        continue
    corners = np.array([(uvs[l].uv.x % 1*width, uvs[l].uv.y % 1*height) for l in f.loop_indices])
    (x0, y0), (x1, y1) = np.floor(corners.min(axis=0)).astype(int)-1, np.ceil(corners.max(axis=0)).astype(int)+1
    texels[max(0, y0):y1+1, max(0, x0):x1+1, :3] = fur_there  # the patch round the triangle: its neighbours are eye too
# The painted nose, the same way.
off = lambda c: (c-painted).length
about = [texels[min(height-1, int(uvs[l].uv.y % 1*height)), min(width-1, int(uvs[l].uv.x % 1*width)), :3]
         for f in body.data.polygons for l, i in zip(f.loop_indices, f.vertices) if .021 < off(body.data.vertices[i].co) < .03]
fur_there = np.mean(about, axis=0)
for f in body.data.polygons:
    if max(off(body.data.vertices[i].co) for i in f.vertices) > .018:
        continue
    corners = np.array([(uvs[l].uv.x % 1*width, uvs[l].uv.y % 1*height) for l in f.loop_indices])
    (x0, y0), (x1, y1) = np.floor(corners.min(axis=0)).astype(int)-1, np.ceil(corners.max(axis=0)).astype(int)+1
    texels[max(0, y0):y1+1, max(0, x0):x1+1, :3] = fur_there
# Measured against the reference, part by part, the head came out a little dark and the paws a little light: the
# colour map of each is brought to the reference's.
TONE = {"skull": 1.08, "paw": .66, "foot": .66}  # times the linear colour
tone = np.ones((height, width))
for f in body.data.polygons:
    on = {}
    for i in f.vertices:
        for g in body.data.vertices[i].groups:
            part = body.vertex_groups[g.group].name.split("_")[0]
            on[part] = on.get(part, 0)+g.weight/len(f.vertices)
    part = max(on, key=on.get) if on else None
    if part in TONE and on[part] > .5:
        corners = np.array([(uvs[l].uv.x % 1*width, uvs[l].uv.y % 1*height) for l in f.loop_indices])
        (x0, y0), (x1, y1) = np.floor(corners.min(axis=0)).astype(int), np.ceil(corners.max(axis=0)).astype(int)
        tone[max(0, y0):y1+1, max(0, x0):x1+1] = TONE[part]
texels[:, :, :3] *= tone[:, :, None]
colour.pixels.foreach_set(texels.astype(np.float32).ravel())
colour.update()

# The long hair: thin cards standing off the skin along the way the coat lies (back and down), each with the colour
# of the skin at its root and its own strip of the game's picture of single hairs (the second UV set), paler to the
# tip (the vertex colours). They lean with the skin they stand on. None where the fur is short: face, paws, tail.
STRANDS, LONG, WIDE = 9000, .034, .008
random.seed(11)
lie = Vector((0, 1, -.55)).normalized()
chosen = random.choices(list(body.data.polygons), weights=[f.area for f in body.data.polygons], k=STRANDS)
points, quads, at_root, on_card, tips, facing_out, hung = [], [], [], [], [], [], []
for f in chosen:
    cut = sorted((random.random(), random.random()))
    share = (cut[0], cut[1]-cut[0], 1-cut[1])
    corners, loops = list(f.vertices)[:3], list(f.loop_indices)[:3]
    long = sum(mask.data[i].color[0]*k for i, k in zip(corners, share))/FUR
    if long < .45:
        continue
    root = sum((body.data.vertices[i].co*k for i, k in zip(corners, share)), Vector())
    long *= ramp(((Vector((abs(root.x), root.y, root.z))-socket).length-.02)/.035)  # none to hang over the eyes
    if long < .3:
        continue
    n = f.normal.copy()
    along = lie-n*lie.dot(n)
    if along.length < .25:
        along = Vector((0, 0, -1))-n*-n.z
    along.normalize()
    out, side = (along*.9+n*.4).normalized(), n.cross(along).normalized()*WIDE*.5*random.uniform(.8, 1.2)
    long *= LONG*random.uniform(.7, 1.25)
    place = sum((Vector((uvs[l].uv.x, uvs[l].uv.y, 0))*k for l, k in zip(loops, share)), Vector())
    strip, first = random.uniform(0, .5), len(points)
    top = .86+.14*max(0, n.z)  # the back's hair is paler than the flanks', as the reference's
    for row, (middle, wide, shade) in enumerate(((root-n*.002, 1, .86), (root+out*long*.5, .95, .93), (root+out*long-Vector((0, 0, .2*long)), .7, 1))):
        for edge in (0, 1):
            points.append(middle+side*(2*edge-1)*wide)
            at_root.append((place.x, place.y))
            on_card.append((strip+.5*edge, row/2))
            tips.append((shade*top, shade*top, shade*top, 1))
            facing_out.append((n*.8+out*.2).normalized())
            hung.append(corners[0])
    quads += [(first, first+1, first+3, first+2), (first+2, first+3, first+5, first+4)]
hair = bpy.data.meshes.new("strands")
hair.from_pydata(points, [], quads)
strands = bpy.data.objects.new("strands", hair)
scene.collection.objects.link(strands)
for name, coords in (("UVMap", at_root), ("card", on_card)):
    layer = hair.uv_layers.new(name=name)
    for loop in hair.loops:
        layer.data[loop.index].uv = coords[loop.vertex_index]
shade = hair.color_attributes.new("tip", "FLOAT_COLOR", "POINT")
for i, c in enumerate(tips):
    shade.data[i].color = c
hair.color_attributes.active_color = shade
hair.normals_split_custom_set_from_vertices(facing_out)
coat = body.active_material.copy()
coat.name = "Strands"
hair.materials.append(coat)
for group in body.vertex_groups:
    strands.vertex_groups.new(name=group.name)
for i, source in enumerate(hung):
    for g in body.data.vertices[source].groups:
        strands.vertex_groups[g.group].add([i], g.weight, "REPLACE")
strands.parent = rig
strands.modifiers.new("Kit skeleton", "ARMATURE").object = rig
print("kit:", len(quads), "triangles x 2 of long hair")

# The eyes: a dark glossy ball in each socket, where the colour map has the eye (the dark of the head's sides, behind
# the nose), half sunk into the head. Painted eyes alone are dull and lie under the fur.
glass = bpy.data.materials.new("Eye")
glass.use_nodes = True
shine = next(n for n in glass.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
shine.inputs["Base Color"].default_value, shine.inputs["Roughness"].default_value = (1, 1, 1, 1), .06  # times the vertex colours
eyes = []
for side, sign in (("R", -1), ("L", 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=EYEBALL,
                                         location=(sign*(socket.x-facing.x*EYEBALL*.5), socket.y-facing.y*EYEBALL*.5, socket.z-facing.z*EYEBALL*.5))
    eye = bpy.context.object
    eye.name = "eye_"+side
    bpy.ops.object.shade_smooth()
    eye.data.materials.append(glass)
    # A black pupil looking out of the head, a dark brown iris round it, as good as black beyond.
    look = Vector((sign*facing.x, facing.y, facing.z))
    iris = eye.data.color_attributes.new("iris", "FLOAT_COLOR", "POINT")
    for v in eye.data.vertices:
        out = v.normal.dot(look)
        iris.data[v.index].color = (.004, .003, .003, 1) if out > .86 else (.2, .085, .03, 1) if out > .25 else (.014, .009, .007, 1)
    eyes.append(eye)
# The nose: a dark, damp pad on the muzzle's tip.
bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=.0105, location=(0, tip.y+.006, tip.z+.003))
pad = bpy.context.object
pad.name, pad.scale = "nose", (1.1, .6, .72)
bpy.ops.object.shade_smooth()
leather = bpy.data.materials.new("Nose")
leather.use_nodes = True
damp = next(n for n in leather.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
damp.inputs["Base Color"].default_value, damp.inputs["Roughness"].default_value = (.085, .055, .048, 1), .35
pad.data.materials.append(leather)
eyes.append(pad)
# Two nostrils in the pad's front.
dull = bpy.data.materials.new("Nostril")
dull.use_nodes = True
next(n for n in dull.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (.008, .006, .006, 1)
for sign in (-1, 1):
    way = Vector((sign*.45, -.85, .3)).normalized()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=.0022,
                                         location=(way.x*.0105*1.1*.93, tip.y+.006+way.y*.0105*.6*.93, tip.z+.003+way.z*.0105*.72*.93))
    hole = bpy.context.object
    hole.name = "nostril"
    hole.data.materials.append(dull)
    eyes.append(hole)
# The mouth's lines, as thin dark cords lying on the skin.
points, faces = [], []
for line in (cleft, lips[-1], lips[1]):
    first = len(points)
    for i, p in enumerate(line):
        ahead = (line[min(i+1, len(line)-1)]-line[max(i-1, 0)]).normalized()
        a = ahead.cross(Vector((0, 1, 0))).normalized()
        b = ahead.cross(a).normalized()
        points += [p+(a*cos(2*pi*k/4)+b*sin(2*pi*k/4))*.0011 for k in range(4)]
    faces += [(first+4*i+k, first+4*i+(k+1) % 4, first+4*i+4+(k+1) % 4, first+4*i+4+k) for i in range(len(line)-1) for k in range(4)]
cords = bpy.data.meshes.new("mouth")
cords.from_pydata(points, [], faces)
mouth = bpy.data.objects.new("mouth", cords)
scene.collection.objects.link(mouth)
cords.materials.append(leather)
eyes.append(mouth)
# The whiskers: seven thin pale hairs a side, out of the muzzle beside and below the nose, each sagging to its tip.
random.seed(7)
cheek = sorted((v.co for v in body.data.vertices if nose+.008 < v.co.y < nose+.034 and v.co.x > .008 and tip.z-.024 < v.co.z < tip.z+.002),
             key=lambda c: c.y)
roots = cheek[::max(1, len(cheek)//7)][:7]
points, faces = [], []
for sign in (-1, 1):
    for root in roots:
        out = Vector((sign, random.uniform(-.45, .1), random.uniform(-.2, .2))).normalized()
        a, b = out.cross(Vector((0, 0, 1))).normalized(), out.cross(out.cross(Vector((0, 0, 1)))).normalized()
        long, first = random.uniform(.03, .055), len(points)
        for i in range(6):
            t = i/5
            middle = Vector((sign*root.x, root.y, root.z))+out*long*t-Vector((0, 0, .012*t*t))
            points += [middle+(a*cos(2*pi*k/3)+b*sin(2*pi*k/3))*(.00045*(1-t)+.00008) for k in range(3)]
        faces += [(first+3*i+k, first+3*i+(k+1) % 3, first+3*i+3+(k+1) % 3, first+3*i+3+k) for i in range(5) for k in range(3)]
hairs = bpy.data.meshes.new("whiskers")
hairs.from_pydata(points, [], faces)
whiskers = bpy.data.objects.new("whiskers", hairs)
scene.collection.objects.link(whiskers)
pale = bpy.data.materials.new("Whisker")
pale.use_nodes = True
next(n for n in pale.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (.85, .8, .7, 1)
hairs.materials.append(pale)
eyes.append(whiskers)  # on the head with the eyes


def onto(things, bone):
    # Hangs meshes on a bone, where they are.
    bpy.ops.object.select_all(action="DESELECT")
    for thing in things:
        thing.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    armature.bones.active = armature.bones[bone]
    bpy.ops.object.parent_set(type="BONE", keep_transform=True)


onto(eyes, "skull")
# The claws: four pale little cones on each paw, at the front of its toes, pointing ahead and down.
horn = bpy.data.materials.new("Claw")
horn.use_nodes = True
polish = next(n for n in horn.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
polish.inputs["Base Color"].default_value, polish.inputs["Roughness"].default_value = (.5, .36, .3, 1), .3
for (fore, side), (_, names) in legs.items():
    group = body.vertex_groups[names[2]].index
    paw = [v.co for v in body.data.vertices if any(g.group == group and g.weight > .5 for g in v.groups)]
    front = min(c.y for c in paw)
    toes = [c for c in paw if c.y < front+.014 and c.z < .022]
    left, right = min(c.x for c in toes), max(c.x for c in toes)
    points, faces = [], []
    for i in range(4):
        toe = [c for c in toes if left+(right-left)*i/4 <= c.x <= left+(right-left)*(i+1)/4]
        if not toe:
            continue
        root, first = min(toe, key=lambda c: c.y)+Vector((0, .002, .001)), len(points)
        points += [root+Vector((.0024*cos(2*pi*k/5), 0, .0024*sin(2*pi*k/5))) for k in range(5)]+[root+Vector((0, -.009, -.0035))]
        faces += [(first+k, first+(k+1) % 5, first+5) for k in range(5)]
    nails = bpy.data.meshes.new("claws_"+names[2])
    nails.from_pydata(points, [], faces)
    claws = bpy.data.objects.new("claws_"+names[2], nails)
    scene.collection.objects.link(claws)
    nails.materials.append(horn)
    for face in nails.polygons:
        face.use_smooth = True
    onto([claws], names[2])
    eyes.append(claws)
bpy.context.view_layer.objects.active = rig
pb = rig.pose.bones
rest = {b.name: b.matrix_local.to_quaternion() for b in armature.bones}


def turn(name, pitch=0, roll=0, yaw=0, parent=0):
    # Positive pitch raises the nose (and so lowers the tip of a tail bone, which points the other way). Angles are relative to the parent's rotation, but for yaw,
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
    wave, beat = sin(2*pi*t), cos(2*pi*t)
    run, walk = clip == "run", clip == "walk"
    forage, look, sit = clip == "forage", clip == "look", clip == "sit"
    up, groom, sleep = clip == "up", clip == "groom", clip == "sleep"
    upright, lie = up or groom, clip in ("lie", "sleep")
    # A bound: the back rears as the hind pair pushes off and dips as the fore pair lands; the hips ride highest
    # while the hind feet swing forward under them.
    pitch = .14*sin(2*pi*(t-.1)) if run else .013*wave
    # Standing, it holds its head high and its rump low, hind feet drawn in under it: a round little animal.
    pitch += .42 if clip == "stand" else 0
    pitch += -.2 if forage else .5 if sit else 1.0 if up else .9 if groom else .1+(.012*wave if sleep else 0) if lie else 0
    lift = .03*cos(4*pi*t)-.085 if walk else -.09-.06*sin(2*pi*(t+.05)) if run else .008*wave
    lift -= .42 if clip == "stand" else 0
    lift -= .42 if sit else .40 if up else .42 if groom else .55 if lie else 0
    head = (.1 if clip == "stand" else -1+.05*sin(4*pi*t) if forage else .4+.03*sin(12*pi*t) if look else .1 if sit else .15+.03*sin(4*pi*t) if up
            else -.25+.05*sin(30*pi*t) if groom else -.42 if sleep else .2 if lie else 0)
    gaze = (.28*wave if forage else .6*wave if look else .45*wave if sit else .7*wave if up else .55 if sleep
            else .35*wave if lie else -.07*beat if walk else 0)
    pb["haunch"].location = rest["haunch"].inverted() @ Vector((0, 0, lift*M))
    # The waddle: hips and shoulders roll against each other and the back swings from side to side with the stride.
    turn("haunch", 0, .06*wave if walk else 0)
    turn("back", pitch, -.10*wave if walk else 0, .07*beat if walk else .25 if sleep else 0)
    turn("skull", -.88*pitch+.025*wave+head, 0, gaze, pitch)
    turn("jaw", -.06 if run else 0)
    # The flat tail trails: it sways with the stride, bounces at a run, lies on the ground when the kit is down and
    # curls round towards its nose when it sleeps.
    sway = -.8 if sleep else STAND_TAIL if clip == "stand" else (.3 if walk else .12 if run else .06)*sin(2*pi*t+.6)
    turn("tail1", (.10+.18*sin(2*pi*(t-.35)) if run else -.35 if sit else .55 if clip == "stand" else -.2 if upright else -.08 if lie else 0)+.03*wave, 0, sway)
    turn("tail2", (.06+.12*sin(2*pi*(t-.5)) if run else -.15 if sit else -.45 if clip == "stand" else 0), 0, sway*.8)
    for (fore, side), ((a, b, c, d), names) in legs.items():
        parent = pitch if fore else 0
        upper0, lower0 = angle(a, b), angle(b, c)
        if fore and upright:
            # Paws held at the chest; grooming, both go up to the muzzle and rub it, one after the other.
            rub = sin(30*pi*t+(pi if side == "L" else 0))
            upper = 1.35+.06*rub if groom else .49+.035*wave
            lower = 2.35+.22*rub if groom else 1.66+.03*wave
            foot = 1.8 if groom else .09
        else:
            offset = (.06 if side == "L" else 0)+(.46 if fore else 0) if run else (.5 if side == "L" else 0)+(.18 if fore else 0)
            swing = (.30 if run else .15)*M
            f, h = footpath((t-offset) % 1, .35 if run else .62, RUN if run else WALK, swing) if walk or run else (0, 0)
            if forage and fore and side == "R" and t > .5:
                f, h = footpath((t-.5)*6 % 1, .6, .3*M, .08*M)  # three scrapes at the ground
            if sit:
                f = (-.3 if fore else .5)*M  # front paws drawn back under the chest, hind feet out in front of the rump
            if clip == "stand":
                f = (.34 if fore else .46)*M  # front paws planted ahead of the chest, hind feet drawn in under the rump
            if upright:
                f = .45*M  # the hind feet, out in front of the rump
            if lie:
                f = (.4 if fore else -.55)*M  # flat on its belly: paws out in front, hind legs trailing behind
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
            foot = lower-lower0-1.2 if lie and not fore else -.22*h/swing  # trailing, the soles turn up
        ua, la = upper-upper0, lower-lower0
        turn(names[0], ua-parent)
        turn(names[1], la-ua)
        turn(names[2], foot-la)


rig.animation_data_create()
for name, frames in [("stand", 48), ("walk", 30), ("run", 20), ("forage", 120), ("look", 120), ("sit", 120),
                     ("up", 120), ("groom", 150), ("lie", 120), ("sleep", 120)]:
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
    for obj in (rig, body, strands, *eyes):
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format="GLB",
        export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_def_bones=False,
        export_vertex_color="ACTIVE", export_image_format="WEBP", export_image_quality=90)
    cli = ["bunx", "@gltf-transform/cli@4.5.1"]
    with tempfile.TemporaryDirectory() as temp:
        packed = Path(temp) / "kit.gltf"
        subprocess.run([*cli, "quantize", "--pattern", "{NORMAL,TEXCOORD_*,WEIGHTS_*,COLOR_*}", path, packed], check=True)
        # CLI 4.5.1 checks POSITION when deciding whether to declare quantized normals. Positions here stay floats.
        gltf = json.loads(packed.read_text())
        for field in ("extensionsUsed", "extensionsRequired"):
            if "KHR_mesh_quantization" not in gltf[field]:
                gltf[field].append("KHR_mesh_quantization")
        packed.write_text(json.dumps(gltf))
        subprocess.run([*cli, "copy", packed, path], check=True)
