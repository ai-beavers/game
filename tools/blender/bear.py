"""Build Ursus arctos from an empty studio. Blender -b --factory-startup -P bear.py -- assets/bear.glb

Metres, facing -Y (+Z in glTF). Animal Diversity Web (animaldiversity.org/accounts/Ursus_arctos/):
0.90–1.50 m at the shoulder, 1–2.8 m nose to rump. Klaus Jost's Brooks Falls photograph there
shows the high shoulder, dipped forehead, low-set muzzle and long, dark lower legs.
Shine et al., J Exp Biol 218 (2015), doi:10.1242/jeb.121806: lateral-sequence walking.
Compare the side-on grizzly in Shine & McGowan (WCB 2018, fig. 1) and Stefano Crosio's
“Coastal Brown Bear Determination” (2013) for the forward reach and bent wrist during a run.
The charge uses a staggered hind pair followed by a staggered fore pair, exaggerated at game speed.
"""
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np
from mathutils import Quaternion, Vector, noise

sin, cos, pi = math.sin, math.cos, math.pi
scene = bpy.context.scene
scene.render.fps = 30
parts = []


def ellipsoid(center, radii, tilt=0, resolution=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=resolution, ring_count=resolution//2, location=center,
                                         rotation=(tilt, 0, 0), scale=radii)
    obj = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    parts.append(obj)
    return obj


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    obj = objects[0]
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()
    obj.name = name
    return obj


def segment(a, b, width, depth, extra):
    a, b = Vector(a), Vector(b)
    axis = b - a
    return ellipsoid((a+b)/2, (width, depth, axis.length/2+extra), math.atan2(-axis.y, axis.z))


# Skeleton landmarks are also the centres used to sculpt and bind the limbs.
HIP = (0, .57, .88)
NECK = (0, -.68, 1.08)
bones = {"haunch": (HIP, (0, .34, .94), None), "back": (HIP, NECK, "haunch"),
         "skull": (NECK, (0, -1.27, 1.13), "back"),
         "jaw": ((0, -.97, 1.06), (0, -1.36, 1.01), "skull")}
legs = {}
for side, sign in (("R", -1), ("L", 1)):
    for fore in (True, False):
        x = sign * (.305 if fore else .28)
        points = [(x, y, z) for y, z in (
            [(-.47, 1.07), (-.32, .55), (-.53, .13), (-.73, .075)] if fore else
            [(.57, .92), (.34, .54), (.66, .14), (.43, .075)])]
        names = [part+"_"+side for part in (("arm", "forearm", "paw") if fore else ("thigh", "shin", "foot"))]
        legs[fore, side] = points, names
        parent = "back" if fore else "haunch"
        for name, a, b in zip(names, points, points[1:]):
            bones[name] = a, b, parent
            parent = name

def clamp(x, low=0, high=1):
    return min(high, max(low, x))


def ramp(x):
    t = clamp(x)
    return t*t*(3-2*t)


def pigment(obj, paint):
    attr = obj.data.color_attributes.new(name="Pigment", type="BYTE_COLOR", domain="POINT")
    for v in obj.data.vertices:
        attr.data[v.index].color = (*paint(v.co), 1)
    for face in obj.data.polygons:
        face.use_smooth = True


def tuft(p):
    # Clumps of guard hair: where the coat stands out from the body (+) and where it parts (-).
    return noise.fractal(Vector((p[0]*22, p[1]*11, p[2]*20)), 1, 2, 3)


def coat(p):
    # Warm brown, as the reference bears: dark legs and belly, a lighter grizzled back, hump and neck, a pale tan
    # muzzle; streaks of nap, and shade where the hair parts.
    x, y, z = p
    nap = noise.fractal(Vector((x*14, y*6, z*8)), 1, 2, 3)
    high = ramp((z-.42)/.70)
    base = Vector((.070,.038,.021)).lerp(Vector((.235,.125,.064)), high)
    base = base.lerp(Vector((.370,.230,.122)), .65*high*ramp((.45-y)/.8))
    base = base * (1+.16*nap+.16*tuft(p))
    muzzle = ramp((-y-1.19)/.12) * ramp((.21-abs(x))/.08) * ramp((1.13-z)/.07)
    mask = ramp((-y-1.12)/.08) * ramp((.24-abs(x))/.07) * ramp((z-1.06)/.06)  # dark round the eyes and up the bridge
    return base.lerp(Vector((.56,.41,.25)), .9*muzzle).lerp(Vector((.085,.047,.028)), .55*mask*(1-muzzle))


