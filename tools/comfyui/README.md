# Animal models from pictures

Turns three pictures of an animal (front, side, back) into a detailed, textured 3D model on our own machine, with
free open models. The model it makes is a sculpt of about 700,000 triangles: `tools/blender` then cuts it to game
size, bakes its fur into maps and gives it a skeleton, as it does for the bear.

```
river-kit/front.png, side.png, back.png      our pictures of the animal, transparent ground
        │  views.py            one scale, feet on one line, on black, the side picture also mirrored
        ▼
ComfyUI/input/river-kit-{front,left,back,right}.png
        │  generate.py         runs pixal3d-multi-view.json in ComfyUI
        ▼
ComfyUI/output/3d/river-kit_00001.glb         700,000 triangles, 4K maps
```

## Run it

```bash
cd tools/comfyui
~/dev/3d-gen/ComfyUI/.venv/bin/python views.py river-kit --comfy ~/dev/3d-gen/ComfyUI   # then look at river-kit-views.png
~/dev/3d-gen/ComfyUI/.venv/bin/python generate.py river-kit                             # about 9 minutes on an M4 Max
```

Another animal: a folder beside `river-kit/` with its three pictures, and its name in both commands. A second number
after the name in `generate.py` is added to the seeds: another try from the same pictures.

## The pictures

The model builds what the pictures agree on and smears what they do not, so:

- The same pose in all three: standing, four legs apart, tail straight back, head level, mouth shut. A sitting animal
  comes out with its legs grown into its body and cannot be given a skeleton that bends.
- Straight from the front, the side and the back, as flat as a drawing: no view from above, as little perspective as
  the picture tool allows.
- The side picture faces picture-right. `views.py` mirrors it for the other flank.
- A transparent ground, no shadow under the animal.

`views.py` explains at its top which view goes where; the side views swapped is the mistake that looks like a broken
model (two tails, the chest's fur on the rump).

## Setting ComfyUI up, once

Tried on an M4 Max with 128 GB of memory; the models take 9 GB of disk.

```bash
git clone https://github.com/Comfy-Org/ComfyUI.git ~/dev/3d-gen/ComfyUI && cd ~/dev/3d-gen/ComfyUI
git checkout 8b146ae                                   # ComfyUI 0.46.0, the version the workflow was saved from
uv venv .venv --python python3.11 && uv pip install --python .venv/bin/python -r requirements.txt
gh pr diff 17460 -R Comfy-Org/ComfyUI | git apply      # until it is merged: see below
hf download Comfy-Org/Pixal3D --local-dir models \
  vae/trellis_2_texture_vae_bf16.safetensors vae/trellis_2_shape_vae_bf16.safetensors \
  clip_vision/dino_v3_L_naf_fp32.safetensors diffusion_models/pixal3d_multiview_int8_convrot.safetensors
.venv/bin/python main.py --listen 127.0.0.1 --port 8288    # leave it running; generate.py talks to this port
```

- **PR #17460** fixes the texture stage on Apple's GPU with more than one view. Without it a run ends after the
  shape with `Trellis2TextureStage: value cannot be converted to type int32_t without overflow`
  (ComfyUI issue #17459).
- **macOS 26.0 to 26.2** has a fault of its own in this model (ComfyUI issue #16340, "Trellis2 coords can't be
  empty"): update macOS.
- The workflow is ComfyUI's template `3d_pixal3d_multi_views` with its picture handling taken out; after a ComfyUI
  update, compare `pixal3d-multi-view.json` with the template again if a node refuses its inputs.

## What it is made of, and the licences

| Part | From | Licence |
|---|---|---|
| Pixal3D multi-view (the model) | Tencent ARC, on Microsoft's TRELLIS.2 | MIT |
| TRELLIS.2 shape and texture VAEs | Microsoft | MIT |
| DINOv3 ViT-L (reads the pictures) | Meta, as repackaged by Comfy Org | Meta's DINOv3 licence |
| ComfyUI (runs it) | Comfy Org | GPL-3; a tool only, nothing of it is in the game |

No paid service and nothing that excludes the EU. Read Meta's DINOv3 licence before shipping an animal made with it:
nobody here has yet.

## What to expect

A recognisable animal with the right proportions, its coat's colours and a sculpted fur surface. Not the pictures'
soft fur: that is rendered hair, and a game model is a skin with fur painted on. The face is the weakest part; it is
only as sharp as the front and side pictures agree.
