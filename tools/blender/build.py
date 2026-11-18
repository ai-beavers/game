# Builds the beaver in Blender from nothing and exports it as glTF: the body, a T-shirt, a rig of the
# main body parts, the animations, a muscle morph target and the masks the fur shader in beaver.js reads.
#
#   blender -b --factory-startup -P build.py -- beaver.glb [--save beaver.blend]
#
# The beaver stands 1 m tall, faces -Y, +X is its left (glTF: faces +Z).
# Bones: hips, spine, chest, head, brow, upper_arm/forearm/hand, thigh/shin/foot (_L/_R), tail1, tail2.
# Animations (CLIPS at the end): walk, rage, stand, pickup, jump, build, fly, and arm poses flex_*.
# beaver.js plays them in layers: body, arms and brows each take their bones from a different clip.
# Morph target "muscle" (body and shirt) turns it into a bodybuilder.
# Vertex colour of the body: R = fur length, G = pale markings, B = shade in creases, A = covered by the shirt.
# pose functions are the only place that moves the bones.
#
# Proportions are measured by measure.py against published body measurements of Castor canadensis and against
# photographs; all are inside the animal's range. Shape and colours are checked against photographs on Wikimedia
# Commons (2026-11-17), side by side with renders
# of the beaver without its shirt (beaver.html?bare): "Beaver Preparing for Winter" (NPS, standing upright),
# "European beaver sitting in snow close up" (W. Garst, front, dry coat), "Praying for a Sunny Weekend" (K. Law,
# head in profile), "Picture Natural History - Beaver feet and tail". From them: the dark umber coat with long
# guard hair, the head as a blunt wedge, small eyes high and far back, a small matt nose, incisors that just
# show, fine grey-brown whiskers, nearly black hands and feet, the flat scaly tail. Not from them: it walks
# upright (beavers do stand and carry things on their hind legs, but do not stride), its arms are long enough to
# pose, and anger turns it red and muscular.
# The build (a large head that runs into the back without a step) follows a beaver model the user chose as a
# reference: sketchfab.com/3d-models/beaver-6fd1d674… by Ramhat. It is not downloadable and not licensed for reuse,
# so nothing of it is in here: no mesh, no texture. The look is painterly-warm and made to read at 60 px on a stream:
# a chestnut coat with a cream belly and muzzle, umber hands and feet, a broad charcoal paddle with diamond scales,
# larger eyes with a catchlight, bright orange incisors, and a short shirt that leaves rump and tail free.
import bpy, bmesh, math, subprocess, sys, tempfile
import numpy as np
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS


def activate(obj, *others):
    bpy.ops.object.select_all(action="DESELECT")
    for o in (obj, *others):
        o.select_set(True)
    bpy.context.view_layer.objects.active = obj


def blob(parts, name, voxel, smooth=6):
    """Fuse ellipsoids (centre, radii, euler rotation) into one smooth mesh."""
    objs = []
    for centre, radii, *rot in parts:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, location=centre, rotation=rot[0] if rot else (0, 0, 0), scale=radii)
        objs.append(bpy.context.object)
    obj = objs[0]
    activate(obj, *objs[1:])
    if len(objs) > 1:
        bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)  # vertex coordinates are world coordinates from here on
    obj.name = name
    obj.data.remesh_voxel_size = voxel
    bpy.ops.object.voxel_remesh()
    mod = obj.modifiers.new("smooth", "SMOOTH")
    mod.factor, mod.iterations = 1, smooth
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth()
    return obj


def material(name, colour, roughness=0.5, **inputs):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    for key, value in inputs.items():
        bsdf.inputs[key.replace("_", " ")].default_value = value
    return mat


