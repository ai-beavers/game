# Builds the things that stand around in the beaver's world, in Blender from nothing, and exports them as one glb:
# trees (alder, birch, willow), stumps (gnawed, sawn), logs, sticks, rocks, a crate and reeds.
#
#   blender -b --factory-startup -P props.py -- props.glb [--save props.blend]
#
# One node per variant, named <prop>_<n> (tree_1 …), everything it needs as children; each stands on the ground
# (glTF y = 0) around its own origin, metres. Sticks and logs lie along glTF z (Blender y), middle at the origin,
# resting on the ground. src/props/index.ts loads the file; lab/props.html shows it.
#
# Every texture is drawn here with numpy and kept small; they are shared: bark, birch bark, end grain, wood grain,
# stone, and one leaf atlas (sprays of alder, birch and willow twigs, a reed blade) with alpha. Vertex colours tint them per
# model (bark tone, shade inside a crown, moss, fresh wood). Leaves and reeds carry their own normals (out of the
# crown, up for reeds), so the cards shade like a volume and not like flat paper.
# Blender is z up here; the exporter turns it into glTF's y up.
import bpy, bmesh, math, os, shutil, sys, tempfile
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
bpy.ops.wm.read_factory_settings(use_empty=True)
TMP = tempfile.mkdtemp(prefix="props-")
UP = Vector((0, 0, 1))
smooth = lambda lo, hi, x: (lambda t: t * t * (3 - 2 * t))(min(1.0, max(0.0, (x - lo) / (hi - lo))))
lerp = lambda a, b, t: tuple(x + (y - x) * t for x, y in zip(a, b))
mul = lambda a, k: tuple(x * k for x in a)


# ---- textures --------------------------------------------------------------------------------------------------
# Arrays are indexed [v, u], row 0 at the bottom (v = 0), as Blender stores images. Colours are sRGB values.
SIZE = 512


def noise(seed, su, sv, size=SIZE):
    """Noise that tiles: white noise blurred in frequency space; su, sv: blur in pixels along u and along v.
    Mean 0, standard deviation 1."""
    white = np.random.default_rng(seed).standard_normal((size, size))
    f = np.fft.fftfreq(size)
    fv, fu = np.meshgrid(f, f, indexing="ij")
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * np.exp(-2 * math.pi ** 2 * ((fu * su) ** 2 + (fv * sv) ** 2))))
    return (out - out.mean()) / out.std()


def ramp(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t[..., None]


def normal_from(height, strength):
    """A tangent-space normal map from a height field (wraps at the edges, so it tiles)."""
    gu = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / 2
    gv = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) / 2
    n = np.dstack((-gu * strength, -gv * strength, np.ones_like(height)))
    return n / np.linalg.norm(n, axis=2, keepdims=True) * 0.5 + 0.5


def save(name, pixels, colour=True):
    h, w, c = pixels.shape
    image = bpy.data.images.new(name, w, h, alpha=c == 4)
    image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    if c == 3:
        pixels = np.dstack((pixels, np.ones((h, w))))
    image.pixels.foreach_set(np.clip(pixels, 0, 1).astype(np.float32).ravel())
    image.filepath_raw, image.file_format = os.path.join(TMP, name + ".png"), "PNG"
    image.save()
    return image


def bark_texture():
    """Furrowed bark: long plates between dark furrows, broken across now and then. Neutral grey-brown; vertex
    colours give each tree its tone."""
    furrow, plates, fine = noise(1, 2.5, 26), noise(2, 9, 16), noise(3, 1.2, 2.5)
    breaks = ramp(1.2, 2.0, noise(4, 22, 1.5))
    height = np.clip(0.5 + 0.5 * np.tanh(1.6 * furrow + 0.5 * plates) - 0.35 * breaks, 0, 1) + 0.06 * fine
    colour = mix((0.24, 0.19, 0.15), (0.58, 0.50, 0.43), np.clip(height, 0, 1)) * (1 + 0.08 * fine)[..., None]
    lichen = ramp(1.5, 2.2, noise(5, 6, 6)) * ramp(0.4, 0.8, height)
    colour = mix(colour, (0.58, 0.60, 0.48), 0.35 * lichen)
    return save("bark", colour), save("bark_normal", normal_from(height, 7), False)


def birch_texture():
    """Birch: chalk-white with short dark horizontal lenticels and a few dark patches, faintly peeling."""
    fine, peel = noise(6, 1.5, 1.5), noise(7, 30, 5)
    dash = ramp(1.9, 2.5, noise(8, 16, 1.0))
    patch = ramp(1.5, 2.1, noise(9, 30, 22) + 0.4 * noise(10, 4, 4))
    dark = np.maximum(dash, patch)
    colour = mix((0.86, 0.85, 0.80), (0.90, 0.80, 0.72), 0.5 * ramp(0.8, 1.8, peel)) * (1 - 0.06 * fine)[..., None]
    colour = mix(colour, (0.10, 0.09, 0.09), dark)
    height = 0.5 - 0.5 * dash - 0.2 * patch + 0.04 * fine + 0.1 * ramp(0.8, 1.8, peel)
    return save("birch", colour), save("birch_normal", normal_from(height, 5), False)


def end_grain_texture():
    """The cut end of a log, filling the square: growth rings, a darker heart, cracks out from the pith, the bark
    as a dark band at radius 0.94 (a cap maps its rim there)."""
    v, u = (np.mgrid[0:SIZE, 0:SIZE] + 0.5) / SIZE * 2 - 1
    r, a = np.hypot(u, v), np.arctan2(v, u)
    rr = r + 0.02 * noise(11, 18, 18) + 0.006 * np.sin(a * 3)
    ring = (rr * 15) % 1
    late = ramp(0.72, 0.9, ring) * (1 - ramp(0.93, 1.0, ring))
    colour = mix((0.80, 0.64, 0.44), (0.56, 0.38, 0.22), 0.85 * late)
    colour = mix(colour, (0.62, 0.42, 0.26), 0.35 * (1 - ramp(0.25, 0.55, r)))  # heartwood
    crack = np.zeros_like(r)
    rng = np.random.default_rng(12)
    for angle, reach in zip(rng.uniform(-math.pi, math.pi, 6), rng.uniform(0.3, 0.75, 6)):
        off = np.abs(np.angle(np.exp(1j * (a - angle - 0.15 * np.sin(r * 9))))) * r * SIZE / 2
        crack = np.maximum(crack, np.exp(-(off / 1.6) ** 2) * (1 - ramp(reach * 0.6, reach, r)))
    colour = mix(colour, (0.22, 0.14, 0.08), 0.9 * crack)
    saw = 0.04 * np.sin((u * 0.9 + v * 0.3) * SIZE * 0.35 + 3 * noise(13, 30, 30))
    colour = colour * (1 + saw)[..., None]
    colour = mix(colour, (0.36, 0.25, 0.15), ramp(0.89, 0.91, r))  # cambium
    colour = mix(colour, (0.20, 0.16, 0.13), ramp(0.92, 0.94, r))  # bark
    height = 0.5 - 0.2 * late - 0.6 * crack + saw - 0.2 * ramp(0.92, 0.94, r)
    return save("end_grain", colour), save("end_grain_normal", normal_from(height, 6), False)