def hide(name, names, weights):
    body = join(parts, name)
    parts.clear()
    body.data.remesh_voxel_size = .019
    bpy.ops.object.voxel_remesh()
    smooth = body.modifiers.new("Soften junctions", "SMOOTH")
    smooth.factor, smooth.iterations = .8, 4
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    # A shaggy outline: the coat stands out in clumps, less on the face and the paws.
    for v in body.data.vertices:
        face = ramp((-v.co.y-1.02)/.14)
        v.co += v.normal * .014 * tuft(v.co) * (1-.8*face) * ramp((v.co.z-.06)/.14)
    decimate = body.modifiers.new("Stream silhouette", "DECIMATE")
    decimate.ratio = .16
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    pigment(body, coat)
    groups = [body.vertex_groups.new(name=n) for n in names]
    for v in body.data.vertices:
        for group, weight in zip(groups, weights(v.co)):
            if weight > 0:
                group.add([v.index], weight, "REPLACE")
    return body


def trunk_weights(p):
    skull = ramp((-p.y-.52)/.36)
    haunch = ramp((p.y-.25)/.53)
    return haunch, 1-haunch-skull, skull


# The forms of the reference bears (sketchfab.com: "Realistic Brown Bear - Grizzled Shaggy Coat" by Pigcraft,
# "cheezeburger / grizzly bear" by toro ardido modelos, "Brown bear" by andrejsharapov, "Grizzly Bear" by DavidGamble;
# looked at, nothing of them is in here): a broad skull with round ears wide apart on its corners, a pale muzzle that
# tapers to the nose and is far narrower than the skull, small eyes close beside its root, a thick short neck with a
# ruff, the hump over the shoulders above the head, a deep chest, a back that falls to a round rump.
# Overlap the shoulder sockets with the chest. The raised arm must move independently of the flank.
ellipsoid((0, .12, .86), (.45, .82, .43))            # belly and flanks
ellipsoid((0, .60, .89), (.43, .47, .43))            # rump
ellipsoid((0, -.32, .99), (.48, .56, .46), .10)      # chest
ellipsoid((0, -.40, 1.25), (.30, .38, .20), .12)     # hump
ellipsoid((0, -.72, 1.02), (.36, .44, .34), -.20)    # neck
ellipsoid((0, -.80, .86), (.27, .30, .22))           # ruff under the throat
ellipsoid((0, -1.03, 1.07), (.30, .29, .26))         # skull
ellipsoid((0, -1.13, 1.16), (.21, .19, .13), -.25)   # forehead, falling to the muzzle
ellipsoid((0, -1.29, 1.005), (.150, .19, .120), -.08)  # muzzle, upper jaw
ellipsoid((0, -1.41, .995), (.118, .115, .098))
ellipsoid((0, 1.03, .80), (.075, .10, .085), -.35)   # tail
for s in (-1, 1):
    ellipsoid((s*.255, -.955, 1.315), (.115, .058, .118), -.12)  # ear
    ellipsoid((s*.215, -1.00, .97), (.13, .21, .16), .30)      # cheek ruff
    ellipsoid((s*.125, -1.215, 1.150), (.07, .085, .045), -.2) # brow
pieces = [hide("Trunk", ["haunch", "back", "skull"], trunk_weights)]
for (fore, side), ((a, b, c, d), names) in legs.items():
    segment(a, b, .19 if fore else .215, .21 if fore else .25, .14)
    segment(b, c, .148 if fore else .152, .165 if fore else .16, .105)
    ellipsoid((c[0], (c[1]+d[1])/2, .103), (.145, .205, .095))
    for toe in range(-2, 3):
        ellipsoid((c[0]+toe*.046, d[1]-.032+.012*abs(toe), .073), (.042, .107, .064))

    def limb_weights(p):
        upper = ramp((p.z-b[2]+.12)/.24)
        foot = ramp((c[2]+.06-p.z + max(0,c[1]-p.y)*.46)/.095) if p.z < .28 else 0
        return upper, 1-upper-foot, foot

    pieces.append(hide(names[0], names, limb_weights))
parts.extend(pieces)


def detail(center, radii, color, bone, tilt=0):
    obj = ellipsoid(center, radii, tilt, 12)
    pigment(obj, lambda p: color)
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1, "REPLACE")
    return obj


# The lower jaw closes up into the muzzle: shut, only its lip shows; open (the growl), the dark mouth and the canines.
detail((0,-1.275,.915), (.112,.205,.062), (.30,.20,.115), "jaw")
detail((0,-1.29,.962), (.092,.17,.016), (.045,.014,.015), "jaw")
detail((0,-1.508,1.03), (.062,.04,.05), (.012,.010,.009), "skull")  # nose
for s in (-1,1):
    # The eye sits in the hide where a look from the front meets it, close beside the muzzle's root.
    _, at, _, _ = pieces[0].ray_cast(Vector((s*.118, -3, 1.112)), Vector((0, 1, 0)))
    detail((at.x, at.y+.008, at.z), (.024,.018,.024), (.010,.007,.005), "skull")
    detail((s*.055,-1.40,.925), (.013,.015,.032), (.66,.56,.40), "skull")         # canine
