"""One finished picture of an animal as the only view for generate.py: python single.py river-kit/target.png river-kit-ref --comfy ~/dev/3d-gen/ComfyUI

For an animal of which there is one good picture, seen from wherever (the river kit's reference, a three-quarter
view): the model builds what the picture shows and makes the rest up. Then

    python generate.py river-kit-ref --views front
    Blender -b --factory-startup -P ../blender/hide.py -- <ComfyUI>/output/3d/river-kit-ref_00001.glb kit-hide.glb 0.58 20000 turn

The model stands as the picture saw it: hide.py's "turn" sets it nose first.

Writes <name>-front.png (1024 px, on black) and <name>-front-rgba.png (2048 px) into ComfyUI's input folder, the
animal in the middle with a tenth of margin, single hairs and whiskers standing out of its outline taken off (they
would come out as shards: views.py says more).
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

args = argparse.ArgumentParser()
args.add_argument("picture", help="a picture with a transparent ground")
args.add_argument("name")
args.add_argument("--comfy", required=True, help="ComfyUI's folder")
args = args.parse_args()
rgba = np.asarray(Image.open(args.picture).convert("RGBA")).astype(np.float32)
colour, alpha = rgba[..., :3], np.clip((rgba[..., 3]-6)/244, 0, 1)
assert alpha.min() < .5, "the picture has no transparent ground"
thin = max(2, round(min(alpha.shape)/150))
alpha *= ndimage.binary_dilation(ndimage.binary_opening(alpha > .5, iterations=thin), iterations=1)
ys, xs = np.nonzero(alpha > .5)
top, bottom, left, right = ys.min(), ys.max()+1, xs.min(), xs.max()+1
colour, alpha = colour[top:bottom, left:right], alpha[top:bottom, left:right]
h, w = alpha.shape
side = int(1.1*max(h, w))
x, y = (side-w)//2, (side-h)//2
canvas = np.zeros((side, side, 4), np.float32)
canvas[y:y+h, x:x+w] = np.dstack([colour*alpha[..., None], alpha*255])
inputs = Path(args.comfy).expanduser() / "input"
Image.fromarray(canvas[..., :3].astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(inputs / f"{args.name}-front.png")
canvas[y:y+h, x:x+w, :3] = colour  # its own colour up to the outline, not darkened towards black
Image.fromarray(canvas.astype(np.uint8)).resize((2048, 2048), Image.LANCZOS).save(inputs / f"{args.name}-front-rgba.png")
print("single:", w, "x", h, "of", side, "->", inputs / f"{args.name}-front.png")