def wood_texture():
    """Long-grained wood seen from the side, for planks, peeled sticks and gnawed surfaces."""
    grain, lines, fine = noise(14, 1.0, 50), noise(15, 2.2, 110), noise(16, 0.8, 4)
    dark = ramp(0.2, 1.6, lines + 0.35 * grain)
    colour = mix((0.80, 0.63, 0.43), (0.58, 0.41, 0.25), dark) * (1 + 0.05 * fine)[..., None]
    height = 0.5 + 0.12 * grain - 0.15 * dark + 0.04 * fine
    return save("wood", colour), save("wood_normal", normal_from(height, 5), False)


def stone_texture():
    """Granular stone: grey with light and dark grains and a soft mottling."""
    big, mid, grain = noise(17, 26, 26), noise(18, 5, 5), noise(19, 0.7, 0.7)
    colour = np.full((SIZE, SIZE, 3), 0.56) * (1 + 0.10 * big + 0.07 * mid)[..., None]
    colour = mix(colour, (0.85, 0.84, 0.80), ramp(1.6, 2.2, grain))
    colour = mix(colour, (0.20, 0.20, 0.21), ramp(-1.7, -2.3, grain))
    height = 0.5 + 0.12 * big + 0.15 * mid + 0.05 * grain
    return save("stone", colour), save("stone_normal", normal_from(height, 4), False)


def leaf_texture():
    """Leaf atlas, 2 x 2 cells: alder, birch and willow, each a spray of leafy twigs from the bottom middle of its
    cell; and one reed blade filling its cell from bottom to a point at the top. Where there is no
    leaf, the colour is the cell's mean leaf colour, so mipmaps do not draw dark rims."""
    S, C = 1024, 512
    rgba = np.zeros((S, S, 4))
    y, x = (np.mgrid[0:C, 0:C] + 0.5) / C
    rng = np.random.default_rng(20)

    def segment(a, b, width):
        ab, ap = np.subtract(b, a), np.dstack((x - a[0], y - a[1]))
        t = np.clip((ap @ ab) / (ab @ ab), 0, 1)
        d = np.hypot(ap[..., 0] - t * ab[0], ap[..., 1] - t * ab[1])
        return np.clip((width / 2 - d) * C + 0.5, 0, 1)

    def leaf(base, angle, length, width, shape, colour, serrate=0.0):
        du, dv = (math.cos(angle), math.sin(angle)), (-math.sin(angle), math.cos(angle))
        along = ((x - base[0]) * du[0] + (y - base[1]) * du[1]) / length
        across = (x - base[0]) * dv[0] + (y - base[1]) * dv[1]
        t = np.clip(along, 0, 1)
        half = width * shape(t) * (1 + serrate * np.sin(t * 60)) * (along > 0) * (along < 1)
        cover = np.clip((half - np.abs(across)) * C + 0.5, 0, 1) * (along > 0) * (along < 1)
        rib = np.exp(-(across / 0.0025) ** 2)
        veins = 0.5 + 0.5 * np.cos((along * 9 - np.abs(across) / width * 1.5) * 2 * math.pi)
        edge = np.abs(across) / np.maximum(half, 1e-4)
        shade = (0.86 + 0.14 * np.clip(along * 3, 0, 1)) * (1 - 0.12 * edge) * (1 + 0.05 * veins) * (1 + 0.25 * rib)
        return cover, np.asarray(colour) * shade[..., None]

    def spray(cell, stems, count, length, width, shape, colour, spread, serrate=0.0):
        """A spray of `stems` twigs fanning out from the bottom middle of the cell, `count` leaves on each."""
        layer = np.zeros((C, C, 4))

        def paint(cover, rgb):
            layer[..., :3] = layer[..., :3] * (1 - cover[..., None]) + rgb * cover[..., None]
            layer[..., 3] = np.maximum(layer[..., 3], cover)

        base, leaves = (0.5, 0.03), []
        for s in range(stems):
            fan = math.radians(-50 + 100 * (s + rng.uniform(0.3, 0.7)) / stems)
            reach, curl = 0.8 - 0.35 * abs(fan) / math.radians(50), rng.uniform(-0.3, 0.3)
            stem = [(base[0] + reach * t * math.sin(fan + curl * t), base[1] + reach * t * math.cos(fan + curl * t)) for t in np.linspace(0, 1, 7)]
            for a, b in zip(stem, stem[1:]):
                paint(segment(a, b, 0.009), np.array((0.30, 0.22, 0.13)))
            for i in range(count):
                t = 0.3 + 0.7 * i / (count - 1)
                at = stem[min(6, round(t * 6))]
                heading = math.pi / 2 - fan - curl * t
                sign = 1 if (i + s) % 2 else -1
                angle = heading + sign * math.radians(spread + rng.uniform(-15, 15)) if i < count - 1 else heading + rng.uniform(-0.15, 0.15)
                l = length * rng.uniform(0.8, 1.15) * (1 - 0.2 * t)
                stalk = (at[0] + math.cos(angle) * l * 0.12, at[1] + math.sin(angle) * l * 0.12)
                paint(segment(at, stalk, 0.005), np.array((0.35, 0.33, 0.14)))
                leaves.append((rng.uniform(), stalk, angle, l))
        for _, stalk, angle, l in sorted(leaves):  # in random order, so they overlap every which way
            tone = np.asarray(colour) * rng.uniform(0.82, 1.15) * np.array((rng.uniform(0.95, 1.1), 1, rng.uniform(0.8, 1.0)))
            paint(*leaf(stalk, angle, l, l * width, shape, tone, serrate))
        place(cell, layer)

    def place(cell, layer):
        mean = (layer[..., :3] * layer[..., 3:]).sum((0, 1)) / max(1.0, layer[..., 3].sum())
        layer[..., :3] = np.where(layer[..., 3:] > 0, layer[..., :3], mean)
        cx, cy = cell % 2, cell // 2
        rgba[cy * C:(cy + 1) * C, cx * C:(cx + 1) * C] = layer

    # alder: round, broadest beyond the middle, blunt tip; birch: small, triangular, pointed, toothed; willow: narrow.
    spray(0, 4, 7, 0.16, 0.42, lambda t: np.sin(math.pi * t ** 1.3) ** 0.7, (0.27, 0.41, 0.12), 55)
    spray(1, 5, 8, 0.11, 0.36, lambda t: np.sin(math.pi * t ** 0.6) ** 0.9, (0.42, 0.56, 0.16), 55, serrate=0.06)
    spray(2, 5, 9, 0.19, 0.11, lambda t: np.sin(math.pi * t) ** 0.8, (0.44, 0.52, 0.26), 35)
    t = np.clip(y, 0, 1)
    half = 0.44 * (1 - t ** 3) ** 0.5
    cover = np.clip((half - np.abs(x - 0.5)) * C + 0.5, 0, 1) * (y < 0.995)
    veins = 0.92 + 0.08 * np.cos((x - 0.5) / 0.44 * 7 * math.pi)
    blade = mix((0.30, 0.42, 0.13), (0.62, 0.56, 0.30), ramp(0.6, 1.0, t)) * veins[..., None]
    place(3, np.dstack((blade, cover)))
    return save("leaves", rgba)


