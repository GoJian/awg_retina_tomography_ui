"""
Assemble the tessellated mesh.eye structures into one glTF scene with named,
coloured nodes — one node per anatomical structure, named by its key so the
viewer can drive each one independently.

Orientation: the model's own axis is X (cornea at -X, optic nerve at +X), with
the optic-nerve head offset along -Y. Three.js frames a fresh pane from +Z, so
that lands on the classic sagittal-section view: cornea to the left of screen,
optic nerve exiting right and slightly inferior. Nothing to rotate.
"""
import json
import os
import sys

import numpy as np
import trimesh

SRC = sys.argv[1] if len(sys.argv) > 1 else "eye_parts"
OUT = sys.argv[2] if len(sys.argv) > 2 else "eye-anatomy-raw.glb"

# key -> (baseColorFactor RGB, base alpha, metallic, roughness)
# Colours are anatomically motivated but tuned to read on the app's dark UI.
STYLE = {
    "sclera":      ((0.878, 0.859, 0.812), 1.00, 0.0, 0.62),  # bone white, faintly warm
    "cornea":      ((0.694, 0.878, 0.937), 0.34, 0.0, 0.12),  # clear, glassy
    "aqueous":     ((0.600, 0.831, 0.925), 0.20, 0.0, 0.10),  # watery pale blue
    "iris":        ((0.612, 0.400, 0.204), 1.00, 0.0, 0.55),  # brown stroma
    "lens":        ((0.949, 0.886, 0.706), 0.62, 0.0, 0.15),  # amber, translucent
    "vitreous":    ((0.749, 0.882, 0.933), 0.16, 0.0, 0.10),  # gel, nearly clear
    "retina":      ((0.878, 0.435, 0.353), 1.00, 0.0, 0.58),  # fundus orange-red
    "choroid":     ((0.612, 0.180, 0.259), 1.00, 0.0, 0.52),  # vascular deep red
    "lamina":      ((0.639, 0.796, 0.667), 1.00, 0.0, 0.60),  # pale green, connective
    "optic_nerve": ((0.937, 0.906, 0.804), 1.00, 0.0, 0.60),  # ivory nerve sheath
}

manifest = json.load(open(os.path.join(SRC, "manifest.json")))

# Centre the whole assembly on the globe (sclera), not on the bounding box of
# everything — otherwise the long optic nerve drags the eye off-centre.
sclera = trimesh.load(os.path.join(SRC, "sclera.ply"))
globe_centre = sclera.bounds.mean(axis=0)

scene = trimesh.Scene()
total = 0
for entry in manifest:
    key = entry["key"]
    m = trimesh.load(os.path.join(SRC, entry["file"]))
    m.apply_translation(-globe_centre)

    rgb, alpha, metal, rough = STYLE[key]
    m.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(
            name=key,
            baseColorFactor=[*[int(round(c * 255)) for c in rgb], int(round(alpha * 255))],
            metallicFactor=metal,
            roughnessFactor=rough,
            alphaMode="BLEND" if alpha < 1 else "OPAQUE",
            doubleSided=True,
        )
    )
    scene.add_geometry(m, geom_name=key, node_name=key)
    total += len(m.faces)
    print(f"  {key:<12} {len(m.faces):>7} tris  alpha={alpha}")

# smooth vertex normals are required or three.js renders these spheres faceted
with open(OUT, "wb") as f:
    f.write(trimesh.exchange.gltf.export_glb(scene, include_normals=True))
print(f"\n{OUT}: {total} tris, {os.path.getsize(OUT)/1e6:.2f} MB")
print("bounds (mm):", np.round(scene.bounds, 2).tolist())
