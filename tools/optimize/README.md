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

## Anatomy GLB

The left-pane reference eye is generated from
[feelpp/mesh.eye](https://github.com/feelpp/mesh.eye) rather than shipped as an
artist model, so each anatomical structure is a separate named, watertight mesh
the viewer can toggle, recolour and slice independently:

```bash
./anatomy/build-anatomy.sh
```

That clones mesh.eye, tessellates its `Eye.step` solid model with gmsh's
OpenCASCADE kernel, assembles the ten structures into one glTF with a named node
each, and Draco-compresses. See
[`../../optimized/anatomy/README.md`](../../optimized/anatomy/README.md) for
provenance, the structure table, and the GPL-3.0 licence that covers the output.

## Results

| Asset             | Original | Optimized | Reduction |
|-------------------|---------:|----------:|----------:|
| `eye.stl`         | 1008 MB  | 0.6 MB    | ~1600×    |
| `feature.stl`     | 149 MB   | 0.3 MB    | ~450×     |
| `eye-anatomy.glb` | 2.6 MB¹  | 0.35 MB   | ~7.5×     |

¹ From the tessellated `Eye.step`. This replaced a 137 MB texture-dominated
artist model that optimized to 7.2 MB / 2.68 M triangles — the current one is
**20× smaller and 18× lighter** (147 k triangles), and is per-structure.

> `original/` and `out/` are git-ignored — download the source meshes from the
> [Hugging Face dataset](https://huggingface.co/datasets/kush1434/awg_retina_tomography_ui)
> before running.