bark_img, bark_nrm = bark_texture()
birch_img, birch_nrm = birch_texture()
end_img, end_nrm = end_grain_texture()
wood_img, wood_nrm = wood_texture()
stone_img, stone_nrm = stone_texture()
leaf_img = leaf_texture()
CELLS = {"alder": 0, "birch": 1, "willow": 2, "reed": 3}


def cell_uv(cell, u, v):
    return ((cell % 2 + u) * 0.5, (cell // 2 + v) * 0.5)


# ---- materials -------------------------------------------------------------------------------------------------
def material(name, image=None, normal=None, roughness=0.85, strength=1.0, alpha=False):
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = roughness
    if image:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    if normal:
        tex, bump = nodes.new("ShaderNodeTexImage"), nodes.new("ShaderNodeNormalMap")
        tex.image = normal
        bump.inputs["Strength"].default_value = strength
        links.new(tex.outputs["Color"], bump.inputs["Color"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


BARK = material("bark", bark_img, bark_nrm, 0.92)
BIRCH = material("birch_bark", birch_img, birch_nrm, 0.75)
END = material("end_grain", end_img, end_nrm, 0.85)
WOOD = material("wood", wood_img, wood_nrm, 0.8)
STONE = material("stone", stone_img, stone_nrm, 0.78)
LEAVES = material("leaves", leaf_img, None, 0.9, alpha=True)  # src/props/index.ts makes it alpha-tested, both sides
PLAIN = material("plain", None, None, 0.85)  # vertex colour only: cattail heads, stems


# ---- mesh building ---------------------------------------------------------------------------------------------
class Mesh:
    """Collects vertices (position, colour, own normal) and faces (corners, uv per corner, material), then turns
    into a Blender object. Colours are linear-light multipliers of the texture."""

    def __init__(self):
        self.co, self.col, self.nrm, self.faces, self.uvs, self.mats = [], [], [], [], [], []

    def vert(self, p, colour=(1, 1, 1), normal=None):
        self.co.append(tuple(p))
        self.col.append((*colour[:3], 1.0))
        self.nrm.append(tuple(normal) if normal is not None else (0, 0, 1))
        return len(self.co) - 1

    def face(self, corners, uv, mat):
        self.faces.append(tuple(corners))
        self.uvs.append(uv)
        self.mats.append(mat)

    def tris(self):
        return sum(len(f) - 2 for f in self.faces)

    def build(self, name, parent, custom_normals=False, sharp_angle=None):
        if not self.faces:
            return None
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.co, [], self.faces)
        layer = me.uv_layers.new(name="uv")
        layer.data.foreach_set("uv", [c for f in self.uvs for p in f for c in p])
        col = me.color_attributes.new("colour", "FLOAT_COLOR", "POINT")
        col.data.foreach_set("color", [c for v in self.col for c in v])
        me.color_attributes.active_color = col
        used = list(dict.fromkeys(self.mats))
        for m in used:
            me.materials.append(m)
        me.polygons.foreach_set("material_index", [used.index(m) for m in self.mats])
        me.shade_smooth()
        if custom_normals:
            me.normals_split_custom_set_from_vertices(self.nrm)
        if sharp_angle:
            me.set_sharp_from_angle(angle=sharp_angle)
        obj = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        return obj


def variant(name):
    node = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(node)
    return node


def frames(points):
    """Tangent, normal, binormal at each point of a path; the normal is carried along without twisting."""
    n = len(points)
    tangents = [(points[min(i + 1, n - 1)] - points[max(i - 1, 0)]).normalized() for i in range(n)]
    t0 = tangents[0]
    normal = t0.cross(Vector((1, 0, 0)) if abs(t0.x) < 0.9 else Vector((0, 1, 0))).normalized()
    out = []
    for t in tangents:
        normal = (normal - t * normal.dot(t)).normalized()
        out.append((t, normal, t.cross(normal)))
    return out


def tube(m, pts, radii, sides, mat, colour, u_tiles=1, v_per_m=1.4, shape=None, v0=0.0):
    """A tube along pts with a radius per point; colour(i, angle, point) and shape(i, angle) -> radius factor are
    optional. Returns the rings of vertex indices and the frames."""
    fr, rings, vs, length = frames(pts), [], [], 0.0
    for i, p in enumerate(pts):
        if i:
            length += (p - pts[i - 1]).length
        t, n, b = fr[i]
        ring = []
        for j in range(sides):
            a = 2 * math.pi * j / sides
            k = shape(i, a) if shape else 1.0
            q = p + (n * math.cos(a) + b * math.sin(a)) * radii[i] * k
            ring.append(m.vert(q, colour(i, a, q) if callable(colour) else colour))
        rings.append(ring)
        vs.append(v0 + length * v_per_m)
    for i in range(len(pts) - 1):
        for j in range(sides):
            j2 = (j + 1) % sides
            u1, u2 = j / sides * u_tiles, (j + 1) / sides * u_tiles
            m.face((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]), ((u1, vs[i]), (u2, vs[i]), (u2, vs[i + 1]), (u1, vs[i + 1])), mat)
    return rings, fr


def cap(m, ring, centre, frame, radius, outward, colour, mat=None):
    """Closes a tube's end with a disc of end grain: the ring's positions again (a hard edge), planar uv."""
    _, n, b = frame
    c = m.vert(centre, colour)
    pts = [Vector(m.co[i]) for i in ring]
    idx = [m.vert(p, colour) for p in pts]
    uv = lambda p: (0.5 + 0.47 * (p - centre).dot(n) / radius, 0.5 + 0.47 * (p - centre).dot(b) * outward / radius)
    for j in range(len(idx)):
        j2 = (j + 1) % len(idx)
        corners = (c, idx[j], idx[j2]) if outward > 0 else (c, idx[j2], idx[j])
        m.face(corners, tuple(uv(Vector(m.co[k])) for k in corners), mat or END)


def box(m, centre, size, rotation, mat, colour, grain=2, rng=None):
    """A box with its own vertices per side (hard edges); uv in metres, the wood grain along local axis `grain`."""
    centre, rot = Vector(centre), Matrix(rotation)
    off = rng.uniform(0, 1, 2) if rng is not None else (0, 0)
    for axis in range(3):
        for sign in (-1, 1):
            i, j = [k for k in range(3) if k != axis]
            if j != grain and i == grain:
                i, j = j, i
            corners = []
            for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                local = [0.0, 0.0, 0.0]
                local[axis], local[i], local[j] = sign * size[axis] / 2, a * size[i] / 2, b * size[j] / 2
                corners.append((Vector(local), local[i], local[j]))
            normal = rot @ Vector([sign if k == axis else 0 for k in range(3)])
            p = [centre + rot @ c[0] for c in corners]
            if (p[1] - p[0]).cross(p[2] - p[0]).dot(normal) < 0:
                corners.reverse()
            idx = [m.vert(centre + rot @ c[0], colour) for c in corners]
            m.face(idx, tuple((c[1] * 2 + off[0], c[2] * 0.8 + off[1]) for c in corners), mat)


def rand_unit(rng):
    v = Vector(rng.normal(size=3))
    return v.normalized() if v.length > 1e-6 else UP.copy()


def path(start, direction, length, steps, rng, wobble, pull):
    """A bending path: each step turns a little at random and by pull(t) (a vector: up, down, outward)."""
    pts, d = [start.copy()], direction.normalized()
    for k in range(steps):
        t = (k + 1) / steps
        d = (d + rand_unit(rng) * wobble + pull(t)).normalized()
        pts.append(pts[-1] + d * length / steps)
    return pts


# ---- trees -----------------------------------------------------------------------------------------------------
# Per kind: height, trunk radius at the base, where the crown starts, leaders (a willow forks low), laterals and
# their angle from the vertical (bottom, top) and reach in metres (bottom, top), how laterals bend (rise, droop),
# twigs per lateral, leaf cards per metre of twig and their size, bark and its tone.
KINDS = {
    "alder": dict(seed=31, height=6.9, radius=0.15, crown=1.7, leaders=1, laterals=18, pitch=(68, 30), reach=(2.3, 0.8), rise=0.10, droop=0.10,
                  twigs=10, twig=(0.5, 0.9), cards=20, card=0.8, bark=BARK, tone=(0.78, 0.76, 0.74), lean=0.25, roots=5, crown_round=0.4),
    "birch": dict(seed=7, height=7.9, radius=0.13, crown=2.3, leaders=1, laterals=22, pitch=(60, 30), reach=(2.1, 0.7), rise=0.16, droop=0.32,
                  twigs=9, twig=(0.45, 0.9), cards=20, card=0.7, bark=BIRCH, tone=(1.0, 1.0, 1.0), lean=0.55, roots=4, crown_round=0.6),
    "willow": dict(seed=5, height=6.0, radius=0.2, crown=2.1, leaders=3, laterals=7, pitch=(70, 35), reach=(2.0, 0.9), rise=0.08, droop=0.30,
                   twigs=9, twig=(0.5, 1.0), cards=18, card=0.85, bark=BARK, tone=(0.95, 0.85, 0.72), lean=0.2, roots=6, crown_round=0.8),
}


def tree(name, kind):
    P, node = KINDS[kind], variant(name)
    rng = np.random.default_rng(P["seed"])
    wood, cards = Mesh(), []  # cards: (base, up, side, size), drawn once the crown's extent is known
    bark, tone, H = P["bark"], P["tone"], P["height"]
    birch = kind == "birch"

    def bark_colour(level):
        def colour(i, a, q):
            if birch:  # white bark, dark and rough at the foot; dark twigs
                c = lerp((0.30, 0.28, 0.26), (1, 1, 1), smooth(0.15, 1.3, q.z)) if level == 0 else ((0.75, 0.72, 0.70) if level == 1 else (0.32, 0.25, 0.22))
            else:
                c = mul(tone, 0.9 if level == 0 else 0.75)
            return mul(c, 1 - 0.25 * (1 - smooth(-0.1, 0.5, q.z)))  # the foot of the trunk sits in shade
        return colour

    def twig(start, direction, length):
        pts = path(start, direction, length, 3, rng, 0.15, lambda t: UP * (0.12 - P["droop"] * t) * 0.6)
        tube(wood, pts, [0.009 - 0.006 * k / 3 for k in range(4)], 4, bark, bark_colour(2))
        count = max(2, round(P["cards"] * length))
        for k in range(count):
            t = 0.25 + 0.75 * k / max(1, count - 1)
            at = pts[0].lerp(pts[-1], t) + rand_unit(rng) * 0.06
            leaf_card(at, (pts[-1] - pts[0]).normalized())

    def leaf_card(at, along):
        up = (along + rand_unit(rng) * 0.7 + UP * (0.2 - P["droop"] * 0.8)).normalized()
        side = up.cross(rand_unit(rng))
        if side.length < 0.1:
            side = up.cross(Vector((1, 0, 0)))
        side.normalize()
        side = (side + UP * -side.z * 0.6).normalized()  # cards lean toward lying flat, to catch the sun
        cards.append((at, up, side, P["card"] * rng.uniform(0.8, 1.15)))

    def lateral(start, direction, reach, r0):
        steps = max(3, round(reach / 0.35))
        out = Vector((direction.x, direction.y, 0)).normalized() if Vector((direction.x, direction.y, 0)).length > 1e-3 else Vector((1, 0, 0))
        pts = path(start, direction, reach, steps, rng, 0.12, lambda t: UP * (P["rise"] * (1 - t) - P["droop"] * t * t) + out * 0.05)
        radii = [max(0.006, r0 * (1 - k / steps) ** 0.9) for k in range(steps + 1)]
        tube(wood, pts, radii, 6 if r0 > 0.035 else 5, bark, bark_colour(1), u_tiles=1)
        n = max(2, round(P["twigs"] * reach / P["reach"][0]))
        for k in range(n):
            t = 0.25 + 0.75 * k / max(1, n - 1) * 0.95
            i = min(steps - 1, int(t * steps))
            at = pts[i].lerp(pts[i + 1], t * steps - i)
            d = (pts[i + 1] - pts[i]).normalized()
            perp = d.cross(UP)
            perp = perp.normalized() if perp.length > 1e-3 else Vector((1, 0, 0))
            turn = Matrix.Rotation(rng.uniform(-0.9, 0.9) + (0 if k % 2 else math.pi), 3, d)
            angle = math.radians(rng.uniform(35, 55))
            twig_dir = (d * math.cos(angle) + (turn @ perp) * math.sin(angle) + UP * 0.25).normalized()
            twig(at, twig_dir, rng.uniform(*P["twig"]) * (1 - 0.3 * t) * min(1.0, 0.5 + reach / 2))
        for k in range(3):  # leaves around the very tip, too
            leaf_card(pts[-1] + rand_unit(rng) * 0.12, (pts[-1] - pts[-2]).normalized())

    # trunk: root flare in lobes at the foot, a gentle lean and sway
    fork = P["crown"] if P["leaders"] > 1 else H * 0.9
    zs = [-0.15, 0.0, 0.07, 0.15, 0.26, 0.4, 0.6, 0.85] + list(np.arange(1.2, fork, 0.45)) + [fork]
    phase, lean_dir = rng.uniform(0, 6.3), rng.uniform(0, 6.3)
    trunk_pts = [Vector((P["lean"] * (max(z, 0) / H) ** 2 * math.cos(lean_dir) + 0.04 * math.sin(z * 1.3 + phase),
                         P["lean"] * (max(z, 0) / H) ** 2 * math.sin(lean_dir) + 0.04 * math.cos(z * 1.1 + phase), z)) for z in zs]
    top_r = 0.11 if P["leaders"] > 1 else 0.03
    trunk_r = lambda z: P["radius"] + (top_r - P["radius"]) * (max(z, 0) / fork) ** 0.8
    roots = P["roots"]
    flare = lambda i, a: 1 + 0.75 * math.exp(-max(zs[i], 0) / 0.22) * (0.3 + 0.7 * (0.5 + 0.5 * math.cos(roots * a + phase)) ** 3) + 0.025 * math.sin(3 * a + zs[i] * 2)
    tube(wood, trunk_pts, [trunk_r(z) for z in zs], 16, bark, bark_colour(0), u_tiles=3 if P["radius"] > 0.14 else 2, shape=flare)

    def laterals_on(pts, count, z_from, z_top, r_at):
        golden = rng.uniform(0, 6.3)
        for k in range(count):
            t = (k + rng.uniform(0.1, 0.9)) / count
            z = z_from + (z_top - z_from) * t
            i = min(range(len(pts) - 1), key=lambda j: abs(pts[j].z - z))
            at = pts[i].lerp(pts[i + 1], 0.5)
            golden += math.radians(137.5) + rng.uniform(-0.3, 0.3)
            pitch = math.radians(P["pitch"][0] + (P["pitch"][1] - P["pitch"][0]) * t + rng.uniform(-8, 8))
            out = Vector((math.cos(golden), math.sin(golden), 0))
            d = out * math.sin(pitch) + UP * math.cos(pitch)
            shape = math.sin(math.pi * (0.35 + 0.65 * t)) ** P["crown_round"] if P["crown_round"] else 1
            reach = (P["reach"][0] + (P["reach"][1] - P["reach"][0]) * t) * rng.uniform(0.8, 1.15) * (0.6 + 0.4 * shape)
            lateral(at, d, reach, max(0.02, min(r_at * 0.6, 0.012 + 0.025 * reach)))

    if P["leaders"] == 1:
        laterals_on(trunk_pts, P["laterals"], P["crown"], fork, P["radius"] * 0.5)
        tip = trunk_pts[-1]
        lateral(tip, (trunk_pts[-1] - trunk_pts[-2]).normalized(), H - tip.z, 0.03)
    else:
        top = trunk_pts[-1]
        for k in range(P["leaders"]):
            a = phase + k * 2 * math.pi / P["leaders"] + rng.uniform(-0.3, 0.3)
            d = (Vector((math.cos(a), math.sin(a), 0)) * math.sin(math.radians(28)) + UP * math.cos(math.radians(28))).normalized()
            length = (H - top.z - 0.6) / d.z
            pts = path(top - d * 0.15, d, length, 8, rng, 0.06, lambda t: UP * 0.04)
            tube(wood, pts, [0.11 * (1 - 0.82 * j / 8) for j in range(9)], 10, bark, bark_colour(0), u_tiles=2)
            laterals_on(pts, P["laterals"], top.z + 0.5, pts[-1].z, 0.08)
            lateral(pts[-1], d, 0.9, 0.025)

    # leaf cards: normals out of the crown, darker deep inside it and underneath
    centres = np.array([tuple(c[0]) for c in cards])
    lo, hi = centres.min(0), centres.max(0)
    mid, half = Vector((lo + hi) / 2), Vector(np.maximum((hi - lo) / 2, 0.5))
    leaves, cell = Mesh(), CELLS[kind]
    for at, up, side, size in cards:
        rel = Vector(((at - mid).x / half.x, (at - mid).y / half.y, (at - mid).z / half.z))
        depth = rel.length
        out = Vector((rel.x / half.x, rel.y / half.y, rel.z / half.z)).normalized()
        normal = (out * 0.8 + UP * 0.3 + rand_unit(rng) * 0.2).normalized()
        shade = (0.5 + 0.5 * smooth(0.2, 1.0, depth)) * (0.75 + 0.25 * smooth(-1, 0.6, rel.z)) * rng.uniform(0.85, 1.1)
        colour = (shade * rng.uniform(0.95, 1.1), shade, shade * rng.uniform(0.8, 1.0))
        w = side * size * 0.5
        quad = [at - w, at + w, at + w + up * size, at - w + up * size]
        idx = [leaves.vert(q, colour, normal) for q in quad]
        leaves.face(idx, (cell_uv(cell, 0, 0), cell_uv(cell, 1, 0), cell_uv(cell, 1, 1), cell_uv(cell, 0, 1)), LEAVES)
    wood.build(name + "_wood", node)
    leaves.build(name + "_leaves", node, custom_normals=True)
    print(f"{name} ({kind}): wood {wood.tris()} + leaves {leaves.tris()} triangles, crown {tuple(round(float(v), 1) for v in hi - lo)} m")


# ---- gnawed wood -----------------------------------------------------------------------------------------------
def gnawed_cone(m, base, frame, radius, length, rng, sides, skew=0.3):
    """A beaver's cut: fresh pale wood narrowing to a splintered point, in tiers of tooth marks: rings of scoops
    (each a few cm wide, running down the slope) that step in from tier to tier. frame: (axis, n, b), the axis
    pointing to the tip. Returns the base ring (its vertex indices)."""
    axis, n, b = frame
    rows, tiers, scoops = 30, 5, 22
    turn = rng.uniform(0, 6.3)
    off = (n * math.cos(turn) + b * math.sin(turn)) * radius * skew
    jag = rng.uniform(0, 1, (rows + 1, sides))
    scale = radius / 0.16
    grid = []
    for k in range(rows + 1):
        t = k / rows
        ring = []
        for j in range(sides):
            a = 2 * math.pi * j / sides
            tier, within = divmod(t * tiers + 0.35 * math.sin(a * 3 + turn) + 0.2 * math.sin(a * 7), 1)  # tiers wander
            s = (a * scoops / (2 * math.pi) + tier * 0.5 + 0.2 * math.sin(t * 7 + a * 2)) % 1
            groove = 1 - (2 * s - 1) ** 2  # 1 in the middle of a scoop, 0 on the ridge between two
            depth = (0.012 * groove + 0.008 * within) * (1 - t) ** 0.6 * scale
            r = max(0.002, radius * 0.93 * (1 - t) ** 1.4 - depth)
            z = t * length
            if t > 0.72:  # splinters at the tip
                u = (t - 0.72) / 0.28
                z += (jag[k, j] - 0.3) * 0.07 * u * length
                r *= 0.5 + jag[k, j]
            p = base + axis * z + off * t ** 1.5 + (n * math.cos(a) + b * math.sin(a)) * r
            shade = (0.6 + 0.4 * (1 - groove)) * (1.05 - 0.25 * within)
            ring.append((m.vert(p, mul((1.0, 0.84, 0.6), shade)), (a / (2 * math.pi) * 2, t * length * 2.5)))
        grid.append(ring)
    for k in range(rows):
        for j in range(sides):
            j2 = (j + 1) % sides
            q = [grid[k][j], grid[k][j2], grid[k + 1][j2], grid[k + 1][j]]
            uv = [q[0][1], (q[0][1][0] + 2 / sides, q[1][1][1]), (q[3][1][0] + 2 / sides, q[2][1][1]), q[3][1]]
            m.face([x[0] for x in q], tuple(uv), WOOD)
    tip = m.vert(base + axis * (length * 1.08) + off, (0.75, 0.62, 0.45))
    last = grid[-1]
    for j in range(sides):
        j2 = (j + 1) % sides
        m.face((last[j][0], last[j2][0], tip), (last[j][1], last[j2][1], (last[j][1][0], last[j][1][1] + 0.05)), WOOD)
    return [x[0] for x in grid[0]]


def join_rings(m, outer, inner, axis):
    """A narrow band from the bark's last ring to the wood's first (the bark's thickness, seen end on). The inner
    ring may have a whole multiple of the outer ring's vertices."""
    s, k = len(outer), len(inner) // len(outer)
    uv = ((0.5, 0.97), (0.52, 0.97), (0.51, 0.9))

    def tri(*corners):
        p = [Vector(m.co[c]) for c in corners]
        if (p[1] - p[0]).cross(p[2] - p[0]).dot(axis) < 0:
            corners = corners[::-1]
        m.face(corners, uv, END)

    for j in range(s):
        for i in range(k):
            tri(outer[j], inner[j * k + i], inner[(j * k + i + 1) % len(inner)])
        tri(outer[j], outer[(j + 1) % s], inner[((j + 1) * k) % len(inner)])


def chips(m, rng, count, r_min, r_max):
    """Wood chips on the ground around a gnawed stump."""
    for _ in range(count):
        a, d = rng.uniform(0, 6.3), rng.uniform(r_min, r_max)
        rot = Matrix.Rotation(rng.uniform(0, 6.3), 3, "Z") @ Matrix.Rotation(rng.uniform(-0.25, 0.25), 3, "X")
        size = (rng.uniform(0.025, 0.05), rng.uniform(0.012, 0.025), 0.003)
        box(m, (math.cos(a) * d, math.sin(a) * d, 0.004), size, rot, WOOD, mul((0.9, 0.78, 0.6), rng.uniform(0.7, 0.95)), grain=0, rng=rng)


def stump_gnawed(name):
    node, rng, m = variant(name), np.random.default_rng(41), Mesh()
    R, cut, sides = 0.16, 0.22, 40
    zs = [-0.1, 0.0, 0.06, 0.13, 0.2, cut]
    pts = [Vector((0, 0, z)) for z in zs]
    flare = lambda i, a: 1 + 0.35 * math.exp(-max(zs[i], 0) / 0.12) * (0.3 + 0.7 * (0.5 + 0.5 * math.cos(5 * a + 1)) ** 3)
    rings, fr = tube(m, pts, [R] * len(zs), sides, BARK, lambda i, a, q: mul((0.9, 0.82, 0.74), 0.75 + 0.25 * smooth(-0.1, 0.25, q.z)), u_tiles=3, shape=flare)
    inner = gnawed_cone(m, Vector((0, 0, cut)), (UP, fr[-1][1], fr[-1][2]), R, 0.3, rng, sides * 2)
    join_rings(m, rings[-1], inner, UP)
    chips(m, rng, 24, 0.2, 0.45)
    m.build(name + "_mesh", node)
    return m.tris()


def stump_sawn(name):
    node, rng, m = variant(name), np.random.default_rng(43), Mesh()
    R, top, sides = 0.2, 0.38, 32
    zs = [-0.1, 0.0, 0.06, 0.14, 0.24, top]
    pts = [Vector((0, 0, z)) for z in zs]
    flare = lambda i, a: 1 + 0.35 * math.exp(-max(zs[i], 0) / 0.14) * (0.3 + 0.7 * (0.5 + 0.5 * math.cos(6 * a)) ** 3) + 0.02 * math.sin(4 * a)
    rings, fr = tube(m, pts, [R] * len(zs), sides, BARK, lambda i, a, q: mul((1.0, 0.9, 0.78), 0.75 + 0.25 * smooth(-0.1, 0.25, q.z)), u_tiles=4, shape=flare)
    cap(m, rings[-1], pts[-1], fr[-1], R * 1.02, 1, (0.95, 0.92, 0.88))
    m.build(name + "_mesh", node)
    return m.tris()


# ---- logs and sticks: along Blender y (glTF z), middle at the origin, lying on the ground --------------------------
def lying(length, radius, bend, rng, steps):
    pts = []
    for k in range(steps + 1):
        t = k / steps
        pts.append(Vector((bend * math.sin(math.pi * t) + rng.uniform(-0.1, 0.1) * bend, (t - 0.5) * length, 0)))
    return pts


def log(name, length, radius, seed, gnawed):
    node, rng, m = variant(name), np.random.default_rng(seed), Mesh()
    steps, sides = round(length / 0.12), 14
    pts = lying(length, radius, 0.04, rng, steps)
    radii = [radius * (1.06 - 0.12 * k / steps) for k in range(steps + 1)]
    for p, r in zip(pts, radii):
        p.z = r
    lumps = [(rng.uniform(0, 6.3), rng.uniform(0, 6.3)) for _ in range(3)]
    shape = lambda i, a: 1 + sum(0.03 * math.sin(a * (f + 2) + i * 0.3 + ph) for f, (ph, _) in enumerate(lumps))

    def colour(i, a, q):  # moss on the top of the log, fading in patches
        up = (q.z - pts[i].z) / radii[i]
        moss = smooth(0.55, 0.95, up) * smooth(-0.2, 0.6, math.sin(i * 0.35 + lumps[0][1]) + 0.5 * math.sin(i * 0.9))
        return lerp((1.0, 0.9, 0.78), (0.36, 0.48, 0.12), 0.85 * moss)

    rings, fr = tube(m, pts, radii, sides, BARK, colour, u_tiles=3, shape=shape)
    cap(m, rings[0], pts[0], fr[0], radii[0] * 1.03, -1, (0.82, 0.8, 0.78))
    if gnawed:  # the end the beaver cut through: a point of fresh wood
        t, n, b = fr[-1]
        inner = gnawed_cone(m, pts[-1], (t, n, b), radii[-1], radius * 2.0, rng, sides * 4, skew=0.4)
        join_rings(m, rings[-1], inner, t)
    else:
        cap(m, rings[-1], pts[-1], fr[-1], radii[-1] * 1.03, 1, (0.82, 0.8, 0.78))
    # a branch stub, sawn off
    at = pts[steps // 3]
    d = Vector((0.7, 0.2, 0.7)).normalized()
    stub = [at + d * (radius * 0.6), at + d * (radius + 0.06), at + d * (radius + 0.14)]
    srings, sfr = tube(m, stub, [0.045, 0.04, 0.036], 7, BARK, (0.62, 0.55, 0.47))
    cap(m, srings[-1], stub[-1], sfr[-1], 0.037, 1, (0.85, 0.82, 0.78))
    m.build(name + "_mesh", node)
    return m.tris()


def stick(name, length, radius, seed, peeled=False, with_twig=False):
    node, rng, m = variant(name), np.random.default_rng(seed), Mesh()
    steps, sides = 8, 8
    pts = lying(length, radius, rng.uniform(0.02, 0.05), rng, steps)
    radii = [radius * (1.1 - 0.25 * k / steps) for k in range(steps + 1)]
    for p, r in zip(pts, radii):
        p.z = r * 1.05
    mat, tone = (WOOD, (1.05, 0.95, 0.8)) if peeled else (BARK, (1.25, 1.1, 0.92))
    rings, fr = tube(m, pts, radii, sides, mat, lambda i, a, q: mul(tone, rng.uniform(0.92, 1.05)), v_per_m=1.0)
    cap(m, rings[0], pts[0], fr[0], radii[0], -1, (0.9, 0.85, 0.8))
    cap(m, rings[-1], pts[-1], fr[-1], radii[-1], 1, (0.9, 0.85, 0.8))
    if with_twig:
        at = pts[5]
        d = (fr[5][0] * 0.7 + Vector((0.6, 0, 0.35))).normalized()
        twig = path(at, d, 0.24, 3, rng, 0.1, lambda t: Vector((0.05, 0.05, -0.02)))
        trings, tfr = tube(m, twig, [radius * 0.45, radius * 0.38, radius * 0.3, radius * 0.22], 4, mat, tone)
        cap(m, trings[-1], twig[-1], tfr[-1], radius * 0.22, 1, (0.9, 0.85, 0.8))
    m.build(name + "_mesh", node)
    return m.tris()


# ---- rocks -----------------------------------------------------------------------------------------------------
def rock(name, radii, seed, tint, angular=False, moss=0.0, bumpy=0.08):
    node, rng, m = variant(name), np.random.default_rng(seed), Mesh()
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
    dirs = np.array([tuple(v.co.normalized()) for v in bm.verts])
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    waves = rng.normal(size=(9, 3)) * np.array([[1.5], [1.5], [2], [2.5], [3], [3.5], [4], [5], [6]])
    phases, amps = rng.uniform(0, 6.3, 9), 1 / np.arange(1, 10) ** 0.8
    wobble = lambda p: (np.sin(p @ waves.T + phases) * amps).sum(1) / amps.sum() * 2
    q = dirs * (1 + bumpy * wobble(dirs))[:, None]
    if angular:  # sheared faces: clip against random planes
        for _ in range(24):
            n = rand_unit(rng)
            n = np.array(tuple(n))
            excess = q @ n - rng.uniform(0.55, 0.75)
            q -= np.maximum(excess, 0)[:, None] * n
        q *= (1 + 0.02 * wobble(dirs * 3))[:, None]
    p = q * np.array(radii)
    p[:, 2] = np.maximum(p[:, 2], -0.55 * radii[2])  # a flat underside
    p[:, 2] -= p[:, 2].min() + 0.12 * radii[2]  # sunk a little into the ground
    normals = np.zeros_like(p)
    for f in faces:
        normals[f] += np.cross(p[f[1]] - p[f[0]], p[f[2]] - p[f[0]])
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    spots = wobble(dirs * 2.5)
    idx = []
    for i, (pos, nz) in enumerate(zip(p, normals[:, 2])):
        c = mul(tint, (0.9 + 0.1 * spots[i]) * (0.7 + 0.3 * smooth(0.0, 0.12, pos[2])))  # damp, darker near the ground
        green = moss * smooth(0.45, 0.85, nz) * smooth(-0.6, 0.4, spots[i])
        idx.append(m.vert(pos, lerp(c, (0.22, 0.32, 0.07), green)))
    for f in faces:
        n = np.abs(normals[f].sum(0))
        axis = int(np.argmax(n))
        i, j = [k for k in range(3) if k != axis]
        m.face([idx[k] for k in f], tuple((p[k][i] / 0.6, p[k][j] / 0.6) for k in f), STONE)
    m.build(name + "_mesh", node, sharp_angle=math.radians(30) if angular else None)
    return m.tris()


# ---- crate -----------------------------------------------------------------------------------------------------
def crate(name):
    node, rng, m = variant(name), np.random.default_rng(51), Mesh()
    S, T = 0.5, 0.022  # size, plank thickness
    I = Matrix.Identity(3)
    tone = lambda: mul((0.8, 0.7, 0.58), rng.uniform(0.75, 1.0))  # weathered
    box(m, (0, 0, S / 2), (S - 2 * T, S - 2 * T, S - 2 * T), I, WOOD, (0.25, 0.2, 0.16))  # the dark inside, seen between planks
    for k in range(3):  # side planks, horizontal, with gaps
        z = 0.03 + 0.075 + k * 0.155
        for axis, sign in ((0, 1), (0, -1), (1, 1), (1, -1)):
            centre = [0, 0, z]
            centre[axis] = sign * (S / 2 - T / 2)
            size = [S - 0.1, S - 0.1, 0.14]
            size[axis] = T
            box(m, centre, size, I, WOOD, tone(), grain=1 - axis, rng=rng)
    for x in (-1, 1):  # corner posts
        for y in (-1, 1):
            box(m, (x * (S / 2 - 0.025), y * (S / 2 - 0.025), S / 2), (0.05, 0.05, S), I, WOOD, tone(), grain=2, rng=rng)
    for k in range(3):  # top and bottom planks
        y = (k - 1) * 0.16
        for z in (T / 2, S - T / 2):
            box(m, (0, y, z), (S, 0.15, T), I, WOOD, tone(), grain=0, rng=rng)
    m.build(name + "_mesh", node)
    return m.tris()


# ---- reeds -----------------------------------------------------------------------------------------------------
def reed(name, seed, blades, height, width, cattails):
    node, rng = variant(name), np.random.default_rng(seed)
    m, heads = Mesh(), Mesh()
    cell = CELLS["reed"]
    for _ in range(blades):
        a, d = rng.uniform(0, 6.3), rng.uniform(0, 0.12) ** 0.7
        base = Vector((math.cos(a) * d, math.sin(a) * d, -0.03))
        out = Vector((math.cos(a + rng.uniform(-0.6, 0.6)), math.sin(a + rng.uniform(-0.6, 0.6)), 0))
        lean, bend = math.radians(rng.uniform(4, 22)), math.radians(rng.uniform(10, 45))
        length = height * rng.uniform(0.6, 1.0)
        twist = rng.uniform(-0.6, 0.6)
        tone = (rng.uniform(0.85, 1.1), rng.uniform(0.9, 1.1), rng.uniform(0.8, 1.0))
        rows, p, prev = 6, base.copy(), []
        for k in range(rows + 1):
            t = k / rows
            angle = lean + bend * t * t
            d = out * math.sin(angle) + UP * math.cos(angle)
            across = Matrix.Rotation(twist * t, 3, d) @ d.cross(out).normalized()
            if k:
                p = p + d * length / rows
            normal = (out * 0.5 + UP * 0.8).normalized()
            shade = 0.45 + 0.55 * t ** 0.5
            row = [m.vert(p + across * s * width / 2, mul(tone, shade), normal) for s in (-1, 1)]
            if prev:
                m.face((prev[0], prev[1], row[1], row[0]), (cell_uv(cell, 0, (k - 1) / rows), cell_uv(cell, 1, (k - 1) / rows), cell_uv(cell, 1, t), cell_uv(cell, 0, t)), LEAVES)
            prev = row
    for k in range(cattails):  # stems with a brown cattail head and a thin spike above it
        a, d = rng.uniform(0, 6.3), rng.uniform(0, 0.08)
        tall = height * rng.uniform(0.9, 1.05)
        lean = Vector((math.cos(a), math.sin(a), 0)) * rng.uniform(0.02, 0.08)
        stem = [Vector((math.cos(a) * d, math.sin(a) * d, -0.02)) + lean * (z / tall) ** 2 + UP * z for z in np.linspace(0, tall, 5)]
        tube(heads, stem, [0.006, 0.005, 0.005, 0.004, 0.003], 4, PLAIN, (0.22, 0.30, 0.10))
        top = stem[-1]
        axis = (stem[-1] - stem[-2]).normalized()
        head = [top - axis * (0.22 - 0.2 * j / 5) for j in range(6)]
        hr = [0.012, 0.019, 0.02, 0.02, 0.019, 0.012]
        rings, fr = tube(heads, head, hr, 8, PLAIN, lambda i, a, q: mul((0.24, 0.13, 0.06), rng.uniform(0.85, 1.1)))
        cap(heads, rings[0], head[0], fr[0], hr[0], -1, (0.24, 0.13, 0.06), PLAIN)
        cap(heads, rings[-1], head[-1], fr[-1], hr[-1], 1, (0.24, 0.13, 0.06), PLAIN)
        tube(heads, [top, top + axis * 0.1], [0.003, 0.001], 3, PLAIN, (0.35, 0.3, 0.15))
    m.build(name + "_blades", node, custom_normals=True)
    heads.build(name + "_stems", node)
    return m.tris() + heads.tris()


# ---- all of it -------------------------------------------------------------------------------------------------
tree("tree_1", "alder")
tree("tree_2", "birch")
tree("tree_3", "willow")
counts = {
    "stump_1": stump_gnawed("stump_1"),
    "stump_2": stump_sawn("stump_2"),
    "log_1": log("log_1", 2.4, 0.16, 61, gnawed=False),
    "log_2": log("log_2", 1.7, 0.12, 62, gnawed=True),
    "stick_1": stick("stick_1", 0.7, 0.022, 71),
    "stick_2": stick("stick_2", 0.55, 0.018, 72, peeled=True),
    "stick_3": stick("stick_3", 0.76, 0.025, 73, with_twig=True),
    "rock_1": rock("rock_1", (0.2, 0.14, 0.085), 81, (0.85, 0.76, 0.66), bumpy=0.04),
    "rock_2": rock("rock_2", (0.38, 0.31, 0.22), 82, (0.74, 0.70, 0.66), moss=0.4, bumpy=0.07),
    "rock_3": rock("rock_3", (0.62, 0.5, 0.45), 83, (0.82, 0.74, 0.64), angular=True, moss=0.8),
    "crate_1": crate("crate_1"),
    "reed_1": reed("reed_1", 91, 52, 1.0, 0.032, 0),
    "reed_2": reed("reed_2", 92, 34, 1.35, 0.026, 5),
}
for k, v in counts.items():
    print(f"{k}: {v} triangles")

if "--save" in argv:
    bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index("--save") + 1])
if argv and not argv[0].startswith("--"):
    bpy.ops.export_scene.gltf(filepath=argv[0], export_format="GLB", export_image_format="JPEG", export_image_quality=88,
                              export_vertex_color="ACTIVE", export_yup=True)
    print("exported", argv[0], os.path.getsize(argv[0]) // 1024, "KB")
shutil.rmtree(TMP)