# ---- body: everything the fur covers is one mesh -------------------------------------------------------------
Z_UP = Vector((0, 0, 1))
side = lambda x, sign: Vector((sign * x[0], x[1], x[2]))
mirrored = lambda p: Vector((abs(p.x), p.y, p.z))
SHOULDER, ARM = Vector((0.15, 0, 0.64)), Vector((math.sin(math.radians(50)), 0, -math.cos(math.radians(50))))  # A-pose, 50° from vertical
ELBOW, WRIST = SHOULDER + ARM * 0.19, SHOULDER + ARM * 0.36
EAR, EAR_INSIDE = Vector((0.136, 0.07, 0.915)), Vector((0.136, 0.054, 0.912))
# Placed against photographs of beavers: small eyes high and far back, a small matt nose, incisors that just show.
# Painterly: the eyes sit a little further forward and are as large as a real beaver's get, so the face reads on a
# phone; the orange incisors are long enough to show from across the clearing.
EYE, EYE_R, NOSE, TOOTH = Vector((0.094, -0.15, 0.897)), 0.025, Vector((0, -0.3, 0.822)), Vector((0.0175, -0.282, 0.748))
tilt = lambda sign: (0, -sign * math.radians(50), 0)  # along the arm
# The head is modelled large, where its parts are easy to place: every head coordinate in this file is "as
# modelled". head_size brings a point down to a beaver's proportions, about the top of the neck (measure.py
# checks the result against published measurements); head_model goes back.
NECK, HEAD_SCALE = Vector((0, -0.06, 0.745)), 0.66  # a little larger than life: the face carries the character
head_size = lambda p: NECK + (Vector(p) - NECK) * HEAD_SCALE
head_model = lambda p: NECK + (p - NECK) / HEAD_SCALE
head_part = lambda centre, radii: (head_size(centre), tuple(r * HEAD_SCALE for r in radii))
parts = [
    ((0, 0.04, 0.24), (0.175, 0.2, 0.21)),  # hips: the heavy end of the pear
    ((0, 0, 0.4), (0.178, 0.185, 0.29)),  # belly
    ((0, -0.05, 0.37), (0.16, 0.16, 0.2)),  # … round in front: the shirt shows it
    ((0, -0.01, 0.6), (0.155, 0.15, 0.19)),  # chest
    ((0, -0.045, 0.685), (0.12, 0.12, 0.085)),  # thick neck, ending below the head
    ((0, 0.03, 0.725), (0.105, 0.12, 0.1)),  # nape: the back runs up into the head without a step
    head_part((0, -0.03, 0.845), (0.145, 0.2, 0.128)),  # skull: broad, long and flat on top
    head_part((0, -0.2, 0.805), (0.105, 0.135, 0.09)),  # the muzzle carries the line on: in profile the head is a blunt wedge
    ((0, 0.17, 0.2), (0.085, 0.1, 0.08)),  # tail root
    ((0, 0.08, 0.46), (0.14, 0.115, 0.26)),  # the rounded back
]
for sign in (1, -1):
    parts += [
        head_part(side((0.074, -0.13, 0.785), sign), (0.076, 0.1, 0.08)),  # cheek: full and round, it frames the teeth
        head_part(side(EAR, sign), (0.042, 0.02, 0.042)),  # ear: small, round, far back
        (side(SHOULDER + ARM * 0.095, sign), (0.055, 0.055, 0.125), tilt(sign)),  # upper arm
        (side(ELBOW + ARM * 0.085, sign), (0.045, 0.045, 0.105), tilt(sign)),  # forearm
        (side((0.105, 0.06, 0.21), sign), (0.07, 0.12, 0.12)),  # haunch: a beaver carries its weight behind
        (side((0.105, 0, 0.18), sign), (0.085, 0.1, 0.11)),  # thigh
        (side((0.11, -0.01, 0.08), sign), (0.062, 0.07, 0.075)),  # shin
    ]
body = blob(parts, "body", 0.011, 18)  # smoothed well: a beaver is one round lump, not a stack of parts
body.data.materials.append(material("fur", (0.09, 0.045, 0.022), 0.9))  # beaver.js lays the fur over this


HEM, COLLAR, SLEEVE = 0.36, 0.7, 0.085  # heights of the shirt's edges, and how far down the arm the sleeves reach
# A short cut, its hem rising towards the back: in front it covers the belly, behind the rump and the tail show.
HEM_RISE = 0.38
HEM_NORMAL = Vector((0, -HEM_RISE, 1)).normalized()


def in_shirt(p, arm, slack=0.0):
    """The T-shirt covers the trunk below the neck and the top of the upper arms (rest pose).
    arm: how much of the vertex belongs to the arm bones; where arm and flank meet, position alone cannot tell."""
    if arm > 0.5:
        return (mirrored(p) - SHOULDER).dot(ARM) < SLEEVE + slack
    return HEM - slack < p.z - HEM_RISE * p.y and p.z < COLLAR + slack


# The fur shader's masks: short fur around eyes, nose, teeth and on the ears (none inside them); pale cheeks, chin
# and belly; and how open each point is to the sky, so creases (neck, armpits, between the legs) sit in shade.
tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
golden = math.pi * (3 - math.sqrt(5))
rays = [Vector((math.cos(golden * i) * math.sqrt(1 - z * z), math.sin(golden * i) * math.sqrt(1 - z * z), z)) for i in range(48) for z in [1 - (2 * i + 1) / 48]]
mask = body.data.color_attributes.new("fur", "FLOAT_COLOR", "POINT")
clear = [side(EYE, 1), side(EYE, -1), NOSE, Vector((0, TOOTH.y, TOOTH.z))]
LIP = Vector((0, TOOTH.y, TOOTH.z + 0.035))
smooth = lambda lo, hi, x: min(1, max(0, (x - lo) / (hi - lo))) ** 2 * (3 - 2 * min(1, max(0, (x - lo) / (hi - lo))))
for v in body.data.vertices:
    p, n = v.co, v.normal
    on_head = smooth(0.75, 0.775, p.z)
    h = head_model(p) if on_head > 0.5 else p  # the rules about the face are written for the head as modelled
    length = max(0.1, smooth(0.02, 0.17, min((h - c).length for c in clear))) * (0.4 if h.z > 0.89 and abs(h.x) > 0.105 and h.y > 0.03 else 1) * (0.12 if (mirrored(h) - EAR_INSIDE).length < 0.032 else 1) * (1 - 0.62 * on_head) * smooth(0.035, 0.11, (h - LIP).length)  # short on the head, none on the lip: it would hang over the teeth
    belly = smooth(0.02, -0.11, p.y) * smooth(0.72, 0.5, p.z) * smooth(0.1, 0.25, p.z) * smooth(0.17, 0.08, abs(p.x))
    chin = smooth(-0.06, -0.16, h.y) * smooth(0.86, 0.79, h.z) * smooth(0.64, 0.72, h.z)
    muzzle = on_head * smooth(0.19, 0.07, (h - Vector((0, -0.29, 0.775))).length)  # grey-white around mouth and nose
    blocked = 0
    for ray in rays:
        if ray.dot(n) > 0.2:
            hit = tree.ray_cast(p + n * 0.004, ray, 0.25)
            blocked += (1 - hit[3] / 0.25) if hit[0] else 0
    open_ = 1 - min(1, blocked / (len(rays) * 0.4 * 0.5))
    mask.data[v.index].color = (length, min(1, belly * 0.9 + chin * 0.8 + muzzle), open_, 1)
