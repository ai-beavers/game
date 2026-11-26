# Animal models from pictures

Turns three pictures of an animal (front, side, back) into a detailed, textured 3D model on our own machine, with
free open models. The model it makes is a sculpt of about 700,000 triangles: `tools/blender` then cuts it to game
size, bakes its fur into maps and gives it a skeleton.

```
river-kit/front.png, side.png, back.png      our pictures of the animal, transparent ground
        │  views.py            one scale, feet on one line, on black, the side picture also mirrored
        ▼
ComfyUI/input/river-kit-{front,left,back,right}.png
        │  generate.py         runs pixal3d-multi-view.json in ComfyUI
        ▼
ComfyUI/output/3d/river-kit_00001.glb         700,000 triangles, 4K maps
        │  coat.py             the furry pictures squeezed onto the smooth ones' outline
        │  paint.py            our pictures projected onto it: its colour map anew
        ▼
ComfyUI/output/3d/river-kit-painted.glb
```

## Run it

```bash
cd tools/comfyui
C=~/dev/3d-gen/ComfyUI
$C/.venv/bin/python views.py river-kit-smooth --comfy $C        # then look at river-kit-smooth-views.png
$C/.venv/bin/python generate.py river-kit-smooth                # about 8 minutes on an M4 Max
$C/.venv/bin/python views.py river-kit --comfy $C               # the furry pictures, for the coat
$C/.venv/bin/python coat.py river-kit-smooth river-kit --comfy $C
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P paint.py -- river-kit-smooth $C front,left,back,right left,right furred
cd ../blender
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P hide.py -- $C/output/3d/river-kit-smooth-painted.glb kit-hide.glb 0.58 15000
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P kit.py -- ../../assets/kit.glb
```

The last two lines make the game's model: `hide.py` cuts the sculpt to 15,000 triangles and bakes its colour and
relief into two maps, `kit.py` lays the skeleton into it and writes the clips and the fur's mask.

**The river kit itself is made the short way now**, from its one reference picture: `single.py` prepares
`river-kit/target.png` as the only view, `generate.py river-kit-ref --views front` builds the animal the picture
shows (16 minutes), `paint.py -- river-kit-ref $C front front` paints the picture itself onto the side it shows,
`hide.py … river-kit-ref-painted.glb kit-hide.glb 0.58 20000 turn` sets it nose first and cuts it, and `kit.py` rigs it. That model has
the reference's shape, face, claws and tail, which the three-picture route below never reached. Use the route below
for an animal of which there are only drawn views.

`river-kit/target.png` is what the kit shall look like: judge the model in the game beside it, from its side, before
calling it done. `river-kit/` also holds the furry pictures of the kit. A model made from them comes out in lumps,
so the shape is made from the smooth ones and the furry ones give the coat: `coat.py` fits them onto the smooth
outline and `paint.py` paints them on. `kit.py` does the rest: it reshapes the long, low hide to the reference's
round one (short legs, deep trunk, larger ears), and adds eyes, nose, mouth, whiskers, claws, the cards of long hair,
the fur's mask and the head-up stance.
Another animal: a folder beside `river-kit-smooth/` with its three pictures, and its name in both commands. A second number
after the name in `generate.py` is added to the seeds: another try from the same pictures.

## The pictures

The model builds what the pictures agree on and smears what they do not, so:

- The same pose in all three: standing, four legs apart, tail straight back, head level, mouth shut. A sitting animal
  comes out with its legs grown into its body and cannot be given a skeleton that bends.
- Straight from the front, the side and the back, as flat as a drawing: no view from above, as little perspective as
  the picture tool allows.
- The side picture faces picture-right. `views.py` mirrors it for the other flank.
- A transparent ground, no shadow under the animal.
- A smooth animal, as if of clay: no fur strands, no whiskers. The model builds every strand that stands out of the
  outline as a lump or a shard of mesh. Fur is the game's fur shader over the clean body: `kit.py` writes where
  it grows and how long into the model's vertex colours.
- Nothing in a picture that another picture places elsewhere. Pictures drawn one by one are never quite one animal,
  and the model builds both versions: a tail seen between the legs in the front picture became a lump under the
  belly, eyes looking forward in the front picture a second pair beside the ones of the side picture. So such things
  are painted out of the front picture (`river-kit-smooth/front.png`; as it was drawn: `front-as-drawn.png`) and the
  model is coloured from the side pictures alone (`paint.py … left,right`), which its head follows most closely.
  One turnaround sheet drawn as a single orthographic picture would spare all of this.

`views.py` explains at its top which view goes where; the side views swapped is the mistake that looks like a broken
model (two tails, the chest's fur on the rump).

## Setting ComfyUI up, once

Tried on an M4 Max with 128 GB of memory; the models take 14 GB of disk. The model is the full-precision one: ComfyUI's template
takes the 8-bit one (`pixal3d_multiview_int8_convrot.safetensors`, half the size), which is no faster here and a little rougher.

```bash
git clone https://github.com/Comfy-Org/ComfyUI.git ~/dev/3d-gen/ComfyUI && cd ~/dev/3d-gen/ComfyUI
git checkout 8b146ae                                   # ComfyUI 0.46.0, the version the workflow was saved from
uv venv .venv --python python3.11 && uv pip install --python .venv/bin/python -r requirements.txt
gh pr diff 17460 -R Comfy-Org/ComfyUI | git apply      # until it is merged: see below
hf download Comfy-Org/Pixal3D --local-dir models \
  vae/trellis_2_texture_vae_bf16.safetensors vae/trellis_2_shape_vae_bf16.safetensors \
  clip_vision/dino_v3_L_naf_fp32.safetensors diffusion_models/pixal3d_multiview_bf16.safetensors
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

No paid service and nothing that excludes the EU. Meta's DINOv3 licence (14 August 2025) sets terms for passing on
DINOv3 itself, which the game does not do, and none for what is made with it. It forbids military, weapons and
nuclear uses.

## What to expect

A recognisable animal with the right proportions and a sculpted fur surface. The model's own colour is poor (eyes as
dark blotches, a smeared muzzle, streaks): `paint.py` replaces it with our pictures, which fit because the model
follows them pixel for pixel. Not the pictures' soft fur: that is rendered hair, and a game model is a skin with fur
painted on. The muzzle's shape stays the weakest part: whiskers come out as lumps.