for (fore, side), ((_, _, c, d), names) in legs.items():
    detail((c[0], c[1]-.051, .024), (.099,.105,.024), (.076,.046,.037), names[2])
    for toe in range(-2,3):
        detail((c[0]+toe*.045, d[1]-.025+.012*abs(toe), .029), (.029,.047,.018), (.085,.049,.035), names[2])
        # Long, curved digging claws taper to a downturned tip.
        x, y = c[0]+toe*.046, d[1]-.102+.012*abs(toe)
        obj = detail((x,y,.075), (.019,.083 if fore else .052,.021), (.54,.428,.289), names[2])
        for v in obj.data.vertices:
            t = clamp((y-v.co.y)/(.083 if fore else .052))
            v.co.x = x+(v.co.x-x)*(1-.78*t)
            v.co.z = .075+(v.co.z-.075)*(1-.75*t)-.032*t*t

body = join(parts, "Bear hide")
mat = bpy.data.materials.new("Umber guard hair")
mat.use_nodes = True
mat.use_backface_culling = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Roughness"].default_value = .91
body.data.materials.clear()
body.data.materials.append(mat)
# A seamless swatch of short brush strokes, running down the flanks. Vertex pigment carries the markings.
uv = body.data.uv_layers.active or body.data.uv_layers.new()
for loop in body.data.loops:
    x, y, z = body.data.vertices[loop.vertex_index].co
    uv.data[loop.index].uv = ((y+.67*x+1.8)/3.4, (z+.24*y+.45)/2.4)
