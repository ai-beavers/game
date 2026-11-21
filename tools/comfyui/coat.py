"""Fits the furry pictures of an animal onto the outline of its smooth ones, for paint.py to paint on the model.

    python coat.py river-kit-smooth river-kit --comfy ~/dev/3d-gen/ComfyUI

The model is made from smooth pictures (README.md: fur strands come out as lumps), so the fur's colour, its streaks,
the claws and the tail's scales are missing from it. The furry pictures of the same animal have them, but their
outline is fuller by the fur's depth, and painted on as they are they miss the model by that much. So each column of
a furry side view is squeezed between the smooth view's top and bottom edge in that column; where the furry picture
is empty there (between the legs, which stand a little apart), the smooth picture's own colour stays.

Reads <smooth>-right-rgba.png and <furry>-right-rgba.png (views.py) from ComfyUI's input folder, and writes
<smooth>-furred-right-rgba.png and its mirror, -left-: paint.py takes them with "furred" as its last word.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

args = argparse.ArgumentParser()
args.add_argument("smooth")
args.add_argument("furry")
args.add_argument("--comfy", required=True, help="ComfyUI's folder")
args = args.parse_args()
inputs = Path(args.comfy).expanduser() / "input"
smooth = np.asarray(Image.open(inputs / f"{args.smooth}-right-rgba.png").convert("RGBA")).astype(np.float32)
furry = np.asarray(Image.open(inputs / f"{args.furry}-right-rgba.png").convert("RGBA")).astype(np.float32)
assert smooth.shape == furry.shape, "views.py makes both sets the same size"
out = smooth.copy()
rows = np.arange(smooth.shape[0])
for x in range(smooth.shape[1]):
    on, fur = np.flatnonzero(smooth[:, x, 3] > 128), np.flatnonzero(furry[:, x, 3] > 128)
    if len(on) < 2 or len(fur) < 2:
        continue
    span = slice(on[0], on[-1]+1)
    source = fur[0]+(rows[span]-on[0])*(fur[-1]-fur[0])/(on[-1]-on[0])
    low = np.floor(source).astype(int)
    high, part = np.minimum(low+1, fur[-1]), (source-low)[:, None]
    squeezed = furry[low, x]*(1-part)+furry[high, x]*part
    covered = (squeezed[:, 3] > 250) & (smooth[span, x, 3] > 128)
    out[span, x, :3] = np.where(covered[:, None], squeezed[:, :3], smooth[span, x, :3])
picture = Image.fromarray(out.astype(np.uint8))
picture.save(inputs / f"{args.smooth}-furred-right-rgba.png")
picture.transpose(Image.FLIP_LEFT_RIGHT).save(inputs / f"{args.smooth}-furred-left-rgba.png")
print("coat:", inputs / f"{args.smooth}-furred-right-rgba.png")
