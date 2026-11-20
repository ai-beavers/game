# Builds the things that stand around in the beaver's world, in Blender from nothing, and exports them as one glb:
# trees (oak, birch, poplar), bushes, stumps (gnawed, sawn), logs, sticks, rocks, a crate and reeds.
#
#   blender -b --factory-startup -P props.py -- props.glb [--save props.blend]
#
# One node per variant, named <prop>_<n> (tree_1 …), everything it needs as children; each stands on the ground
# (glTF y = 0) around its own origin, metres. Sticks and logs lie along glTF z (Blender y), middle at the origin,
# resting on the ground. src/props/index.ts loads the file.
#
# Every texture is drawn here with numpy and kept small; they are shared: bark, birch bark, end grain, wood grain,
# stone, and one leaf atlas (sprays of broad and birch leaves, a crown's skin, a reed blade) with alpha. Vertex colours
# tint them per model (bark tone, shade in a crown's creases, moss, fresh wood); for leaves and reeds their alpha says
# how freely each vertex flutters. Leaves and reeds carry their own normals (out of the crown, up for reeds), so they
# shade like a volume and not like flat paper; src/world/foliage.ts lights and moves them.
# Blender is z up here; the exporter turns it into glTF's y up.
import bpy, bmesh, math, os, shutil, subprocess, sys, tempfile
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
    colour = mix((0.27, 0.19, 0.13), (0.62, 0.50, 0.40), np.clip(height, 0, 1)) * (1 + 0.08 * fine)[..., None]
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
    """Leaf atlas, 2 x 2 cells: broad leaves and birch leaves, each a spray of leafy twigs from the bottom middle of
    its cell; a crown's skin (leaves painted over each other in soft dabs, no holes); and one reed blade filling its
    cell from bottom to a point at the top. Where there is no leaf, the colour is the cell's mean leaf colour, so
    mipmaps do not draw dark rims. All of it a light, warm green: vertex colours tint it per tree and bush."""
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

    def skin(cell, count, colour):
        """The crown's skin: small leaves in soft dabs, overlapping until no ground shows, light on their upper half
        (the side the sky lights), each drawn only in its own little square."""
        layer = np.zeros((C, C, 4))
        layer[..., :3], layer[..., 3] = np.asarray(colour) * 0.88, 1.0
        for _ in range(count):
            cx, cy, angle = rng.uniform(0, 1), rng.uniform(0, 1), rng.uniform(0, 2 * math.pi)
            length, width = rng.uniform(0.05, 0.09), rng.uniform(0.5, 0.65)
            box = int(length * C) + 2
            x0, y0 = int(cx * C) - box // 2, int(cy * C) - box // 2
            xs, ys = slice(max(0, x0), min(C, x0 + box)), slice(max(0, y0), min(C, y0 + box))
            sx, sy = x[ys, xs] - cx, y[ys, xs] - cy
            along = (sx * math.cos(angle) + sy * math.sin(angle)) / length + 0.5
            across = (-sx * math.sin(angle) + sy * math.cos(angle)) / (length * width)
            t = np.clip(along, 0, 1)
            cover = np.clip((np.sin(math.pi * t) ** 0.8 * 0.5 - np.abs(across)) * length * width * C * 2 + 0.5, 0, 1) * (along > 0) * (along < 1)
            lit = 0.88 + 0.24 * np.clip(sy / length + 0.5, 0, 1) - 0.08 * np.abs(across)
            tone = np.asarray(colour) * rng.uniform(0.9, 1.1) * np.array((rng.uniform(0.95, 1.08), 1, rng.uniform(0.85, 1.0)))
            patch = layer[ys, xs]
            patch[..., :3] = patch[..., :3] * (1 - cover[..., None]) + tone * lit[..., None] * cover[..., None]
        rgba[(cell // 2) * C:(cell // 2 + 1) * C, (cell % 2) * C:(cell % 2 + 1) * C] = layer

    # broad: round, broadest beyond the middle, blunt tip; birch: small, triangular, pointed, toothed.
    spray(0, 4, 7, 0.16, 0.46, lambda t: np.sin(math.pi * t ** 1.3) ** 0.7, (0.50, 0.66, 0.22), 55)
    spray(1, 5, 8, 0.11, 0.36, lambda t: np.sin(math.pi * t ** 0.6) ** 0.9, (0.56, 0.68, 0.22), 55, serrate=0.06)
    skin(2, 1500, (0.52, 0.68, 0.22))
    t = np.clip(y, 0, 1)
    half = 0.44 * (1 - t ** 3) ** 0.5
    cover = np.clip((half - np.abs(x - 0.5)) * C + 0.5, 0, 1) * (y < 0.995)
    veins = 0.92 + 0.08 * np.cos((x - 0.5) / 0.44 * 7 * math.pi)
    blade = mix((0.40, 0.54, 0.16), (0.78, 0.70, 0.36), ramp(0.6, 1.0, t)) * veins[..., None]
    place(3, np.dstack((blade, cover)))
    return save("leaves", rgba)


bark_img, bark_nrm = bark_texture()
birch_img, birch_nrm = birch_texture()
end_img, end_nrm = end_grain_texture()
wood_img, wood_nrm = wood_texture()
stone_img, stone_nrm = stone_texture()
leaf_img = leaf_texture()
CELLS = {"broad": 0, "birch": 1, "skin": 2, "reed": 3}


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

    def vert(self, p, colour=(1, 1, 1), normal=None, alpha=1.0):
        """alpha: for foliage, how freely the vertex flutters in the wind (src/world/foliage.ts)."""
        self.co.append(tuple(p))
        self.col.append((*colour[:3], alpha))
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


# ---- crowns, bushes ------------------------------------------------------------------------------------------------
# Foliage is a few soft masses: lumpy spheres that overlap, the parts buried in a neighbour left out. Their normals
# lean out of the whole crown, so it shades as one rounded volume, each mass still round within it; vertex colours
# darken the creases between masses and the underside. Leaf cards stand out of the masses' outside only, to break
# the silhouette. One mesh, the leaves material: the skin's atlas cell has no holes.
_SPHERE = {}


def sphere(sub):
    if sub not in _SPHERE:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        _SPHERE[sub] = (np.array([tuple(v.co.normalized()) for v in bm.verts]), [[v.index for v in f.verts] for f in bm.faces])
        bm.free()
    return _SPHERE[sub]


def foliage(m, masses, rng, tone, cell, cards, card, droop=0.0, lumpy=0.2, sub=2):
    """masses: (centre, radii) each; tone: the leaves' tint; cards per square metre of outside, card size in m."""
    dirs, faces = sphere(sub)
    cs, rs = np.array([tuple(c) for c, _ in masses]), np.array([r for _, r in masses], float)
    lo, hi = (cs - rs).min(0), (cs + rs).max(0)
    mid, half = (lo + hi) / 2, (hi - lo) / 2
    for i, (c, r) in enumerate(masses):
        waves = rng.normal(size=(6, 3)) * np.array([[1.5], [2], [2.5], [3], [4], [5]])
        phases, amps = rng.uniform(0, 6.3, 6), 1 / np.arange(1, 7) ** 0.7
        wobble = (np.sin(dirs @ waves.T + phases) * amps).sum(1) / amps.sum() * 2
        p = cs[i] + dirs * rs[i] * (1 + lumpy * wobble)[:, None]
        s = dirs / rs[i]
        s /= np.linalg.norm(s, axis=1, keepdims=True)
        o = (p - mid) / half
        o /= np.maximum(np.linalg.norm(o, axis=1, keepdims=True), 1e-6)
        n = 0.55 * s + 0.45 * o + np.array((0, 0, 0.12))
        n /= np.linalg.norm(n, axis=1, keepdims=True)
        others = np.linalg.norm((p[:, None, :] - cs[None]) / rs[None], axis=2)
        others[:, i] = np.inf
        crease = others.min(1) - 1  # below 0: inside a neighbour
        rel = (p[:, 2] - mid[2]) / half[2]
        shade = (0.6 + 0.4 * ramp(-1, 0.7, rel)) * (0.7 + 0.3 * ramp(-0.05, 0.35, crease)) * rng.uniform(0.92, 1.08)
        colour = np.asarray(tone) * shade[:, None]
        index = {}

        def at(k):
            if k not in index:
                index[k] = m.vert(Vector(p[k]), tuple(colour[k]), Vector(n[k]), 0.0)
            return index[k]

        for f in faces:
            if all(crease[k] < -0.06 for k in f):
                continue
            axis = int(np.argmax(np.abs(s[f].sum(0))))
            a, b = [k for k in range(3) if k != axis]
            m.face([at(k) for k in f], tuple(cell_uv(CELLS["skin"], 0.5 + (p[k][a] - cs[i][a]) / 3.8, 0.5 + (p[k][b] - cs[i][b]) / 3.8) for k in f), LEAVES)
        # cards on the outside: where no neighbour is near, more of them where the mass faces out of the crown
        out = np.where(crease > 0.08)[0]
        if not len(out):
            continue
        weight = np.clip((s[out] * o[out]).sum(1) + 0.5, 0.05, None)
        area = 4 * math.pi * float(np.mean(rs[i])) ** 2 * len(out) / len(dirs)
        count = min(len(out), max(2, round(cards * area)))
        for k in rng.choice(out, count, replace=False, p=weight / weight.sum()):
            size = card * rng.uniform(0.8, 1.2)
            sv = Vector(s[k])
            base = Vector(p[k]) - sv * size * 0.3
            up = (sv * 0.8 + rand_unit(rng) * 0.45 + UP * (0.25 - droop)).normalized()
            side = up.cross(rand_unit(rng))
            side = (side if side.length > 0.1 else up.cross(Vector((1, 0, 0)))).normalized()
            w = side * size * 0.5
            c = tuple(colour[k] * 1.08)
            quad = [(base - w, 0.25), (base + w, 0.25), (base + w + up * size, 1.0), (base - w + up * size, 1.0)]
            idx = [m.vert(q, c, Vector(n[k]), flutter) for q, flutter in quad]
            m.face(idx, (cell_uv(cell, 0, 0), cell_uv(cell, 1, 0), cell_uv(cell, 1, 1), cell_uv(cell, 0, 1)), LEAVES)


# ---- trees -----------------------------------------------------------------------------------------------------
# Three kinds, each clearly its own outline: a broad oak with a low dome of masses on three or four sweeping limbs;
# a birch, white-barked and slender, with small airy masses along the upper trunk; a tall narrow poplar, a column of
# stacked masses. Per kind: trunk radius at the foot, where it forks (oak) or ends (a leader through the crown),
# root lobes, lean; bark and its tone; leaves: tint, card cell, cards per m², card size, how much the cards droop.
KINDS = {
    "oak": dict(seed=31, radius=0.165, top=2.3, fork=True, roots=6, lean=0.2, bark=BARK, tone=(0.9, 0.82, 0.74),
                leaf=(0.95, 0.92, 0.58), cell="broad", cards=1.8, card=0.8, droop=0.05),
    "birch": dict(seed=7, radius=0.13, top=7.6, fork=False, roots=4, lean=0.5, bark=BIRCH, tone=(1.0, 1.0, 1.0),
                  leaf=(1.12, 1.06, 0.58), cell="birch", cards=2.4, card=0.7, droop=0.4),
    "poplar": dict(seed=5, radius=0.155, top=9.0, fork=False, roots=5, lean=0.15, bark=BARK, tone=(0.82, 0.78, 0.72),
                   leaf=(0.74, 0.88, 0.6), cell="broad", cards=1.6, card=0.7, droop=0.0),
}


def crown_masses(kind, rng):
    """Where a kind's masses sit: (centre, radii), metres, the trunk's foot at the origin."""
    a0, out = rng.uniform(0, 6.3), []
    if kind == "oak":
        out.append((Vector((0, 0, 5.6)), (1.7, 1.6, 1.25)))
        for k in range(5):
            a, d, r = a0 + k * 2 * math.pi / 5 + rng.uniform(-0.3, 0.3), 1.9 * rng.uniform(0.9, 1.12), rng.uniform(1.25, 1.6)
            out.append((Vector((math.cos(a) * d, math.sin(a) * d, 4.6 + rng.uniform(-0.35, 0.4))), (r, r * 0.95, r * 0.78)))
        for k in range(2):
            a, r = a0 + math.pi / 5 + k * 2.6 + rng.uniform(-0.3, 0.3), rng.uniform(0.95, 1.15)
            out.append((Vector((math.cos(a) * 2.6, math.sin(a) * 2.6, 3.5)), (r * 1.1, r, r * 0.7)))
    elif kind == "birch":
        for k in range(7):
            a, d, r = a0 + k * 2.4, 0.55 + 0.25 * rng.uniform(-1, 1), (0.95 - 0.045 * k) * rng.uniform(0.8, 1.15)
            out.append((Vector((math.cos(a) * d, math.sin(a) * d, 3.7 + k * 0.6)), (r, r * 0.9, r * 1.15)))
        out.append((Vector((0.1, 0, 7.9)), (0.62, 0.6, 0.75)))
    else:
        for k in range(6):
            a, d, r = a0 + k * 2.2, 0.32 * rng.uniform(0.5, 1.2), 1.15 * (1 - 0.075 * k)
            out.append((Vector((math.cos(a) * d, math.sin(a) * d, 2.9 + k * 1.12)), (r * 0.95, r * 0.9, r * 1.35)))
        out.append((Vector((0, 0.05, 9.5)), (0.5, 0.5, 0.75)))
    return out


def tree(name, kind):
    P, node = KINDS[kind], variant(name)
    rng = np.random.default_rng(P["seed"])
    wood, leaves = Mesh(), Mesh()
    bark, tone, birch = P["bark"], P["tone"], kind == "birch"
    masses = crown_masses(kind, rng)

    def bark_colour(level):
        def colour(i, a, q):
            if birch:  # white bark, dark and rough at the foot; darker limbs
                c = lerp((0.30, 0.28, 0.26), (1, 1, 1), smooth(0.15, 1.3, q.z)) if level == 0 else (0.62, 0.58, 0.56)
            else:
                c = mul(tone, 0.95 if level == 0 else 0.82)
            return mul(c, 1 - 0.25 * (1 - smooth(-0.1, 0.5, q.z)))  # the foot of the trunk sits in shade
        return colour

    # trunk: root flare in lobes at the foot, a gentle lean and sway, up to the fork or through the crown
    top = P["top"]
    zs = [-0.15, 0.0, 0.07, 0.15, 0.26, 0.4, 0.6, 0.85] + list(np.arange(1.2, top, 0.45)) + [top]
    phase, lean_dir, H = rng.uniform(0, 6.3), rng.uniform(0, 6.3), max(top, 5.0)
    trunk_pts = [Vector((P["lean"] * (max(z, 0) / H) ** 2 * math.cos(lean_dir) + 0.04 * math.sin(z * 1.3 + phase),
                         P["lean"] * (max(z, 0) / H) ** 2 * math.sin(lean_dir) + 0.04 * math.cos(z * 1.1 + phase), z)) for z in zs]
    top_r = 0.12 if P["fork"] else 0.035
    trunk_r = lambda z: P["radius"] + (top_r - P["radius"]) * (max(z, 0) / top) ** 0.8
    roots = P["roots"]
    flare = lambda i, a: 1 + 0.9 * math.exp(-max(zs[i], 0) / 0.24) * (0.3 + 0.7 * (0.5 + 0.5 * math.cos(roots * a + phase)) ** 3) + 0.03 * math.sin(3 * a + zs[i] * 2)
    tube(wood, trunk_pts, [trunk_r(z) for z in zs], 16, bark, bark_colour(0), u_tiles=3 if P["radius"] > 0.14 else 2, shape=flare)

    # main limbs: from the fork (oak) or the trunk below each mass, ending inside the mass
    def trunk_at(z):
        i = min(range(len(zs) - 1), key=lambda j: abs(zs[j] - z))
        return trunk_pts[i]

    for c, r in masses:
        start = trunk_pts[-1] if P["fork"] else trunk_at(max(1.6, c.z - r[2] * 0.9))
        if not P["fork"] and abs(Vector((c.x, c.y, 0)).length) < 0.15:
            continue  # sits on the trunk itself
        end = c - (c - start).normalized() * min(r) * 0.35
        span = (end - start).length
        heading = (end - start).normalized()
        steps = 4
        pts = path(start, (heading + UP * 0.35).normalized(), span, steps, rng, 0.06, lambda t: (heading - UP * 0.2) * 0.25 * t)
        r0 = (0.095 if c.z > 5 else 0.075) if P["fork"] else (0.035 if birch else 0.05)
        tube(wood, pts, [max(0.018, r0 * (1 - 0.75 * k / steps)) for k in range(steps + 1)], 7, bark, bark_colour(1))

    foliage(leaves, masses, rng, P["leaf"], CELLS[P["cell"]], P["cards"], P["card"], P["droop"], sub=3)
    wood.build(name + "_wood", node)
    leaves.build(name + "_leaves", node, custom_normals=True)
    # src/world/index.ts gives each tree a trunk collider as thick as the nearest vertex between 0.6 and 1.4 m, at
    # least 0.12 m: every kind keeps that least value, so the colliders stay as they were.
    knee = min(math.hypot(x, y) for x, y, z in wood.co + leaves.co if 0.6 < z < 1.4)
    assert knee <= 0.12, f"{name}: trunk {knee:.3f} m at the knee, its collider would grow"
    print(f"{name} ({kind}): wood {wood.tris()} + leaves {leaves.tris()} triangles, {len(wood.co) + len(leaves.co)} vertices, knee {knee:.3f} m")


def bush(name, seed, masses, tone):
    """A bush on the bank: low masses sunk into the ground (src/world sinks it 0.35 m), small leaf cards round them."""
    node, rng, m = variant(name), np.random.default_rng(seed), Mesh()
    jitter = lambda v, k: Vector(v) + Vector((rng.uniform(-k, k), rng.uniform(-k, k), rng.uniform(-k, k) * 0.5))
    foliage(m, [(jitter(c, 0.08), tuple(x * rng.uniform(0.9, 1.1) for x in r)) for c, r in masses], rng, tone, CELLS["broad"], 2.2, 0.5, droop=0.1, lumpy=0.18)
    m.build(name + "_leaves", node, custom_normals=True)
    return m.tris()


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
            row = [m.vert(p + across * s * width / 2, mul(tone, shade), normal, t * t) for s in (-1, 1)]  # the tips flutter
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
tree("tree_1", "oak")
tree("tree_2", "birch")
tree("tree_3", "poplar")
counts = {
    # three bushes unlike each other: a round mound, a long low hedge on a curve, a tall one with a skirt; tints apart
    "bush_1": bush("bush_1", 101, [((0, 0, 0.62), (0.75, 0.7, 0.62)), ((0.62, 0.28, 0.42), (0.5, 0.48, 0.42)), ((-0.48, 0.42, 0.4), (0.5, 0.45, 0.4))], (0.9, 0.95, 0.6)),
    "bush_2": bush("bush_2", 102, [((-1.05, 0.1, 0.4), (0.48, 0.45, 0.4)), ((-0.4, 0.32, 0.55), (0.58, 0.52, 0.52)), ((0.3, 0.3, 0.5), (0.55, 0.5, 0.48)), ((0.95, 0.05, 0.38), (0.45, 0.42, 0.36))], (1.05, 0.98, 0.55)),
    "bush_3": bush("bush_3", 103, [((0, 0, 0.92), (0.55, 0.52, 0.78)), ((0.5, -0.25, 0.42), (0.48, 0.45, 0.4)), ((-0.3, 0.45, 0.36), (0.42, 0.4, 0.34))], (0.76, 0.9, 0.6)),
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
    # WebP: smaller than JPEG at the same quality, and the leaves keep their alpha (as JPEG they fell back to 430 KB of PNG).
    bpy.ops.export_scene.gltf(filepath=argv[0], export_format="GLB", export_image_format="WEBP", export_image_quality=88,
                              export_vertex_color="ACTIVE", export_yup=True)
    # Normals, uvs and colours as small integers (KHR_mesh_quantization, as tools/blender/build.py does): 0.15 MB less.
    subprocess.run(["bunx", "@gltf-transform/cli@4.5.1", "quantize", "--pattern", "{NORMAL,TEXCOORD_*,WEIGHTS_*,COLOR_*}", argv[0], argv[0]], check=True)
    print("exported", argv[0], os.path.getsize(argv[0]) // 1024, "KB")
shutil.rmtree(TMP)
