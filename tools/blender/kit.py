"""The river kit, the beavers' child: its hide on a skeleton, its clips, exported as assets/kit.glb.

    Blender -b --factory-startup -P kit.py -- assets/kit.glb

The hide (mesh, colour and relief of the fur) is tools/blender/kit-hide.glb, made by tools/comfyui from the kit's
reference picture alone (river-kit/target.png, single.py) and cut to game size by hide.py: the reference's own
animal, with its eyes, nose, mouth, claws and scaly tail. Everything that moves is from here: 38 bones laid into it
(sixteen for the body, two for the tail and five digits on each paw), its skin bound to them, and the clips, each a pose
as a function of time.
Added to the hide: glossy eyeballs, whiskers, cards of long hair, and the fur shader's mask; its lips cut apart, so that
the jaw opens the mouth, with a dark lining inside and orange incisors.

Metres, 0.58 m from nose to tail tip, facing -Y (+Z in glTF), standing on z = 0.
Clips: stand (as the hide stands), walk (a waddle, one stride of WALK m), run (a bound, hind pair then fore pair, one stride of RUN m),
forage (nose to the ground, a paw scraping), look (nose in the wind), sit (down on its haunches), up (upright on its
haunches, paws curled at its chest, arms close to its body, looking round), tall (up on its hind feet, its tail behind
it, arms close to its body, looking round), lean (up on its hind feet, both fore paws on what is before it), touch
(its right fore paw out to pat what is before it, three times), groom (upright, both paws rubbing its muzzle), lie (flat on its belly,
hind legs out behind, head up), sleep (over on its side as a seal pup dozes, chin on the ground, its upper fore paw at its chest, breathing). A clip's stride is the way it goes in one loop:
the game plays walk and run by the distance covered, so the feet do not slide.
Two are played once, from the pose before them to standing: shake (1 s: it shakes itself dry, a fast twist from side
to side that runs from the head down to the tail) and wake (2 s, from sleep: it rolls up off its side as the head comes up into a yawn, the hind
feet are gathered, the rump goes up over the chest and the reached-out fore paws in a stretch, then it stands).
Four more are played once, from sleep back to sleep, as it stirs in its sleep (STIRS): rub (3 s: its upper fore paw
rubs its face), stretch (2.5 s: its hind feet lift, spread and stretch out long), nuzzle (2 s: its chin along the
ground as it rocks) and peep (1.5 s: its head comes up, mouth open in a squeak).

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

import bmesh
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


# The joints, read off the hide, m (y from the trunk's middle, z from the ground). The hide stands as the reference's
# animal stands: chest up, rump low, head turned a little to its left, tail swung to its right. That is its rest, and
# its stand.
HIP = (-.015, .17, .17)
NECK = (-.005, -.03, .235)
TAIL = (-.06, .24, .075)
tip = min(body.data.vertices, key=lambda v: v.co.y).co.copy()  # of the nose
# The mouth: the hide's lips are sculpted but grown together. The skin is cut along the lip line, from the front of
# the muzzle back to the corners of the mouth: m above the ground where the lips meet in front, how much the line
# drops for each m back, m behind the nose's tip of the corners, m the lining of the mouth lies inside the skin, and
# m behind the nose's tip of the incisors. What lies below the line goes with the jaw.
MOUTH = {"front": .229, "slope": -.4, "corner": .035,
         "sunk": .0032, "teeth": .011}
lip = lambda c: MOUTH["front"]+MOUTH["slope"]*(c.y-tip.y)  # z of the lip line at c
chin = lambda c: c.z < lip(c) and c.z > .15 and c.y < -.11  # below the lip line, in the head
mesh = bmesh.new()
mesh.from_mesh(body.data)
mesh.verts.ensure_lookup_table()
# The lining of the mouth: the skin round the lips as it is before the cut, sunk a little into the head, so that it
# spans the opening when the jaw drops and lies hidden behind the lips while they are shut.
near = lambda c: c.y < tip.y+MOUTH["corner"]+.008 and -.012 < c.z-lip(c) < .007
around = [f for f in mesh.faces if near(f.calc_center_median()) and f.normal.y < .5]
used = sorted({v.index for f in around for v in f.verts})
lining = ([mesh.verts[i].co-mesh.verts[i].normal*MOUTH["sunk"] for i in used], [tuple(used.index(v.index) for v in f.verts) for f in around])
lower = {f for f in mesh.faces if chin(f.calc_center_median())}
cut = [e for e in mesh.edges if len(e.link_faces) == 2 and (e.link_faces[0] in lower) != (e.link_faces[1] in lower)
       and max(v.co.y for v in e.verts) < tip.y+MOUTH["corner"]]
bmesh.ops.split_edges(mesh, edges=cut)
jawed = {v.index for f in mesh.faces if f in lower for v in f.verts}
mesh.to_mesh(body.data)
mesh.free()
print("kit: the mouth cut along", len(cut), "edges;", len(jawed), "vertices below it")
bones = {"haunch": (HIP, (-.02, .21, .15), None), "back": (HIP, NECK, "haunch"),
         "skull": (NECK, tuple(tip), "back"),
         "jaw": ((-.015, -.13, .235), (tip.x, tip.y+.01, tip.z-.03), "skull"),
         "tail1": (TAIL, (-.14, .30, .06), "haunch"), "tail2": ((-.14, .30, .06), (-.22, .345, .05), "tail1")}
# The paws, found where the hide touches the ground (but for the tail, which lies there too): each leg's joints stand
# over its own paw, as far from its toes as on the hide.
ground = [v.co for v in body.data.vertices if v.co.z < .015 and v.co.y < .21 and v.co.x > -.16]
legs = {}
for fore in (True, False):
    pair = [c for c in ground if (c.y < .03) == fore]
    between = sum(c.x for c in pair)/len(pair)
    for side, sign in (("R", -1), ("L", 1)):
        paw = [c for c in pair if (c.x-between)*sign > 0]
        x, toes = sum(c.x for c in paw)/len(paw), min(c.y for c in paw)
        print("kit:", "fore" if fore else "hind", side, "paw at x", round(x, 3), "toes at y", round(toes, 3), "of", len(paw))
        points = [(x, toes+y, z) for y, z in (
            [(.075, .135), (.085, .075), (.055, .028), (.005, .008)] if fore else
            [(.085, .150), (.035, .095), (.100, .030), (.005, .008)])]
        names = [part+"_"+side for part in (("arm", "forearm", "paw") if fore else ("thigh", "shin", "foot"))]
        legs[fore, side] = points, names
        parent = "back" if fore else "haunch"
        for name, a, b in zip(names, points, points[1:]):
            bones[name] = a, b, parent
            parent = name
# The digits, five on each paw: where its skin reaches furthest ahead, at least DIGIT m apart across the paw, are the
# tips of its claws; each digit is a bone from its knuckle, KNUCKLE of the way from the wrist to the toes, to that tip,
# named after its paw: paw_R.0 … paw_R.4 from the paw's left to its right as it stands.
DIGIT, KNUCKLE = .0065, .5
digits = {}
for (fore, side), ((a, b, c, d), names) in legs.items():
    wrist, toes = Vector(c), Vector(d)
    axis, length = (toes-wrist).normalized(), (toes-wrist).length
    across = axis.cross(Vector((0, 0, 1))).normalized()
    reach = []
    for v in body.data.vertices:
        r = v.co-wrist
        s = r.dot(axis)
        if .55*length < s < 1.5*length and (r-axis*s).length < .04 and v.co.z < .05:
            reach.append((s, r.dot(across), v.co.copy()))
    tips = []
    for s, lat, co in sorted(reach, key=lambda x: -x[0]):
        if all(abs(lat-other[1]) > DIGIT for other in tips):
            tips.append((s, lat, co))
        if len(tips) == 5:
            break
    assert len(tips) == 5, f"found {len(tips)} digits on {names[2]}"
    for i, (s, lat, tip_at) in enumerate(sorted(tips, key=lambda t: t[1])):
        knuckle = wrist+axis*KNUCKLE*length+across*lat*.8
        name = f"{names[2]}.{i}"
        bones[name] = tuple(knuckle), tuple(tip_at), names[2]
        digits[name] = fore, side, i, wrist, axis, length
print("kit:", len(digits), "digits")
# The poses were written for an animal whose hip stands .92 m high: every length in them times M.
M = HIP[2]/.92
WALK, RUN = 1.5*M, 2.4*M
SHAKE = .65  # rad its head rolls to each side when it shakes itself dry
# Asleep it lies over on its side, as a seal pup dozes (the reference: a grey seal pup at Donna Nook): rad it rolls
# over (onto its right side, its left up), and breaths in the sleep's loop of 4 s. Now and then it stirs, each stir a
# clip of its own from the sleep's pose back to it, s long (src/features/river-kit/rules.ts keeps the same, STIRS, and
# picks them): its upper fore paw rubs its face (STROKES times), its hind feet lift, spread and stretch out long, its
# chin nuzzles the ground as it rocks, or its head comes up, its mouth open in a squeak.
SIDE, BREATHS, STROKES = -1.3, 2, 4
STIRS = {"rub": 3, "stretch": 2.5, "nuzzle": 2, "peep": 1.5}
ARMS = -.4, 2.9, 1.5  # rad, on its haunches or its feet: arm, forearm and paw, held close to its body
SPREAD = .35  # rad the outer digits turn apart, spread
DRAPE = .6, .4, -.4  # rad the upper fore and hind legs lie down over it, and the lower ones are lifted along the ground
RAISED = .1  # of that hip height, its hips up from where they are when it lies on its belly: on its side it is narrower
# Asleep, its head lies on its cheek and its back curls a little towards its belly (rad: the head's turn down to the
# ground, its nose down, its back's curl), and its fore paws are curled at its chest (m at that size, ahead of the
# shoulder: the upper paw and the lower, tucked under it; rad the paws are bent in).
REST = {"head": -.4, "nose": -.6, "curl": -.15, "paws": (-.1, -.25), "bent": 1.0}
RUBBING = 1.3, 2.3, 2.0  # rad: its arm, forearm and paw at its face, as the groom has them
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
for name in digits:  # a digit's palm side is its paw's: it curls towards the palm about its own X
    armature.edit_bones[name].align_roll(armature.edit_bones[name].parent.z_axis)
bpy.ops.object.mode_set(mode="OBJECT")
# The jaw and the digits take no share of the heat below: too small for its shell, their skin is given to them by
# hand, once the rest is weighed.
for name in ["jaw", *digits]:
    armature.bones[name].use_deform = False
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
# The sculpt's own whiskers hang from the muzzle as thin shards, down to beside the paws: left to the shell, their
# tips went with a leg and were drawn out across the body when it sat up. The whole muzzle goes with the skull.
skull = body.vertex_groups["skull"]
muzzle = [v.index for v in body.data.vertices if v.co.y < tip.y+.09 and v.co.z > .19]
for group in body.vertex_groups:
    group.remove(muzzle)
skull.add(muzzle, 1, "REPLACE")
# The lower lip and the chin go with the jaw, all of them in front and less towards its hinge below the ear.
hinge = bones["jaw"][0][1]-.005
jaw = body.vertex_groups.new(name="jaw")
for i in jawed:
    v = body.data.vertices[i]
    share = ramp((hinge-v.co.y)/.03)
    if share > 0:
        for group in body.vertex_groups:
            if group != jaw:
                group.remove([i])
        jaw.add([i], share, "REPLACE")
        skull.add([i], 1-share, "REPLACE")
armature.bones["jaw"].use_deform = True
# A paw's skin beyond its knuckles goes with its digits: with the nearest most, shared with the next between them.
for paw in {name.split(".")[0] for name in digits}:
    group, mine = body.vertex_groups[paw], [name for name in digits if name.startswith(paw+".")]
    segments = [(Vector(bones[name][0]), Vector(bones[name][1])) for name in mine]
    fore, side, _, wrist, axis, length = digits[mine[0]]
    for v in body.data.vertices:
        held = next((g.weight for g in v.groups if g.group == group.index), 0)
        along = ramp(((v.co-wrist).dot(axis)-(KNUCKLE-.12)*length)/(.2*length))
        if held <= 0 or along <= 0:
            continue
        gaps = []
        for head, tail in segments:
            k = clamp((v.co-head).dot(tail-head)/(tail-head).length_squared)
            gaps.append(max(1e-4, (v.co-head.lerp(tail, k)).length))
        near = sorted(range(len(mine)), key=lambda i: gaps[i])[:2]
        shares = [1/gaps[i]**4 for i in near]
        for i, share in zip(near, shares):
            body.vertex_groups.get(mine[i]) or body.vertex_groups.new(name=mine[i])
            body.vertex_groups[mine[i]].add([v.index], held*along*share/sum(shares), "REPLACE")
        group.add([v.index], held*(1-along), "REPLACE")
for name in digits:
    armature.bones[name].use_deform = True
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
EYEBALL = .011  # m
nose, head_x = tip.y, (NECK[0]+tip.x)/2
# The eyes, one on each side of the head: the darkest of that side behind the nose and before the ears (which are
# dark inside too), and the way the skin faces there.
sockets, facings = {}, {}
for sign in (-1, 1):
    there = sorted((v for v in body.data.vertices if (v.co.x-head_x)*sign > .012 and nose+.04 < v.co.y < nose+.10 and v.co.z > tip.z-.01),
                   key=lambda v: dark[v.index])[:8]
    sockets[sign] = sum((v.co for v in there), Vector())/len(there)
    facings[sign] = sum((v.normal for v in there), Vector()).normalized()
    print("kit: eye at", [round(c, 3) for c in sockets[sign]])
eye_off = lambda c: min((c-socket).length for socket in sockets.values())
named = [g.name for g in body.vertex_groups]
mask = body.data.color_attributes.new("fur", "FLOAT_COLOR", "POINT")
for v in body.data.vertices:
    on = {}
    for g in v.groups:
        part = named[g.group].split("_")[0]
        on[part] = on.get(part, 0)+g.weight
    bare = on.get("tail1", 0)+on.get("tail2", 0)+on.get("paw", 0)+on.get("foot", 0)  # the tail and the paws
    hair = 1-bare-.35*(on.get("forearm", 0)+on.get("shin", 0))-.9*on.get("skull", 0)
    # None on the eyes and the nose, short on the muzzle so that its shape and the mouth show.
    hair *= ramp((eye_off(v.co)-EYEBALL*.9)/(EYEBALL*.6))*ramp((v.co-tip).length/.03-.6)*(.3+.7*ramp((v.co-tip).length/.08))
    if (v.co-tip).length < .05:
        hair *= ramp((dark[v.index]-.3)/.12)  # the nose's leather, dark on the colour map, is bare
    mask.data[v.index].color = (FUR*clamp(hair), 0, 1, 1)
body.data.color_attributes.active_color = mask

uvs = body.data.uv_layers.active.data

# Measured against the reference part by part (in the game, in direct light), the trunk, legs and tail came out a
# little dark and the paws light: the colour map of each is brought to the reference's.
TONE = {"haunch": (1, 1.07, 1.02), "back": (1, 1.07, 1.02), **{part: (1.12, 1.14, 1.12) for part in ("arm", "forearm", "thigh", "shin")}, "paw": (.84, .81, .74), "foot": (.84, .81, .74),
        "tail1": (1.12, 1.2, 1.14), "tail2": (1.12, 1.2, 1.14)}
texels = np.array(colour.pixels[:]).reshape(height, width, 4)
TONE["brow"] = (.9, .94, .92)  # the top of the head, above the eyes
brow = max(socket.z for socket in sockets.values())+.012
eyes, PALE = min(socket.z for socket in sockets.values()), (1.19, 1.19, 1.22)
tone = np.ones((height, width, 3))
for f in body.data.polygons:
    on = {}
    for i in f.vertices:
        for g in body.data.vertices[i].groups:
            part = body.vertex_groups[g.group].name.split("_")[0]
            on[part] = on.get(part, 0)+g.weight/len(f.vertices)
    part = max(on, key=on.get) if on else None
    if part == "skull" and min(body.data.vertices[i].co.z for i in f.vertices) > brow:
        part = "brow"
    # The cheeks, the jowls and the throat (below the eyes, behind the muzzle, as far as the shoulders) are pale in
    # the reference, where long light hair lies over them: placed by eye and nose, they measured a sixth darker.
    pale = ramp((eyes-.008-f.center.z)/.02)*ramp((f.center.y-tip.y-.035)/.03)*ramp((.02-f.center.y)/.05)*ramp((f.center.z-.13)/.04)
    if part in TONE or pale > 0:
        corners = np.array([(uvs[l].uv.x % 1*width, uvs[l].uv.y % 1*height) for l in f.loop_indices])
        (x0, y0), (x1, y1) = np.floor(corners.min(axis=0)).astype(int), np.ceil(corners.max(axis=0)).astype(int)
        tone[max(0, y0):y1+1, max(0, x0):x1+1] = np.array(TONE.get(part, (1, 1, 1)))*(1+pale*(np.array(PALE)-1))
texels[:, :, :3] *= tone
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
    long *= ramp((eye_off(root)-.02)/.035)  # none to hang over the eyes
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
    socket, facing = sockets[sign], facings[sign]
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=EYEBALL, location=socket-facing*EYEBALL*.5)
    eye = bpy.context.object
    eye.name = "eye_"+side
    bpy.ops.object.shade_smooth()
    eye.data.materials.append(glass)
    # A black pupil looking out of the head, a dark brown iris round it, as good as black beyond.
    look = facing
    iris = eye.data.color_attributes.new("iris", "FLOAT_COLOR", "POINT")
    for v in eye.data.vertices:
        out = v.normal.dot(look)
        iris.data[v.index].color = (.004, .003, .003, 1) if out > .8 else (.07, .03, .012, 1) if out > .25 else (.014, .009, .007, 1)
    eyes.append(eye)
# The whiskers: seven thin pale hairs a side, out of the muzzle beside and below the nose, each sagging to its tip.
random.seed(7)
points, faces = [], []
for sign in (-1, 1):
    cheek = sorted((v.co for v in body.data.vertices if nose+.012 < v.co.y < nose+.05 and (v.co.x-head_x)*sign > .012 and tip.z-.05 < v.co.z < tip.z-.008
                    and (v.co-tip).length < .06),
                   key=lambda c: c.y)
    roots = cheek[::max(1, len(cheek)//7)][:7]
    for root in roots:
        out = Vector((sign, random.uniform(-.45, .1), random.uniform(-.2, .2))).normalized()
        a, b = out.cross(Vector((0, 0, 1))).normalized(), out.cross(out.cross(Vector((0, 0, 1)))).normalized()
        long, first = random.uniform(.03, .055), len(points)
        for i in range(6):
            t = i/5
            middle = root+out*long*t-Vector((0, 0, .012*t*t))
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
# A fore paw at its face lies on it, its palm (the paw's +Z) to the face and its claws up along it: to above the eye
# of its own side (rubbing its face in its sleep) or to the eye (grooming its muzzle). Each paw turns so only as far
# as it is at the face (AIM, keyed in each clip); asleep, its palms are turned to its face as well.
face = (sockets[1]+sockets[-1])/2
face = face.lerp(tip, .5)-Vector((0, 0, .01))  # the middle of the face, between the eyes and the nose
aims = {}
for side, sign in (("L", 1), ("R", -1)):
    for name, at in (("cheek", sockets[sign]+Vector((0, .005, .018))), ("muzzle", sockets[sign].lerp(tip, .3)), ("palm", face)):
        mark = bpy.data.objects.new(f"{name}_{side}", None)
        mark.location = at
        scene.collection.objects.link(mark)
        onto([mark], "skull")
        aims[name, side] = mark
for side in ("L", "R"):
    for name in ("cheek", "muzzle", "palm"):
        aim = rig.pose.bones["paw_"+side].constraints.new("DAMPED_TRACK" if name != "palm" else "LOCKED_TRACK")
        aim.name, aim.target, aim.influence = name, aims[name, side], 0
        if name == "palm":
            aim.lock_axis, aim.track_axis = "LOCK_Y", "TRACK_Z"  # turned about its own length, palm to the face


# Inside the mouth: its dark lining (see MOUTH) and a beaver's orange incisors, two above, which show a little below the
# upper lip, and two below, behind the lower lip.
def part(name, colour, rough, at, size, groups, shape=None):
    if shape:
        made = bpy.data.meshes.new(name)
        made.from_pydata(*shape[:1], [], shape[1])
        thing = bpy.data.objects.new(name, made)
        scene.collection.objects.link(thing)
        bpy.context.view_layer.objects.active = thing
    else:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=1, location=at)
        thing = bpy.context.object
        thing.name = name
        thing.scale = size
        bpy.ops.object.transform_apply(scale=True)
    thing.data.shade_smooth()
    stuff = bpy.data.materials.get(name.split("_")[0])  # the teeth share one
    if not stuff:
        stuff = bpy.data.materials.new(name.split("_")[0])
        stuff.use_nodes = True
        shader = next(n for n in stuff.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        shader.inputs["Base Color"].default_value, shader.inputs["Roughness"].default_value = (*colour, 1), rough
    thing.data.materials.append(stuff)
    for bone in ("skull", "jaw"):
        thing.vertex_groups.new(name=bone)
    for v in thing.data.vertices:
        below = groups(v.co)
        thing.vertex_groups["jaw"].add([v.index], below, "REPLACE")
        thing.vertex_groups["skull"].add([v.index], 1-below, "REPLACE")
    thing.parent = rig
    thing.modifiers.new("Kit skeleton", "ARMATURE").object = rig
    return thing


middle = tip.x+(head_x-tip.x)*.3  # the muzzle's middle: the head is turned a little to its left
on_lip = lambda behind, down=0: Vector((middle, tip.y+behind, lip(Vector((0, tip.y+behind, 0)))-down))
# Of the lining, as much goes with the jaw as of the skin before it: none above the lips, all below, half on the line.
mouth = [part("mouth", (.16, .03, .035), .55, None, None, lambda c: ramp((lip(c)-c.z)/.006+.5)*ramp((hinge-c.y)/.03), shape=lining)]
for sign in (-1, 1):
    for below in (False, True):
        tooth = on_lip(MOUTH["teeth"]+(.0025 if below else 0))+Vector((sign*.0016, 0, -.0027 if below else .0027))
        mouth.append(part(f"tooth_{'lower' if below else 'upper'}_{'R' if sign < 0 else 'L'}", (.8, .38, .1), .3, tooth, (.0013, .001, .0032), lambda c, b=below: float(b)))
# The four incisors are drawn as one.
bpy.ops.object.select_all(action="DESELECT")
for tooth in mouth[1:]:
    tooth.select_set(True)
bpy.context.view_layer.objects.active = mouth[1]
bpy.ops.object.join()
mouth[1].name = "teeth"
mouth = mouth[:2]
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


AIM = {}


def pose(clip, t):
    wave, beat = sin(2*pi*t), cos(2*pi*t)
    run, walk = clip == "run", clip == "walk"
    forage, look, sit = clip == "forage", clip == "look", clip == "sit"
    up, groom, sleep = clip == "up", clip == "groom", clip == "sleep" or clip in STIRS  # a stir is asleep too
    tall, lean, touch = clip == "tall", clip == "lean", clip == "touch"
    upright, lie = up or groom or tall or lean, clip == "lie" or sleep
    shake, wake = clip == "shake", clip == "wake"
    between = lambda a, b: ramp((t-a)/(b-a))
    # Touching: its right fore paw goes out ahead and pats what is there, three times, and comes back (how far out).
    reach = between(.08, .28)*(1-between(.82, .98)) if touch else 0
    # Asleep: how far it breathes in, and how far its stir has come, 0 … 1 and back: the rub quickly, the rest slowly.
    breath = sin(2*pi*BREATHS*t) if clip == "sleep" else 0
    stir = ramp(t/.15)*ramp((1-t)/.15) if clip == "rub" else sin(pi*t)**2 if clip in STIRS else 0
    rubbing, stretching, nuzzling, peeping = (stir if clip == name else 0 for name in STIRS)
    # A bound: the back rears as the hind pair pushes off and dips as the fore pair lands; the hips ride highest
    # while the hind feet swing forward under them.
    pitch = .14*sin(2*pi*(t-.1)) if run else .013*wave
    pitch += -.2 if forage else .5 if sit else 1.0 if up else .9 if groom else 1.35+.02*wave if tall else 1.15 if lean else .1+(.01*breath+.08*stretching if sleep else 0) if lie else 0
    lift = .03*cos(4*pi*t)-.085 if walk else -.09-.06*sin(2*pi*(t+.05)) if run else .008*wave
    lift -= .42 if sit else .40 if up else .42 if groom else .08 if tall else .12 if lean else .55-(RAISED+.006*breath if sleep else 0) if lie else 0
    head = (-1+.05*sin(4*pi*t) if forage else .4+.03*sin(12*pi*t) if look else .1 if sit else .15+.03*sin(4*pi*t) if up
            else -.25+.05*sin(30*pi*t) if groom else .1+.04*sin(4*pi*t) if tall else .3 if lean else -.4*reach if touch else REST["nose"]+.12*rubbing-.08*nuzzling+.3*peeping if sleep else .2 if lie else 0)
    gaze = (.28*wave if forage else .6*wave if look else .45*wave if sit else .7*wave if up else .5*wave if tall else .3*wave if lean else .2*reach if touch else REST["head"]+.15*sin(4*pi*t)*nuzzling if sleep
            else .35*wave if lie else -.07*beat if walk else 0)
    # Shaking itself dry, it rolls about its own length, five times to each side in a second, the head first and
    # furthest and each part behind it a little later and less: rad the head, the chest, the rump and the tail are
    # rolled over (the legs stay under it, see below). It ducks a little as it does.
    skew, chest, rump, flick = (SHAKE*ramp(t/.2)*ramp((1-t)/.3)*sin(10*pi*(t-late))*far if shake else 0
                                for late, far in ((0, 1), (.03, .6), (.06, .42), (.1, .7)))
    if shake:
        lift, head = -.07*ramp(t/.2)*ramp((1-t)/.3), -.12*ramp(t/.2)*ramp((1-t)/.3)
    # Waking, it goes from the sleep's pose to the stand's: how far its head is up off the ground (and its back and
    # tail uncurled), how wide it yawns, how far its rump is up, and how far its chest has come up after it.
    roused, yawn, risen, stood = between(.03, .2), between(.06, .22)*(1-between(.32, .46)), between(.36, .58), between(.74, .96)
    bow = risen*(1-stood)  # rump up, chest still down: the stretch
    if wake:
        # The chest stays on the ground while the rump goes up: the back tips forward as the hips rise.
        pitch, lift = .1*(1-risen)-.42*bow, -(.55-RAISED*(1-roused))*(1-risen)
        head, gaze = REST["nose"]*(1-roused)+.5*yawn+.12*bow, REST["head"]*(1-roused)
        skew = .12*yawn  # a yawn is a little crooked
    # Over on its side, its head on its cheek; nuzzling rocks it, peeping it rolls up a little.
    # Waking, it rolls back up.
    over = SIDE*(1-.15*peeping)+.12*sin(4*pi*t)*nuzzling if sleep else SIDE*(1-roused) if wake else 0
    pb["haunch"].location = rest["haunch"].inverted() @ Vector((0, 0, lift*M))
    # The waddle: hips and shoulders roll against each other and the back swings from side to side with the stride.
    turn("haunch", 0, .06*wave if walk else rump+over)
    turn("back", pitch+(REST["curl"] if sleep else REST["curl"]*(1-roused) if wake else 0), -.10*wave if walk else chest-rump, .07*beat if walk else 0)
    turn("skull", -.88*pitch+.025*wave+head, skew-chest, gaze, pitch)
    turn("jaw", -.06 if run else -.7*yawn if wake else -.35*between(.08, .25)*(1-between(.5, .7)) if clip == "peep" else 0)
    # The flat tail trails: it sways with the stride, bounces at a run, lies on the ground when the kit is down and
    # flicks as it stretches in its sleep.
    sway = .2*stretching if sleep else (.3 if walk else .12 if run else .06)*sin(2*pi*t+.6)
    if wake:
        sway *= between(.05, .35)
    sway += flick
    turn("tail1", (.10+.18*sin(2*pi*(t-.35)) if run else -.35 if sit else -.2 if upright else -.08 if lie else -.08*(1-risen)-.3*bow if wake else 0)+.03*wave, -over, sway)  # flat on the ground, however it lies
    turn("tail2", (.06+.12*sin(2*pi*(t-.5)) if run else -.15 if sit else 0), 0, sway*.8)
    for (fore, side), ((a, b, c, d), names) in legs.items():
        parent = pitch if fore else 0
        upper0, lower0 = angle(a, b), angle(b, c)
        if fore and upright:
            # Paws held close to its body, at its chest; grooming, both go up to the muzzle and rub it, one after the
            # other; leaning, both rest on the thing before it.
            rub = sin(30*pi*t+(pi if side == "L" else 0))
            lean_back = pitch-1.35  # its arms are held as its body is: less upright on its haunches than on its feet
            upper = 1.35+.06*rub if groom else 1.3 if lean else ARMS[0]+lean_back+.035*wave
            lower = 2.35+.22*rub if groom else 1.5 if lean else ARMS[1]+lean_back+.03*wave
            foot = 1.8 if groom else -.3 if lean else ARMS[2]
        else:
            offset = (.06 if side == "L" else 0)+(.46 if fore else 0) if run else (.5 if side == "L" else 0)+(.18 if fore else 0)
            swing = (.30 if run else .15)*M
            f, h = footpath((t-offset) % 1, .35 if run else .62, RUN if run else WALK, swing) if walk or run else (0, 0)
            if touch and fore and side == "R":
                f, h = .5*M*reach, .14*M*reach*(.3+.7*abs(sin(3*pi*clamp((t-.3)/.52))))  # out, and patting
            if forage and fore and side == "R" and t > .5:
                f, h = footpath((t-.5)*6 % 1, .6, .3*M, .08*M)  # three scrapes at the ground
            if sit:
                f = (-.3 if fore else .5)*M  # front paws drawn back under the chest, hind feet out in front of the rump
            if upright:
                f = (.45 if up or groom else .05)*M  # the hind feet, out in front of the rump; on its feet, under its hips
            if lie:
                f = (.4 if fore else -.55-.25*stretching)*M  # flat on its belly: paws out in front, hind legs trailing behind
                if sleep and fore:
                    f = REST["paws"][side == "R"]*M  # over on its side, the fore paws are drawn back to its chest
            if wake:
                # Each foot is stepped to its place, the right one first: the hind feet from behind it to under its
                # hips before the rump goes up, the fore paws a little further out for the stretch and then back
                # under its shoulders as the chest comes up.
                first = .08 if side == "L" else 0
                steps = ((.36+first, .46+first), (.76+first, .88+first)) if fore else ((.16+first, .3+first),)
                trail = 1-between(*steps[0])  # how far a hind foot still lies behind it, its sole up
                f = ((.4+.12*between(*steps[0]))*(1-between(*steps[1]))-(.4-REST["paws"][side == "R"])*(1-roused) if fore else -.55*trail)*M
                h = .1*M*sum(sin(pi*clamp((t-a)/(b-a)))**2 for a, b in steps)
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
            if wake and not fore:
                foot = (lower-lower0-1.2)*trail+foot*(1-trail)
            if fore and (sleep or wake):
                foot += (lower-lower0+REST["bent"]-foot)*(1 if sleep else 1-roused)  # curled at its chest
            if sleep and not fore:
                foot -= .4*stretching  # stretched out, the soles turn up further
            if fore and side == "L" and rubbing:
                # The fore paw on top goes up to its face and rubs it, as the pup's flipper does in the reference.
                stroke = sin(2*pi*STROKES*t)
                upper += (RUBBING[0]+.08*stroke-upper)*rubbing
                lower += (RUBBING[1]+.25*stroke-lower)*rubbing
                foot += (RUBBING[2]-foot)*rubbing
        ua, la = upper-upper0, lower-lower0
        # Shaking, the legs stay upright under a body that rolls; over on its side, the upper ones lie down over it and
        # the lower ones along the ground.
        drape = ((DRAPE[0]*(1-rubbing) if fore else DRAPE[1]*(1-1.2*stretching)) if side == "L" else DRAPE[2])*(1 if sleep else 1-roused if wake else 0)
        turn(names[0], ua-parent, drape-(chest if fore else rump))
        turn(names[1], la-ua)
        turn(names[2], foot-la, 0, (.35 if side == "L" else -.35)*stretching if not fore else 0)  # stretched, the hind feet spread
        # Its digits, curled in towards the palm (rad) and spread apart (of SPREAD): curled at its chest asleep and
        # cupped at its face, flexing as a paw lifts; the hind toes spread wide and straighten as it stretches.
        if fore and (tall or lean or touch):
            curl, spread = (.65, 0) if tall else (.05, .5) if lean else ((-.3*reach, .6*reach) if side == "R" else (0, 0))
        elif fore:
            curl = (.9*(1-rubbing)+(.5+.15*sin(2*pi*STROKES*t))*rubbing if sleep else .6 if groom else .7 if up
                    else .2 if sit or lie else .9*(1-roused) if wake else .3+.3*sin(12*pi*t) if forage and side == "R" and t > .5 else 0)
            spread = 0
        else:
            curl, spread = (.3*(1-stretching)-.25*stretching if sleep else .3*(1-roused) if wake else 0), stretching
        if walk or run:
            curl += .5*h/swing
        for i in range(5):
            pb[f"{names[2]}.{i}"].rotation_quaternion = Quaternion((1, 0, 0), curl) @ Quaternion((0, 0, 1), SPREAD*(2-i)/2*spread)
        if fore:
            AIM[side] = {"cheek": rubbing if side == "L" else 0, "muzzle": 1 if groom else 0}
            # Asleep, its paws curled under its chin turn their palms to its face too; waking, they let go.
            AIM[side]["palm"] = max(*AIM[side].values(), 1 if sleep else 1-roused if wake else 0)
    for side in ("L", "R"):
        for name, share in AIM[side].items():
            pb["paw_"+side].constraints[name].influence = share


rig.animation_data_create()
for name, frames in [("stand", 48), ("walk", 30), ("run", 20), ("forage", 120), ("look", 120), ("sit", 120),
                     ("up", 120), ("groom", 150), ("lie", 120), ("sleep", 120), ("tall", 150), ("lean", 120), ("touch", 120), ("shake", 30), ("wake", 60),
                     *((name, round(seconds*30)) for name, seconds in STIRS.items())]:
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    for frame in range(frames+1):
        pose(name, frame/frames)
        pb["haunch"].keyframe_insert("location", frame=1+frame)
        for bone in pb:
            bone.keyframe_insert("rotation_quaternion", frame=1+frame)
        for side in ("L", "R"):
            for aim in pb["paw_"+side].constraints:
                aim.keyframe_insert("influence", frame=1+frame)
    slot = rig.animation_data.action_slot
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    strip.action_slot = slot

if "--" in sys.argv:
    path = os.path.abspath(sys.argv[sys.argv.index("--")+1])
    bpy.ops.object.select_all(action="DESELECT")
    for obj in (rig, body, strands, *eyes, *mouth):
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
