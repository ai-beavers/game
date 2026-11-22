"""The four views Pixal3D wants of an animal, from three pictures of it: front, side and back.

    python views.py river-kit --comfy ~/dev/3d-gen/ComfyUI

Reads <name>/front.png, <name>/side.png (the animal faces picture-right) and <name>/back.png beside this file, each
with a transparent ground, and writes <name>-front.png, -left.png, -back.png, -right.png into ComfyUI's input folder:
1024 px square, on black, the animal at one scale in all four and its feet on one line, as the workflow's
conditioning node asks ("the object spans about 1/1.1 of the frame at its widest, the same scale in every view").
<name>-views.png beside this file shows the four, to check by eye. The same four also go there with their
transparency kept, 2048 px, as <name>-front-rgba.png and so on: paint.py puts those onto the finished model.

Which side is which (ComfyUI comfy_extras/nodes_trellis2.py, _VIEW_AZIMUTHS and _orbit_camera_to_world): the left
camera stands on the animal's left flank, so in the left view the animal faces picture-LEFT. A side picture facing
picture-right is therefore the right view, and the left view is that picture mirrored. Swapped, the model takes
front for back: the tail comes out twice and the chest's fur on the rump.

The pictures are drawn one by one, so each has its own size: here they are scaled until the animal stands as tall in
each as in the side picture. In a front or back picture the feet are the lowest thing at the sides; a tail in the
middle, lying towards the camera, may reach lower and hangs below the line.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).parent
args = argparse.ArgumentParser()
args.add_argument("name")
args.add_argument("--comfy", required=True, help="ComfyUI's folder")
args = args.parse_args()


def load(view):
    rgba = np.asarray(Image.open(HERE / args.name / f"{view}.png").convert("RGBA")).astype(np.float32)
    colour, alpha = rgba[..., :3], np.clip((rgba[..., 3] - 6) / 244, 0, 1)
    # A matte's leftovers along the outline: pure red and yellow, nearly clear.
    alpha[(colour.max(axis=2) - colour.min(axis=2) > 180) & (alpha < .6)] = 0
    # Whiskers and single hairs standing out of the outline become shards of mesh on the muzzle: whatever is thinner
    # than about a hundredth of the picture goes. Whiskers lying over the fur stay, as colour.
    thin = max(2, round(min(alpha.shape)/150))
    alpha *= ndimage.binary_dilation(ndimage.binary_opening(alpha > .5, iterations=thin), iterations=1)
    solid = alpha > .5
    ys, xs = np.nonzero(solid)
    top, bottom, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    feet = bottom
    if view != "side":
        third = (right - left) // 3
        sides = solid[:, left:left + third].any(axis=1) | solid[:, right - third:right].any(axis=1)
        feet = np.nonzero(sides)[0].max() + 1
    return colour[top:bottom, left:right], alpha[top:bottom, left:right], feet - top


parts = {view: load(view) for view in ("front", "side", "back")}
tall = parts["side"][2]
views = {}
for view, (colour, alpha, height) in parts.items():
    k = tall / height
    size = (round(alpha.shape[1] * k), round(alpha.shape[0] * k))
    views[view] = (np.asarray(Image.fromarray(colour.astype(np.uint8)).resize(size, Image.LANCZOS)).astype(np.float32),
                   np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).resize(size, Image.LANCZOS)).astype(np.float32) / 255)
views["right"] = views.pop("side")
views["left"] = tuple(part[:, ::-1] for part in views["right"])
side = int(1.1 * max(max(alpha.shape) for _, alpha in views.values()))
floor = (side + tall) // 2
board = Image.new("RGB", (4 * 384, 384))
for i, view in enumerate(("front", "left", "back", "right")):
    colour, alpha = views[view]
    h, w = alpha.shape
    canvas = np.zeros((side, side, 4), np.float32)
    x, y = (side - w) // 2, floor - tall
    canvas[y:y + h, x:x + w] = np.dstack([colour * alpha[..., None], alpha * 255])[:side - y]
    inputs = Path(args.comfy).expanduser() / "input"
    picture = Image.fromarray(canvas[..., :3].astype(np.uint8)).resize((1024, 1024), Image.LANCZOS)
    picture.save(inputs / f"{args.name}-{view}.png")
    clear = canvas.copy()
    clear[y:y + h, x:x + w, :3] = colour[:side - y]  # its own colour up to the outline, not darkened towards black
    Image.fromarray(clear.astype(np.uint8)).resize((2048, 2048), Image.LANCZOS).save(inputs / f"{args.name}-{view}-rgba.png")
    board.paste(picture.resize((384, 384)), (i * 384, 0))
    print(view, w, "x", h, "of", side)
board.save(HERE / f"{args.name}-views.png")
