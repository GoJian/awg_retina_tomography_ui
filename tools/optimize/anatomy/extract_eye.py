"""
Tessellate feelpp/mesh.eye `Eye.step` into one triangle mesh per anatomical
volume, and write them out as individual PLY files plus a manifest.

Solid tags 1..10 follow the MakePartition order in construct-eye-STP.py:
    [Cornea, Aqueous_humor, Iris, Lens, Vitreous_humor,
     Sclera, Choroid, Retina, Lamina, OpticNerve]
which was verified independently against the geometry (nesting radii,
antero-posterior centroids, volumes).
"""
import json
import os
import sys

import gmsh
import numpy as np

STEP = sys.argv[1] if len(sys.argv) > 1 else "mesheye/Eye.step"
OUT = sys.argv[2] if len(sys.argv) > 2 else "eye_parts"
LC = float(sys.argv[3]) if len(sys.argv) > 3 else 500.0   # target element size (model units)

# tag -> (key, pretty label)
NAMES = {
    1:  ("cornea",      "Cornea"),
    2:  ("aqueous",     "Aqueous humour"),
    3:  ("iris",        "Iris"),
    4:  ("lens",        "Lens"),
    5:  ("vitreous",    "Vitreous humour"),
    6:  ("sclera",      "Sclera"),
    7:  ("choroid",     "Choroid"),
    8:  ("retina",      "Retina"),
    9:  ("lamina",      "Lamina cribrosa"),
    10: ("optic_nerve", "Optic nerve"),
}

os.makedirs(OUT, exist_ok=True)

gmsh.initialize()
gmsh.option.setNumber("General.Terminal", 1)
gmsh.model.occ.importShapes(STEP)
gmsh.model.occ.synchronize()

gmsh.option.setNumber("Mesh.MeshSizeMin", LC * 0.25)
gmsh.option.setNumber("Mesh.MeshSizeMax", LC)
gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 22)   # nodes per 2*pi of curvature
gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 0)
gmsh.option.setNumber("Mesh.Algorithm", 6)                # Frontal-Delaunay
gmsh.option.setNumber("Mesh.Optimize", 1)

vols = gmsh.model.getEntities(3)
print(f"{len(vols)} solids; meshing surfaces...")
gmsh.model.mesh.generate(2)

manifest = []
for dim, tag in vols:
    key, label = NAMES.get(tag, (f"solid_{tag}", f"Solid {tag}"))
    surfs = [s for (_d, s) in gmsh.model.getBoundary([(dim, tag)], oriented=False)]

    verts = {}           # gmsh node tag -> local index
    pts = []
    tris = []
    for s in surfs:
        ntags, ncoords, _ = gmsh.model.mesh.getNodes(2, s, includeBoundary=True)
        ncoords = np.array(ncoords).reshape(-1, 3)
        for nt, xyz in zip(ntags, ncoords):
            if nt not in verts:
                verts[nt] = len(pts)
                pts.append(xyz)
        etypes, etags, enodes = gmsh.model.mesh.getElements(2, s)
        for et, en in zip(etypes, enodes):
            if et != 2:      # 3-node triangle
                continue
            en = np.array(en).reshape(-1, 3)
            for tri in en:
                tris.append([verts[t] for t in tri])

    if not tris:
        print(f"  !! {key}: no triangles")
        continue

    pts = np.array(pts, dtype=np.float64) * 0.001      # model units -> millimetres
    tris = np.array(tris, dtype=np.int64)

    import trimesh
    m = trimesh.Trimesh(vertices=pts, faces=tris, process=True, validate=True)
    m.merge_vertices()
    m.fix_normals()
    path = os.path.join(OUT, f"{key}.ply")
    m.export(path)
    manifest.append(dict(key=key, label=label, tag=tag, file=os.path.basename(path),
                         faces=int(len(m.faces)), verts=int(len(m.vertices)),
                         watertight=bool(m.is_watertight),
                         volume_mm3=float(abs(m.volume)),
                         bounds=[[round(v, 3) for v in m.bounds[0]], [round(v, 3) for v in m.bounds[1]]]))
    print(f"  {key:<12} {len(m.faces):>7} tris  vol={abs(m.volume):8.2f} mm^3  watertight={m.is_watertight}")

with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)

print("total tris:", sum(m["faces"] for m in manifest))
gmsh.finalize()
