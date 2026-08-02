# Eye anatomy model — provenance & licence

`eye-anatomy.glb` is the reference human eyeball shown in the viewer's **left**
pane. It is **not** NASA data — it is a published, citable anatomical model used
as an orientation reference beside the segmented µCT coats on the right.

## Source

Derived from **[feelpp/mesh.eye](https://github.com/feelpp/mesh.eye)** — *A 3D
geometrical model and meshing procedures for the human eyeball*, by Vincent
Chabannes, Christophe Prud'homme, Thomas Saigre, Lorenzo Sala, Marcela Szopos
and Christophe Trophime (Cemosis / IRMA UMR 7501, Université de Strasbourg,
CNRS).

- DOI: <https://doi.org/10.5281/zenodo.13829740>
- Model description: Sala L, Prud'homme C, Guidoboni G, Szopos M, Harris A.
  *The ocular mathematical virtual simulator: A validated multiscale model for
  hemodynamics and biomechanics in the human eye.*
  Int J Numer Meth Biomed Engng. 2024; 40(2):e3791.
  <https://doi.org/10.1002/cnm.3791>

## What was done to it

`Eye.step` (the STEP solid model committed to mesh.eye) was tessellated with
[gmsh](https://gmsh.info)'s OpenCASCADE kernel into one watertight triangle mesh
per anatomical volume, then packed into a single Draco-compressed glTF binary
with one named node per structure.

The ten solids follow the `MakePartition` order in mesh.eye's
`construct-eye-STP.py`:

| # | Node key      | Structure       | Triangles | Volume (mm³) |
|---|---------------|-----------------|----------:|-------------:|
| 1 | `cornea`      | Cornea          |     6,414 |       128.14 |
| 2 | `aqueous`     | Aqueous humour  |    13,344 |       150.75 |
| 3 | `iris`        | Iris            |    17,210 |       252.48 |
| 4 | `lens`        | Lens            |     2,856 |        88.31 |
| 5 | `vitreous`    | Vitreous humour |    19,862 |     4,675.78 |
| 6 | `sclera`      | Sclera          |    36,686 |     1,644.49 |
| 7 | `choroid`     | Choroid         |    25,038 |       631.67 |
| 8 | `retina`      | Retina          |    22,388 |       428.86 |
| 9 | `lamina`      | Lamina cribrosa |       278 |         0.36 |
|10 | `optic_nerve` | Optic nerve     |     2,668 |        17.53 |

Total 146,744 triangles, 352 KB. Geometry is in millimetres, centred on the
globe; the antero-posterior axis is **X** (cornea at −X, optic nerve at +X).
Each solid was verified watertight, and the tag→structure mapping was confirmed
independently against the geometry (nesting radii sclera ⊃ choroid ⊃ retina ⊃
vitreous, antero-posterior centroids, and volumes against published ocular
anatomy).

Reproduce with `tools/optimize/anatomy/build-anatomy.sh`.

## Licence

mesh.eye is licensed **GPL-3.0**, so the meshes derived from it in this
directory are also **GPL-3.0** — see [`LICENSE`](LICENSE). This is a separate
work from the viewer, which remains MIT (see the repository root
[`LICENSE`](../../LICENSE)); the two are merely aggregated, and loading this
file does not make the viewer a derivative work of it.

If you replace the anatomy model with your own, point the viewer at it with
`?anatomy=<url>` or edit `ANATOMY_URL` in `viewer.js`.
