"""One animal through the saved ComfyUI workflow, without the browser: python generate.py river-kit [seed]

ComfyUI must run (README.md) and views.py must have put <name>-front.png, -left.png, -back.png and -right.png into
its input folder. The model is saved by ComfyUI as output/3d/<name>_00001.glb (the number counts up): about 700,000
triangles with 4K maps of colour, roughness, relief and shade, for tools/blender to cut down and rig.

pixal3d-multi-view.json is the workflow as ComfyUI's API takes it: its template "3d_pixal3d_multi_views" (ComfyUI
0.46.0, templates 0.11.114) with the template's own picture handling (cutting a sheet, removing the ground, cropping
each view by itself) replaced by our four prepared views. Open it in ComfyUI with Workflow > Open to see it as a graph.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HOST = "http://127.0.0.1:8288"
name = sys.argv[1]
prompt = json.loads(Path(__file__).with_name("pixal3d-multi-view.json").read_text())
for node in prompt.values():
    node.pop("_meta", None)
    if node["class_type"] == "LoadImage":
        node["inputs"]["image"] = node["inputs"]["image"].replace("river-kit", name)
    if node["class_type"] == "Save3DAdvanced":
        node["inputs"]["filename_prefix"] = f"3d/{name}"
    if node["class_type"] == "KSampler" and len(sys.argv) > 2:
        node["inputs"]["seed"] += int(sys.argv[2])  # another seed, another animal from the same pictures

request = urllib.request.Request(HOST + "/prompt", json.dumps({"prompt": prompt}).encode(), {"Content-Type": "application/json"})
try:
    run = json.load(urllib.request.urlopen(request, timeout=60))["prompt_id"]
except urllib.error.HTTPError as error:
    sys.exit("ComfyUI refused the workflow: " + error.read().decode()[:3000])
print("queued", run, flush=True)
started = time.time()
while True:
    time.sleep(5)
    entry = json.load(urllib.request.urlopen(f"{HOST}/history/{run}", timeout=60)).get(run)
    if not entry or entry["status"].get("completed") is None:
        continue
    print(entry["status"]["status_str"], "after", round(time.time() - started), "s")
    for kind, detail in entry["status"].get("messages", []):
        if kind == "execution_error":
            sys.exit(f'{detail["node_type"]}: {detail["exception_message"]}')
    print([f'{item["subfolder"]}/{item["filename"]}' for out in entry["outputs"].values() for item in out.get("3d", [])])
    break
