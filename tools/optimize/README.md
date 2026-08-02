# Mesh optimization pipeline

The source scans are very large (binary STL meshes up to ~1 GB / 21 M triangles,
and a 137 MB anatomy GLB). These scripts decimate and Draco-compress them into the
few-hundred-KB GLBs in [`../../optimized/`](../../optimized) that ship with the app.

## Setup

```bash
npm install -g @gltf-transform/cli   # provides `gltf-transform`
npm install                          # @gltf-transform/core for the STL converter
```

## Segmented STL layers

`optimize.sh` runs: **STL → GLB → weld → simplify → Draco**.

```bash
# 1 GB / 21M-triangle eye shell -> ~320k triangles (~0.6 MB)
./optimize.sh original/eye.stl     ../../optimized/sample_1_seg_mesh/eye.glb     0.015
# 156 MB / 3.1M-triangle feature   -> ~190k triangles (~0.3 MB)
./optimize.sh original/feature.stl ../../optimized/sample_1_seg_mesh/feature.glb 0.06
```

Normals are intentionally dropped and recomputed in the browser after decimation.

## Reference eye models

The left pane's eye models are generated from their upstream sources rather than
shipped as artist models, so every anatomical structure is a separate named,
watertight mesh the viewer can toggle, recolour and slice independently:

```bash
./anatomy/build-anatomy.sh
```

That clones [feelpp/mesh.eye](https://github.com/feelpp/mesh.eye) and the
[Upatras OpenSim oculomotor model](https://gitlab.com/mitkof6/upat_eye_model),
tessellates the two STEP solid models with gmsh's OpenCASCADE kernel, sweeps the
six extraocular muscles from their OpenSim path points, and packs each model into
a Draco glTF with one named node per structure. Pass model ids to rebuild just
some (`./anatomy/build-anatomy.sh work upat`).

See [`../../optimized/anatomy/README.md`](../../optimized/anatomy/README.md) for
provenance, per-model structure tables, and the upstream licences that cover the
output.

## Results

| Asset             | Original | Optimized | Reduction |
|-------------------|---------:|----------:|----------:|
| `eye.stl`         | 1008 MB  | 0.6 MB    | ~1600×    |
| `feature.stl`     | 149 MB   | 0.3 MB    | ~450×     |
| `eye-anatomy.glb`     | 3.5 MB¹ | 0.35 MB | ~10×  |
| `human-eye-cad.glb`   | 3.6 MB¹ | 0.36 MB | ~10×  |
| `upat-oculomotor.glb` | 0.17 MB¹| 0.03 MB | ~5.5× |

¹ Raw glTF from the tessellated source. Together the three models are 740 KB.
They replaced a single 137 MB texture-dominated artist model that optimized to
7.2 MB / 2.68 M triangles — one of them alone is **20× smaller and 18× lighter**
(147 k triangles), and all of them are per-structure.

> `original/` and `out/` are git-ignored — download the source meshes from the
> [Hugging Face dataset](https://huggingface.co/datasets/kush1434/awg_retina_tomography_ui)
> before running.