body.data.color_attributes.active_color = mask


# ---- parts without fur ---------------------------------------------------------------------------------------
skin = material("skin", (0.045, 0.026, 0.018), 0.62)  # hands and feet: a warm umber, darker than the coat
horn = material("claw", (0.1, 0.075, 0.05), 0.3)
hands, feet, claws = {}, {}, {}
for sign, lr in ((1, "L"), (-1, "R")):
    across = Vector((0, -1, 0))  # the fingers fan out front to back
    knuckles = [side(WRIST + ARM * (0.085 - 0.006 * abs(i - 2)), sign) + across * (i - 2) * 0.023 for i in range(5)]  # five fingers
    hands[lr] = blob([(side(WRIST + ARM * 0.03, sign), (0.036, 0.062, 0.06), tilt(sign)), *((k, (0.012, 0.012, 0.04), tilt(sign)) for k in knuckles)], f"hand_{lr}_mesh", 0.005, 3)
    # The hind foot is a paddle: a narrow heel, five long toes spread like a fan, webbing between them.
    fan = [(sign * math.radians((i - 2) * 15), Vector((sign * math.sin(math.radians((i - 2) * 15)), -math.cos(math.radians((i - 2) * 15)), 0))) for i in range(5)]
    ball = side((0.113, -0.075, 0.018), sign)
    toes = [ball + along * 0.088 for _, along in fan]  # the tips
    feet[lr] = blob([(side((0.113, -0.03, 0.026), sign), (0.05, 0.065, 0.026)), (ball + Vector((0, -0.035, -0.006)), (0.066, 0.06, 0.009)),
                     *((ball + along * 0.048, (0.0115, 0.05, 0.012), (0, 0, angle)) for angle, along in fan)], f"foot_{lr}_mesh", 0.004, 2)
    for o in (hands[lr], feet[lr]):
        o.data.materials.append(skin)
    for kind, tips in (("hand", [(k + side(ARM, sign) * 0.048, (0.006, 0.006, 0.024), tilt(sign)) for k in knuckles]), ("foot", [(tip + along * 0.012 + Vector((0, 0, -0.004)), (0.0055, 0.02, 0.0055), (0, 0, angle)) for tip, (angle, along) in zip(toes, fan)])):
        claws[kind, lr] = blob(tips, f"claws_{kind}_{lr}", 0.003, 1)
        claws[kind, lr].data.materials.append(horn)
    for o in (hands[lr], claws["hand", lr]):  # a beaver's hands are small: brought down to size about the wrist
        for v in o.data.vertices:
            v.co = side(WRIST, sign) + (v.co - side(WRIST, sign)) * 0.82


def scales(name, cells, depth, size=512, hatch=False, dark=0.025, light=0.05):
    """Scaly or pebbled skin as a colour and a normal texture: jittered cells, plates raised between dark grooves.
    hatch: diamond plates between two crossing sets of grooves instead, as on a beaver's tail."""
    rng = np.random.default_rng(7)
    points = np.stack(np.meshgrid(np.arange(cells), np.arange(cells), indexing="ij"), -1) + rng.uniform(0.2, 0.8, (cells, cells, 2))
    shade = rng.uniform(0.75, 1.15, (cells, cells))
    v, u = np.mgrid[0:size, 0:size] / size * cells
    cv, cu = np.floor(v).astype(int), np.floor(u).astype(int)
    f1, f2, tone = np.full((size, size), 9.0), np.full((size, size), 9.0), np.ones((size, size))
    for dv in (-1, 0, 1):
        for du in (-1, 0, 1):
            iv, iu = (cv + dv) % cells, (cu + du) % cells
            p = points[iv, iu] + np.stack((cv + dv - iv, cu + du - iu), -1)  # wraps, so the texture tiles
            d = np.hypot(v - p[..., 0], u - p[..., 1])
            tone = np.where(d < f1, shade[iv, iu], tone)
            f2 = np.where(d < f1, f1, np.minimum(f2, d))
            f1 = np.minimum(f1, d)
    height = np.clip((f2 - f1) / 0.3, 0, 1) ** 0.6
    if hatch:  # u + v and u - v run along the diagonals; with whole cells the lines wrap, so it still tiles
        a, b = u + v, u - v
        groove = np.minimum(np.minimum(a % 1, 1 - a % 1), np.minimum(b % 1, 1 - b % 1))
        height = np.clip(groove / 0.14, 0, 1) ** 0.6
        tone = shade[np.floor(a).astype(int) % cells, np.floor(b).astype(int) % cells]
    gv, gu = np.gradient(height, cells / size)
    normal = np.stack((-gu * depth, -gv * depth, np.ones_like(gu)), -1)
    normal = normal / np.linalg.norm(normal, axis=-1, keepdims=True) * 0.5 + 0.5
    colour = ((dark + light * height * tone)[..., None] * np.array((1.0, 0.78, 0.66))) ** (1 / 2.2)  # warm charcoal; linear albedo, stored as sRGB
    images = []
    for kind, rgb, space in (("colour", colour, "sRGB"), ("normal", normal, "Non-Color")):
        image = bpy.data.images.new(f"{name}_{kind}", size, size, alpha=False)
        image.colorspace_settings.name = space
        image.pixels.foreach_set(np.dstack((rgb, np.ones((size, size)))).astype(np.float32).ravel())
        image.filepath_raw, image.file_format = f"{tempfile.gettempdir()}/{name}_{kind}.png", "PNG"
        image.save()
        images.append(image)
    return images


