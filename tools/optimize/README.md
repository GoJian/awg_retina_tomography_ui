# Mesh optimization pipeline

The source scans are very large (binary STL meshes up to ~1 GB / 21 M triangles).
These scripts decimate and Draco-compress them into the few-hundred-KB GLBs in
[`../../optimized/`](../../optimized) that ship with the app, and build the
reference eye models from their upstream CAD and OpenSim sources.

## Setup

```bash
npm install -g @gltf-transform/cli@4.0.0   # pinned; provides `gltf-transform`
npm install                                # @gltf-transform/core for the STL converter
```

The pin matters: the CLI bundles its own meshoptimizer build, and an unpinned
one will not reproduce the shipped assets or the reduction figures in the
results table below. `4.0.0` is the version those assets were built with.

Rebuilding the reference eye models (`./anatomy/build-anatomy.sh`) additionally
needs `git` and the python3 packages in
[`anatomy/requirements.txt`](anatomy/requirements.txt) — `gmsh` and `trimesh`
pinned, plus `numpy`, `networkx` and `scipy` (trimesh's mesh processing and
winding repair) and `pillow` (trimesh builds a placeholder texture for the
Upatras OBJs, which carry UV coordinates):

```bash
python3 -m pip install -r anatomy/requirements.txt
```

On Linux the `gmsh` wheel links against system GL and X11 libraries that
minimal and container images often lack (`import gmsh` then fails with
`libGLU.so.1: cannot open shared object file`). On Ubuntu (checked on 24.04):

```bash
sudo apt-get install libglu1-mesa libgl1 libxft2 libxinerama1 libxcursor1 libgomp1
```

`gmsh` 4.15.2 has Linux wheels for x86_64 only; on Linux arm64, install gmsh
from your distribution or build it from source.

## Segmented STL layers

`optimize.sh` runs: **STL → GLB → weld → simplify → Draco**.

`./optimize.sh <input.stl> <output.glb> [target_ratio] [max_error]` —
`target_ratio` is the fraction of triangles to keep (default `0.05`) and
`max_error` the simplification error cap as a fraction of mesh size (default
`0.004`). The shipped assets were built with the ratios below and the default
error.

```bash
# 1 GB / 21M-triangle eye shell -> ~320k triangles (~0.6 MB)
./optimize.sh original/eye.stl     ../../optimized/sample_1_seg_mesh/eye.glb     0.015
# 149 MB / 3.1M-triangle feature   -> ~190k triangles (~0.3 MB)
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
a Draco glTF with one named node per structure.

Usage is `./anatomy/build-anatomy.sh [work_dir] [model ...]`; `work_dir` defaults
to `anatomy/work`, and the model ids are `mesheye`, `humaneye` and `upat`,
producing `eye-anatomy.glb`, `human-eye-cad.glb` and `upat-oculomotor.glb`
respectively. To rebuild just one, into a local scratch directory:
`./anatomy/build-anatomy.sh work upat`.

See [`../../optimized/anatomy/README.md`](../../optimized/anatomy/README.md) for
provenance, per-model structure tables, and the upstream licences that cover the
output.

## Results

The optimized sizes are what `node ../bench/bench.mjs` prints (KB = 1024 bytes).

| Asset             | Original | Optimized | Reduction |
|-------------------|---------:|----------:|----------:|
| `eye.stl`         | 1008 MB  | 633 KB    | ~1631×    |
| `feature.stl`     | 149 MB   | 325 KB    | ~471×     |
| `eye-anatomy.glb`     | 3.5 MB¹ | 343 KB  | ~10×  |
| `human-eye-cad.glb`   | 3.6 MB¹ | 352 KB  | ~10×  |
| `upat-oculomotor.glb` | 0.17 MB¹| 30 KB   | ~5.5× |

¹ Raw glTF from the tessellated source. Together the three models are 725 KB.
They replaced a single 137 MB texture-dominated artist model that optimized to
7.2 MB / 2.68 M triangles — one of them alone is **~21× smaller and ~18× lighter**
(147 k triangles), and all of them are per-structure.

> `original/` and `out/` are git-ignored — download the source meshes from the
> [Hugging Face dataset](https://huggingface.co/datasets/kush1434/awg_retina_tomography_ui)
> before running; [`../bench/README.md`](../bench/README.md#getting-the-source-meshes)
> has the fetch commands.