rng = np.random.default_rng(73)
grain = rng.normal(0,1,(256,256))
nap = sum(np.roll(grain, (k,k//4), axis=(0,1)) for k in range(9))/3
value = np.clip(.9+.068*nap,.66,1)
rgba = np.ones((256,256,4),np.float32)
rgba[:,:,:3] = value[:,:,None]
image = bpy.data.images.new("Brush strokes",256,256)
image.pixels.foreach_set(rgba.ravel())
image.pack()
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = image
pigments = mat.node_tree.nodes.new("ShaderNodeVertexColor")
pigments.layer_name = "Pigment"
mix = mat.node_tree.nodes.new("ShaderNodeMix")
mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
mix.inputs[0].default_value = 1
mat.node_tree.links.new(pigments.outputs["Color"], mix.inputs[6])
mat.node_tree.links.new(tex.outputs["Color"], mix.inputs[7])
mat.node_tree.links.new(mix.outputs[2], bsdf.inputs["Base Color"])

armature = bpy.data.armatures.new("Brown bear skeleton")
rig = bpy.data.objects.new("Brown bear", armature)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for name, (a,b,parent) in bones.items():
    bone = armature.edit_bones.new(name)
    bone.head, bone.tail = a,b
    if parent:
        bone.parent = armature.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")
body.parent = rig
body.modifiers.new("Brown bear skeleton", "ARMATURE").object = rig
pb = rig.pose.bones
rest = {b.name:b.matrix_local.to_quaternion() for b in armature.bones}


def turn(name, pitch=0, roll=0, yaw=0, parent=0):
    # Positive pitch raises the nose. Angles are relative to the parent's rotation, but for yaw, which turns the
    # nose to the bear's left about the upright axis: `parent` is the parent's own pitch, taken out for it.
    q = Quaternion((-1,0,0),-parent) @ Quaternion((0,0,1),yaw) @ Quaternion((0,1,0),roll) @ Quaternion((-1,0,0),parent+pitch)
    pb[name].rotation_quaternion = rest[name].inverted() @ q @ rest[name]


def angle(a,b):
    return math.atan2(a[1]-b[1], a[2]-b[2])


def footpath(phase, stance, stride, height):
    # A planted foot moves backward exactly as far as the root travels.
    if phase < stance:
        return (.5*stance-phase)*stride, 0
    t = (phase-stance)/(1-stance)
    return (ramp(t)-.5)*stance*stride, height*sin(pi*t)**2


def pose(clip,t):
    wave = sin(2*pi*t)
    run, walk = clip == "gallop", clip == "walk"
    up = clip in ("warn","raise","strike")
    # What it does between two ambles: nose to the ground and a paw digging, nose in the wind, down on its haunches.
    forage, look, sit = clip == "forage", clip == "look", clip == "sit"
    recoil = sin(pi*min(1,t*2)) if clip == "flinch" else 0
    hit = ramp(t/.40) if clip == "strike" else 0
    pitch = (1.21-.91*hit if up else -.05*wave if run else .013*wave)+.14*recoil
    pitch += -.2 if forage else .5 if sit else 0
    lift = (.016*cos(4*pi*t)-.085 if walk else .038*wave-.09 if run else .008*wave)
    lift -= .42 if sit else 0
    head = -1+.05*sin(4*pi*t) if forage else .4+.03*sin(12*pi*t) if look else .1 if sit else 0
    gaze = (.28 if forage else .6 if look else .45 if sit else 0)*wave
    advance = .36*hit
    pb["haunch"].location = rest["haunch"].inverted() @ Vector((0,-advance,lift))
    turn("back",pitch)
    turn("skull",-.88*pitch + (.055*wave if up else .025*wave)+.18*recoil+head, 0, gaze, pitch)
    turn("jaw",-.21-.06*wave if up else -.06 if run else 0)
    for (fore,side), ((a,b,c,d),names) in legs.items():
        parent = pitch if fore else 0
        upper0, lower0 = angle(a,b), angle(b,c)
        if fore and up:
            # The warning leaves both paws below the chin. The right winds up overhead, then reaches forward.
            right = side == "R" and clip != "warn"
            upper = (2.43-1.02*hit if right else .49)+.035*wave
            lower = (3.37-2.21*hit if right else 1.66)+.03*wave
            foot = (1.70-1.75*hit if right else .09)
        else:
            offset = (.10 if side=="L" else 0) + (.48 if fore else 0) if run else (.5 if side=="L" else 0)+(.18 if fore else 0)
            f,h = footpath((t-offset)%1, .35 if run else .62, 2.4 if run else 1.5, .24 if run else .115) if walk or run else (0,0)
            if forage and fore and side == "R" and t > .5:
                f,h = footpath((t-.5)*6%1, .6, .3, .08)  # three scrapes at the ground
            if sit:
                f = -.3 if fore else .5  # front paws drawn back under the chest, hind feet out in front of the rump
            # Two-link sagittal IK keeps a planted wrist/ankle at its ground target as the body bobs.
            af,az = HIP[1]-a[1],a[2]-HIP[2]
            df = (a[1]-c[1])+f-advance + af*(1-cos(parent))+az*sin(parent)
            dz = c[2]+h-a[2]-lift-af*sin(parent)+az*(1-cos(parent))
            u,l = (Vector(b)-Vector(a)).length,(Vector(c)-Vector(b)).length
            dist = clamp(math.hypot(df,dz),abs(u-l)+.001,u+l-.001)
            direction = math.atan2(df,-dz)
            bend = -1 if fore else 1
            upper = direction + bend*math.acos(clamp((u*u+dist*dist-l*l)/(2*u*dist),-1,1))
            lower = direction - bend*math.acos(clamp((l*l+dist*dist-u*u)/(2*l*dist),-1,1))
            foot = -.22*h/(.24 if run else .115)
        ua,la = upper-upper0,lower-lower0
        turn(names[0],ua-parent)
        turn(names[1],la-ua)
        turn(names[2],foot-la)


rig.animation_data_create()
for name, frames in [("stand",48),("walk",30),("gallop",30),("warn",36),("raise",24),("strike",15),("flinch",24),
                     ("forage",120),("look",120),("sit",120)]:
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    for frame in range(frames+1):
        pose(name,frame/frames)
        pb["haunch"].keyframe_insert("location", frame=1+frame)
        for bone in pb:
            bone.keyframe_insert("rotation_quaternion", frame=1+frame)
    slot = rig.animation_data.action_slot
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name,1,action)
    strip.action_slot = slot

if "--" in sys.argv:
    path = os.path.abspath(sys.argv[sys.argv.index("--")+1])
    bpy.ops.object.select_all(action="DESELECT")
    for obj in (rig,body):
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format="GLB",
        export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_vertex_color="ACTIVE",
        export_image_format="WEBP", export_image_quality=90)
    cli = ["bunx", "@gltf-transform/cli@4.5.1"]
    with tempfile.TemporaryDirectory() as temp:
        packed = Path(temp) / "bear.gltf"
        subprocess.run([*cli, "quantize", "--pattern", "{NORMAL,TEXCOORD_*,WEIGHTS_*,COLOR_*}", path, packed], check=True)
        # CLI 4.5.1 checks POSITION when deciding whether to declare quantized normals. Positions here stay floats.
        gltf = json.loads(packed.read_text())
        for field in ("extensionsUsed", "extensionsRequired"):
            if "KHR_mesh_quantization" not in gltf[field]:
                gltf[field].append("KHR_mesh_quantization")
        packed.write_text(json.dumps(gltf))
        subprocess.run([*cli, "copy", packed, path], check=True)