def set_uv(obj, at):
    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])
    layer = obj.data.uv_layers.new(name="uv")
    for loop in obj.data.loops:
        layer.data[loop.index].uv = at(obj.data.vertices[loop.vertex_index])


# The paddle: broad and flat, wide behind the middle, narrowing into a short stalk at the rump; it reads from behind.
tail = blob([((0, 0.35, 0.13), (0.105, 0.165, 0.022), (math.radians(-10), 0, 0)), ((0, 0.2, 0.17), (0.05, 0.07, 0.03), (math.radians(-10), 0, 0))], "tail", 0.005, 2)  # carried above the grass
set_uv(tail, lambda v: (v.co.x / 0.2 + 0.5, (v.co.y - 0.15) / 0.2))  # seen from above; top and bottom share the texture
tail_mat = material("tail", (0.03, 0.025, 0.022), 0.75, Specular_IOR_Level=0.25)  # matt leather: a flat paddle mirrors the room at a low angle otherwise
nodes, links = tail_mat.node_tree.nodes, tail_mat.node_tree.links
bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
colour_image, normal_image = scales("tail", 9, 0.14, hatch=True, dark=0.012, light=0.075)  # large diamonds: they read at a distance
colour_node = nodes.new("ShaderNodeTexImage")
colour_node.image = colour_image
links.new(colour_node.outputs["Color"], bsdf.inputs["Base Color"])


def emboss(mat, image):
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    picture, bump = nodes.new("ShaderNodeTexImage"), nodes.new("ShaderNodeNormalMap")
    picture.image = image
    links.new(picture.outputs["Color"], bump.inputs["Color"])
    links.new(bump.outputs["Normal"], next(n for n in nodes if n.type == "BSDF_PRINCIPLED").inputs["Normal"])


emboss(tail_mat, normal_image)
tail.data.materials.append(tail_mat)

# Bare skin is pebbled leather: hands, feet and nose share one normal texture, unwrapped automatically.
leather = scales("leather", 64, 0.06)[1]
emboss(skin, leather)


def unwrap(obj):
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project()
    bpy.ops.object.mode_set(mode="OBJECT")


for o in (*hands.values(), *feet.values()):
    unwrap(o)

face = []  # rigid on the head bone
eye_mat = material("eye", (0.012, 0.006, 0.004), 0.03)  # dark brown, nearly black
glint = material("glint", (1, 1, 1), 0.5, Emission_Color=(1, 0.97, 0.9, 1), Emission_Strength=1.0)
for sign, lr in ((1, "L"), (-1, "R")):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=EYE_R, location=side(EYE, sign))
    face.append(bpy.context.object)
    face[-1].name = f"eye_{lr}"
    face[-1].data.materials.append(eye_mat)
    # A painted catchlight, up and to the front: the eye stays alive in shade and at stream size.
    out = (side(EYE, sign) - Vector((0, -0.02, 0.85))).normalized()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=EYE_R * 0.3, location=side(EYE, sign) + (out + Vector((0, -0.9, 0.7))).normalized() * EYE_R * 0.86)
    face.append(bpy.context.object)
    face[-1].name = f"glint_{lr}"
    face[-1].data.materials.append(glint)
# The nose pad with its two wings; the nostrils are dull black pits in it.
face.append(blob([(NOSE, (0.048, 0.034, 0.03)), *((side(Vector((0.024, -0.008, -0.006)), sign) + NOSE, (0.021, 0.018, 0.015)) for sign in (1, -1))], "nose", 0.004, 2))  # set into the muzzle's tip, not in front of it
nose_mat = material("nose", (0.012, 0.008, 0.007), 0.3)  # dark and a little wet
emboss(nose_mat, leather)
face[-1].data.materials.append(nose_mat)
unwrap(face[-1])
pit = material("nostril", (0.001, 0.001, 0.001), 1)
face.append(blob([(side(Vector((0.018, -0.026, -0.003)), sign) + NOSE, (0.007, 0.004, 0.005)) for sign in (1, -1)], "nostrils", 0.002, 1))
face[-1].data.materials.append(pit)
for sign, lr in ((1, "L"), (-1, "R")):
    # A lid of bare skin around each eye, and the dark inside of each ear.
    out = (side(EYE, sign) - Vector((0, -0.02, 0.85))).normalized()
    bpy.ops.mesh.primitive_torus_add(major_radius=EYE_R, minor_radius=0.006, major_segments=24, minor_segments=8, location=side(EYE, sign) - out * 0.003, rotation=out.to_track_quat("Z", "Y").to_euler())
    face.append(bpy.context.object)
    face[-1].name = f"lid_{lr}"
    face[-1].data.materials.append(skin)
    face.append(blob([(side(EAR_INSIDE, sign), (0.0245, 0.008, 0.0245))], f"ear_{lr}", 0.003, 2))
    face[-1].data.materials.append(skin)
teeth = material("teeth", (0.95, 0.36, 0.035), 0.25)  # beavers' incisors are orange: iron in the enamel
for sign, lr in ((1, "L"), (-1, "R")):  # long chisels, rounded in front, a hair apart
    face.append(blob([(side(TOOTH, sign), (0.0175, 0.01, 0.038)), (side(TOOTH, sign) + Vector((0, 0.003, -0.018)), (0.016, 0.0075, 0.02))], f"tooth_{lr}", 0.003, 2))
    face[-1].data.materials.append(teeth)
