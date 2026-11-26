# Measures the beaver that build.py makes against a real one, and says where it is off.
#
#   blender -b --factory-startup -P measure.py
#
# Body: published measurements of Castor canadensis (Jenkins & Busher 1979, Mammalian Species 120): total length
# 1000-1200 mm, tail 258-325 mm, hind foot 156-205 mm, ear 23-39 mm; tail width 90-200 mm. Ratios are to
# head-and-body length (total minus tail), measured as on the animal: stretched out, rump to nose.
# Head: measured on photographs, because the skull's published length leaves out cheeks and flesh:
# "Beaver Preparing for Winter" (NPS; head 0.17 of the standing height) and "European beaver sitting in snow
# close up" (W. Garst; head 0.45 of the body's width), both on Wikimedia Commons.
import bpy, os, sys

sys.argv = sys.argv[:1]  # build.py: build only, export nothing
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "build.py")).read())


def span(obj, axis):
    values = [(obj.matrix_world @ v.co)[axis] for v in obj.data.vertices]
    return max(values) - min(values)


crown = max(v.co.z for v in body.data.vertices)
head_length = 0.53 * HEAD_SCALE  # nose tip to occiput as modelled, then scaled
head_body = (NECK.z - 0.12) + head_length
trunk = 2 * max(abs(v.co.x) for v in body.data.vertices if 0.25 < v.co.z < 0.5 and arm_share((g.group, g.weight) for g in v.groups) < 0.2)
foot = max(max((o.matrix_world @ v.co).y for v in o.data.vertices) for o in (feet["L"], claws["foot", "L"])) - min(min((o.matrix_world @ v.co).y for v in o.data.vertices) for o in (feet["L"], claws["foot", "L"]))
rows = [
    ("tail length / head-body", span(tail, 1) / head_body, 0.30, 0.44),
    ("tail width / tail length", span(tail, 0) / span(tail, 1), 0.35, 0.62),
    ("hind foot / head-body", foot / head_body, 0.18, 0.28),
    ("ear height / head-body", span(bpy.data.objects["ear_L"], 2) * 1.5 / head_body, 0.027, 0.053),  # the dark inside is two thirds of the ear
    ("body width / head-body", trunk / head_body, 0.30, 0.48),
    ("head height / standing height", 0.258 * HEAD_SCALE / crown, 0.13, 0.20),
    ("head width / body width", 2 * max(abs(v.co.x) for v in body.data.vertices if abs(v.co.z - head_size((0, 0, 0.83)).z) < 0.015) / trunk, 0.37, 0.53),  # across the cheeks, below the ears
    ("eye diameter / head length", span(bpy.data.objects["eye_L"], 2) / head_length, 0.05, 0.10),
]
off = 0
for name, value, low, high in rows:
    inside = low <= value <= high
    off += not inside
    print(f"MEASURE {name:32} {value:.3f}   beaver {low:.2f}-{high:.2f}   {'ok' if inside else 'OFF'}")
sys.exit(1 if off else 0)