whisker_mat = material("whisker", (0.34, 0.29, 0.24), 0.45)  # many, fine, grey-brown
curve = bpy.data.curves.new("whiskers", "CURVE")
curve.dimensions, curve.bevel_depth, curve.bevel_resolution, curve.resolution_u = "3D", 0.001, 1, 6
for sign in (1, -1):
    for i in range(9):
        root = side((0.07, -0.262 + 0.011 * (i % 3), 0.776 + 0.012 * (i // 3)), sign)
        out = side((1, -0.35 + 0.16 * (i % 3), -0.28 + 0.2 * (i // 3)), sign).normalized() * (0.75 + 0.12 * ((i * 5) % 3))
        spline = curve.splines.new("NURBS")
        spline.points.add(2)
        for point, at in zip(spline.points, (root, root + out * 0.07 + Vector((0, 0, 0.012)), root + out * 0.14)):
            point.co = (*at, 1)
        spline.use_endpoint_u = True
whiskers = bpy.data.objects.new("whiskers", curve)
scene.collection.objects.link(whiskers)
activate(whiskers)
bpy.ops.object.convert(target="MESH")
whiskers = bpy.context.object
whiskers.data.materials.append(whisker_mat)
face.append(whiskers)
brow_mat = material("brow", (0.018, 0.011, 0.008), 0.75)
BROW = EYE + Vector((0, -0.012, 0.034))
brows = {}
for sign, lr in ((1, "L"), (-1, "R")):
    brows[lr] = blob([(side(BROW, sign), (0.055, 0.024, 0.018))], f"brow_{lr}_mesh", 0.005, 2)
    brows[lr].data.materials.append(brow_mat)
for o in (*face, *brows.values()):
    activate(o)
    bpy.ops.object.shade_smooth()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for v in o.data.vertices:
        v.co = head_size(v.co)
BROW = head_size(BROW)

# ---- rig: one bone per main body part ------------------------------------------------------------------------
bpy.ops.object.armature_add(location=(0, 0, 0))
rig = bpy.context.object
rig.name = "rig"
bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
eb.remove(eb[0])


def bone(name, head, tail_, parent=None, deform=True):
    b = eb.new(name)
    b.head, b.tail, b.use_deform = head, tail_, deform
    if parent:
        b.parent = eb[parent]


bone("hips", (0, 0.02, 0.22), (0, 0.02, 0.4))
bone("spine", (0, 0.02, 0.4), (0, 0, 0.58), "hips")
bone("chest", (0, 0, 0.58), (0, 0, 0.72), "spine")
bone("head", (0, 0, 0.72), (0, -0.03, 0.84), "chest")
bone("tail1", (0, 0.15, 0.2), (0, 0.33, 0.105), "hips")
bone("tail2", (0, 0.33, 0.105), (0, 0.5, 0.055), "tail1")
for sign, lr in ((1, "L"), (-1, "R")):
    bone(f"brow_{lr}", side(BROW, sign), side(BROW, sign) + Vector((0, -0.04, 0)), "head", deform=False)
    bone(f"upper_arm_{lr}", side(SHOULDER, sign), side(ELBOW, sign), "chest")
    bone(f"forearm_{lr}", side(ELBOW, sign), side(WRIST, sign), f"upper_arm_{lr}")
    bone(f"hand_{lr}", side(WRIST, sign), side(WRIST + ARM * 0.1, sign), f"forearm_{lr}", deform=False)
    bone(f"thigh_{lr}", side((0.1, 0, 0.24), sign), side((0.11, 0, 0.12), sign), "hips")
    bone(f"shin_{lr}", side((0.11, 0, 0.12), sign), side((0.11, 0, 0.04), sign), f"thigh_{lr}")
    bone(f"foot_{lr}", side((0.11, 0, 0.04), sign), side((0.115, -0.14, 0.02), sign), f"shin_{lr}", deform=False)
bpy.ops.object.mode_set(mode="OBJECT")

activate(rig, body)
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
ARM_BONES = {g.index for g in body.vertex_groups if g.name.startswith(("upper_arm", "forearm"))}
arm_share = lambda weights: sum(weight for group, weight in weights if group in ARM_BONES)
for v in body.data.vertices:
    # What the shirt covers, in the mask's alpha, for when it is worn: fur would poke through it. Deep under it
    # there is no body at all (0); within 3 cm of hem and sleeves and 8 cm of the collar bare skin stays (0.5), so nobody looks
    # through the gap into an empty shirt. The fur length itself stays, for the beaver without a shirt.
    share = arm_share((g.group, g.weight) for g in v.groups)
    if in_shirt(v.co, share, -0.008):
        deep = in_shirt(v.co, share, -0.03) and v.co.z < COLLAR - 0.08  # the collar gapes most: a wider band there
        mask.data[v.index].color = (*mask.data[v.index].color[:3], 0 if deep else 0.5)
    elif share < 0.5 and COLLAR - 0.01 <= v.co.z < COLLAR + 0.14:  # from the collar's edge up: 0.5 … 1, the fur tucks in
        mask.data[v.index].color = (*mask.data[v.index].color[:3], 0.5 + 0.5 * smooth(COLLAR + 0.02, COLLAR + 0.14, v.co.z))


def attach(obj, bone_name):
    activate(rig, obj)
    rig.data.bones.active = rig.data.bones[bone_name]
    bpy.ops.object.parent_set(type="BONE")


for o in face:
    attach(o, "head")
for lr in "LR":
    attach(brows[lr], f"brow_{lr}")
    for kind, limbs in (("hand", hands), ("foot", feet)):
        attach(limbs[lr], f"{kind}_{lr}")
        attach(claws[kind, lr], f"{kind}_{lr}")
# The paddle bends between its two bones: weights by distance along it.
for name in ("tail1", "tail2"):
    tail.vertex_groups.new(name=name)
for v in tail.data.vertices:
    w = min(1, max(0, (v.co.y - 0.26) / 0.16))
    tail.vertex_groups["tail1"].add([v.index], 1 - w, "REPLACE")
    tail.vertex_groups["tail2"].add([v.index], w, "REPLACE")
tail.parent = rig
tail.modifiers.new("rig", "ARMATURE").object = rig

# ---- muscles: a morph target, so bones never need a non-uniform scale (glTF children would inherit it) -------
# A general swell per body part, plus single muscles as bumps: centre (left side, mirrored), radius, height.
swell = {"upper_arm": 0.03, "forearm": 0.025, "chest": 0.03, "thigh": 0.035, "shin": 0.02}
bumps = [
    (SHOULDER + ARM * 0.02 + Vector((0.02, 0, 0.045)), 0.085, 0.085),  # deltoid: shoulders like melons
    (SHOULDER + ARM * 0.1 + Vector((0, -0.035, 0.03)), 0.06, 0.1),  # biceps
    (SHOULDER + ARM * 0.1 + Vector((0, 0.04, -0.02)), 0.06, 0.07),  # triceps
    (ELBOW + ARM * 0.06, 0.06, 0.065),  # forearm
    (Vector((0.075, -0.13, 0.6)), 0.08, 0.085),  # pectoral
    (Vector((0.08, 0.03, 0.69)), 0.07, 0.06),  # trapezius
    (Vector((0.15, 0.07, 0.52)), 0.11, 0.1),  # latissimus: the back spreads into a V
    (Vector((0.11, -0.06, 0.17)), 0.08, 0.06),  # quadriceps
    (Vector((0.1, 0.11, 0.2)), 0.085, 0.04),  # glute
    (Vector((0, -0.13, 0.37)), 0.16, -0.045),  # the belly pulls in …
    (Vector((0.16, 0.0, 0.36)), 0.11, -0.035),  # … and the waist: a wedge from shoulders to hips
]


def bulge(obj):
    groups = {g.index: next((amount for part, amount in swell.items() if g.name.startswith(part)), 0) for g in obj.vertex_groups}
    return [v.normal * (sum(g.weight * groups[g.group] for g in v.groups) + sum(height * math.exp(-((mirrored(v.co) - centre).length / radius) ** 2) for centre, radius, height in bumps)) for v in obj.data.vertices]


# ---- T-shirt: the trunk and the top of the arms once more, pushed out a little; the weights come along.
# Cut along planes, so hem, collar and sleeves end in clean edges, and before any shape key exists: Blender
# mixes up shape keys when vertices are deleted.
activate(body)
bpy.ops.object.duplicate()
shirt = bpy.context.object
shirt.name = "shirt"
bm = bmesh.new()
bm.from_mesh(shirt.data)
weights = bm.verts.layers.deform.verify()
for co, no in (((0, 0, HEM), HEM_NORMAL), ((0, 0, COLLAR), Z_UP), *((side(SHOULDER + ARM * SLEEVE, sign), side(ARM, sign)) for sign in (1, -1))):
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not in_shirt(v.co, arm_share(v[weights].items()), 1e-4)], context="VERTS")
for _ in range(6):  # a hem is a line, not the outline of triangles: relax the cut where arm and flank meet
    relaxed = {}
    for v in bm.verts:
        along = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
        if len(along) == 2:
            relaxed[v] = (v.co * 2 + along[0].co + along[1].co) / 4
    for v, co in relaxed.items():
        v.co = co
bm.to_mesh(shirt.data)
bm.free()
# Each shirt vertex follows the body vertex under it: out along its normal, and with its muscle.
under = KDTree(len(body.data.vertices))
for v in body.data.vertices:
    under.insert(v.co, v.index)
under.balance()
nearest = [under.find(v.co)[1] for v in shirt.data.vertices]
for v, n in zip(shirt.data.vertices, nearest):
    v.co += body.data.vertices[n].normal * 0.015  # close fitting: it follows the belly
swells = bulge(body)
for obj, moves in ((body, swells), (shirt, [swells[n] for n in nearest])):
    obj.shape_key_add(name="Basis")
    muscle = obj.shape_key_add(name="muscle")
    for v, by in zip(obj.data.vertices, moves):
        muscle.data[v.index].co = v.co + by
shirt.data.color_attributes.remove(shirt.data.color_attributes[0])
# The print goes on the chest: the front seen flat; the back takes the blank margins of the texture.
# The back's side is chosen per face, not per vertex: a face across the middle of the back would otherwise squeeze the
# whole print into a dark seam.
set_uv(shirt, lambda v: (0, 0))
for f in shirt.data.polygons:
    for loop in f.loop_indices:
        v = shirt.data.vertices[shirt.data.loops[loop].vertex_index]
        front = body.data.vertices[nearest[v.index]].normal.y < 0.2
        shirt.data.uv_layers[0].data[loop].uv = ((v.co.x / 0.46 + 0.5) if front else (0.98 if f.center.x > 0 else 0.02), (v.co.z - 0.27) / 0.45)  # the print stays where it was on the chest
shirt.data.materials.clear()
shirt.data.materials.append(material("shirt", (0.85, 0.85, 0.83), 0.8))

# ---- motion --------------------------------------------------------------------------------------------------
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
pb = rig.pose.bones
for b in pb:
    b.rotation_mode = "QUATERNION"
mix = lambda a, b, t: a + (b - a) * t
rest = lambda name: rig.data.bones[name].matrix_local.to_quaternion()
SIDES = ((1, "L"), (-1, "R"))


def turn(name, *turns):
    """Rotate a bone about axes of the armature's rest frame (X to its left, Y back, Z up), in the order given."""
    q = Quaternion()
    for axis, angle in turns:
        q = Quaternion(axis, angle) @ q
    pb[name].rotation_quaternion = rest(name).inverted() @ q @ rest(name)


def move(name, offset):
    pb[name].location = rest(name).inverted() @ Vector(offset)


def arm(sign, lr, lower=0.0, swing=0.0, back=0.0, elbow=0.0, curl=0.0, inward=0.0, fist=0.0):
    """One arm from the A-pose: lower it to the side, swing it forward (-) or back, turn it back around the
    spine; then the forearm: bend the elbow upwards, curl it forward, turn it in towards the belly."""
    turn(f"upper_arm_{lr}", (Y, sign * lower), (X, swing), (Z, sign * back))
    turn(f"forearm_{lr}", (Y, -sign * elbow), (X, -curl), (Z, -sign * inward))
    turn(f"hand_{lr}", (Y, -sign * 0.5 * fist))
    pb[f"hand_{lr}"].scale = (1 + 0.35 * fist,) * 3


def brows_at(a):
    for sign, lr in SIDES:  # they drop and tilt inwards over the eyes
        turn(f"brow_{lr}", (Y, -sign * mix(-0.1, 0.5, a)))
        move(f"brow_{lr}", (0, 0, mix(0.012, 0.004, a)))
        pb[f"brow_{lr}"].scale = (mix(0.02, 0.9, a),) * 3  # calm: none to see


def trunk(lean=0.0, drop=0.0, sway=0.0, twist=0.0, nod=0.0, tail_up=0.0, tail_sway=0.0):
    turn("hips", (Y, sway), (Z, twist), (X, lean * 0.4))
    move("hips", (0, 0, -drop))
    turn("spine", (Z, -twist * 0.8), (X, lean * 0.35))
    turn("chest", (Z, -twist * 1.1), (Y, -sway * 0.7), (X, lean * 0.25))
    turn("head", (X, nod), (Z, twist * 0.8))
    turn("tail1", (Z, tail_sway), (X, -tail_up))
    turn("tail2", (Z, tail_sway * 1.2), (X, -tail_up * 0.5))


def leg(sign, lr, hip=0.0, knee=0.0, ankle=0.0, splay=0.1):
    turn(f"thigh_{lr}", (X, -hip), (Y, sign * splay))
    turn(f"shin_{lr}", (X, knee))
    turn(f"foot_{lr}", (X, ankle))


def stride(t, a):
    """The legs and trunk of one double step. Furious: wide, heavy, chest out, shoulders rolling."""
    s, c = math.sin(2 * math.pi * t), math.cos(2 * math.pi * t)
    trunk(lean=mix(0.05, -0.12, a), drop=-0.02 * abs(s) * mix(1, 1.6, a), sway=mix(0.07, 0.16, a) * s, twist=mix(0.12, 0.2, a) * s,
          nod=mix(-0.05, 0.16, a) + 0.04 * c, tail_up=mix(-0.05, 0.25, a), tail_sway=0.2 * s)
    for sign, lr in SIDES:
        step = sign * s  # the left leg leads the first half
        leg(sign, lr, hip=mix(0.7, 0.95, a) * step, knee=0.6 * max(0, sign * c), ankle=mix(0.35, 0.5, a) * step - 0.3 * max(0, sign * c), splay=mix(0.1, 0.32, a))
    return s, c


def walk(t):
    s, c = stride(t, 0)
    brows_at(0)
    for sign, lr in SIDES:  # arms hang and swing against the legs
        arm(sign, lr, lower=0.55, swing=0.55 * sign * s, elbow=0.15, curl=0.5 + 0.2 * max(0, -sign * s))


def rage(t):
    s, c = stride(t, 1)
    brows_at(1)
    for sign, lr in SIDES:  # carried wide, as if the back were too broad to let them hang
        arm(sign, lr, lower=0.12, swing=0.14 * sign * s, back=0.12, elbow=-0.55, curl=0.25, fist=1)


def stand(t):
    s = math.sin(2 * math.pi * t)
    trunk(lean=-0.05, drop=0.004 * s, nod=0.02 * s, tail_sway=0.08 * s)
    brows_at(0)
    for sign, lr in SIDES:
        leg(sign, lr, splay=0.22)
        arm(sign, lr, lower=0.5, elbow=0.1, curl=0.3)


def flex(pose):
    def clip(t):
        stand(t)
        pump = 0.5 + 0.5 * math.sin(4 * math.pi * t)  # squeezes twice per loop
        for sign, lr in SIDES:
            if pose == "double":  # both biceps, elbows high
                arm(sign, lr, lower=-0.55, back=0.1, elbow=1.45 + 0.25 * pump, fist=1)
            elif pose == "lats":  # fists on the hips, elbows wide
                arm(sign, lr, lower=-0.1 - 0.08 * pump, back=0.3, elbow=-1.55, fist=1)
            elif pose == "crab":  # most muscular: arms forward and down, fists meeting before the belly
                arm(sign, lr, lower=0.3, back=-0.75 - 0.1 * pump, elbow=-0.3, inward=1.25, fist=1)
            elif sign > 0:  # "side": one biceps up …
                arm(sign, lr, lower=-0.7, back=0.1, elbow=2.0 + 0.2 * pump, fist=1)
            else:  # … the other fist across the belly
                arm(sign, lr, lower=0.4, back=-0.5, elbow=-0.4, inward=1.5 + 0.1 * pump, fist=1)
    return clip


def pickup(t):
    b = math.sin(math.pi * t) ** 1.5  # down to the ground and up again
    trunk(lean=2.6 * b, drop=0.08 * b, nod=-0.2 * b, tail_up=0.5 * b)
    brows_at(0)
    for sign, lr in SIDES:
        leg(sign, lr, hip=0.9 * b, knee=1.2 * b, ankle=-0.3 * b, splay=0.22)
    arm(1, "L", lower=0.5, swing=0.7 * b, elbow=0.1, curl=0.3)  # back, for balance
    arm(-1, "R", lower=0.55, swing=-1.1 * b, elbow=0.1, curl=0.3 * (1 - b), fist=smooth(0.45, 0.6, t))  # reaches, then grips


def jump(t):
    """Crouch, leap, land; the stage moves the beaver through the air between t = 0.25 and 0.75."""
    crouch = math.sin(math.pi * min(1, t / 0.25)) if t < 0.25 else math.sin(math.pi * (t - 0.75) / 0.25) if t > 0.75 else 0
    air = math.sin(math.pi * (t - 0.25) / 0.5) if 0.25 <= t <= 0.75 else 0
    trunk(lean=1.2 * crouch - 0.5 * air, drop=0.09 * crouch, nod=0.1 * crouch - 0.15 * air, tail_up=0.6 * air)
    brows_at(0)
    for sign, lr in SIDES:
        leg(sign, lr, hip=0.9 * crouch - 0.5 * air, knee=1.3 * crouch + 0.6 * air, ankle=-0.4 * crouch + 0.5 * air, splay=0.22)
    arm(1, "L", lower=0.5 - 1.5 * air, swing=0.9 * crouch - 0.4 * air, elbow=0.1 + 0.3 * air, curl=0.3)
    arm(-1, "R", lower=0.5 - 1.2 * air, swing=0.9 * crouch - 0.6 * air, elbow=0.1 + 0.3 * air, curl=0.3, fist=1)  # holds the stick


def build(t):
    s, c = math.sin(2 * math.pi * t), math.cos(2 * math.pi * t)
    trunk(lean=1.5 + 0.25 * abs(s), drop=0.05, nod=-0.1, twist=0.12 * s, tail_up=0.3, tail_sway=0.3 * s)
    brows_at(0)
    for sign, lr in SIDES:  # bent over the dam, pressing the sticks down with one fist after the other
        leg(sign, lr, hip=0.5, knee=0.8, ankle=-0.3, splay=0.25)
        arm(sign, lr, lower=0.45, swing=-1.0 + 0.45 * sign * s, elbow=0.1, curl=0.5 + 0.4 * max(0, sign * s), fist=1)


def fly(t):
    s, c = math.sin(2 * math.pi * t), math.cos(2 * math.pi * t)
    trunk(nod=0.1, tail_up=0.3, tail_sway=0.5 * s)
    turn("hips", (X, 0.3 * s), (Z, 0.7 * c), (Y, 0.5 * math.sin(4 * math.pi * t)))  # tumbling, but never with its back to the viewer
    brows_at(1)
    for sign, lr in SIDES:
        leg(sign, lr, hip=0.4 * s * sign, knee=0.3, splay=0.5 + 0.2 * c)
        arm(sign, lr, lower=0.15 + 0.2 * s * sign, back=0.3, elbow=0.25 * (1 + c), fist=1)  # spread wide and low: the face stays clear


CLIPS = [("walk", 24, walk), ("rage", 24, rage), ("stand", 24, stand), ("pickup", 36, pickup), ("jump", 30, jump), ("build", 24, build), ("fly", 24, fly),
         *((f"flex_{pose}", 24, flex(pose)) for pose in ("double", "lats", "crab", "side"))]
rig.animation_data_create()
for name, frames, clip in CLIPS:
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    for f in range(frames + 1):
        clip(f / frames)
        for b in pb:
            for prop in ("location", "rotation_quaternion", "scale"):
                b.keyframe_insert(prop, frame=f + 1)
    # One NLA track per animation: that is what the glTF exporter turns into separate clips.
    slot = rig.animation_data.action_slot
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    if slot is not None:
        strip.action_slot = slot
for b in pb:
    b.location, b.rotation_quaternion, b.scale = (0, 0, 0), (1, 0, 0, 0), (1, 1, 1)

if "--save" in argv:
    bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index("--save") + 1])
if argv and not argv[0].startswith("--"):
    bpy.ops.export_scene.gltf(
        filepath=argv[0], export_format="GLB", export_animation_mode="NLA_TRACKS", export_force_sampling=True,
        export_vertex_color="ACTIVE", export_active_vertex_color_when_no_material=True, export_morph=True, export_morph_normal=True,
        # WebP instead of PNG: the three 512² maps were 1.1 MB of the download, at 90 they are a tenth and look the same.
        export_image_format="WEBP", export_image_quality=90,
    )
    # Normals, uvs, weights and colours as small integers (KHR_mesh_quantization, no decoder needed): 0.45 MB less to
    # download. Positions stay floats: quantizing them rewrites the bind matrices and splits the one skin into three.
    subprocess.run(["bunx", "@gltf-transform/cli@4.5.1", "quantize", "--pattern", "{NORMAL,TEXCOORD_*,WEIGHTS_*,COLOR_*}", argv[0], argv[0]], check=True)
