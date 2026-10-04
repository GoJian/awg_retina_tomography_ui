---
title: 'OcuLayer: a zero-install browser viewer for segmented ocular micro-tomography'
tags:
  - JavaScript
  - WebGL
  - micro-CT
  - visualization
  - space biology
  - ophthalmology
  - open data
authors:
  - name: Kush Shah
    orcid: 0009-0007-3121-2961
    corresponding: true
    affiliation: 1
  - name: Jian Gong
    orcid: 0000-0001-7214-1628
    affiliation: 2
affiliations:
  - name: Del Norte High School, San Diego, California, USA
    index: 1
  - name: University of Wyoming, School of Computing, Laramie, Wyoming, USA
    index: 2
date: 4 October 2026
bibliography: paper.bib
---

# Summary

`OcuLayer` is a browser application for exploring segmented ocular micro-computed-tomography
(µCT) data in two linked 3D views. The left pane holds a published, citable reference eye model;
the right holds the toggleable segmented tissue layers of a scanned specimen. Orbiting one view
mirrors onto the other, so a segmented coat can be read against the anatomy it matches, and every
structure can be hidden, recoloured, faded or clipped with slice planes. It is a static site
opened from a URL — no installation, no account, no gigabyte download. Its dataset is a CSV
manifest supplied at run time, and a researcher's own meshes can be dropped onto the page and
rendered beside the bundled data without leaving the browser.

![The two panes under a shared sagittal cut, cameras linked. Left: the `mesh.eye` reference model,
ten structures each independently styled. Right: four of the five segmented µCT coats of a murine
eye, each separately streamed.\label{fig:viewer}](figure.png)

# Statement of need

Segmented µCT of the eye produces surface meshes far too large to open casually. The mouse eye
shipped here is a 1.0 GB binary STL of 21.1 million triangles, and viewing it conventionally costs
a desktop install, the full download and a machine able to hold it. That is reasonable for an
investigator who works with the data daily, and prohibitive for the researchers, reviewers and
students who need to look at it once. This matters for space biology: spaceflight-associated
neuro-ocular syndrome is among the better-documented risks of long-duration spaceflight
[@lee2020sans], so ocular tissue recurs in spaceflight and analog studies. NASA's Open Science Data
Repository publishes these data openly [@gebre2025osdr; @berrios2021genelab]. But publishing a mesh
is not the same as making it explorable: the repository hands back a file, and the barrier to
looking at it is unchanged.

# State of the field

3D Slicer [@fedorov2012slicer] and ITK-SNAP [@yushkevich2006itksnap] do more than this viewer,
including named segments, per-segment visibility, colour and opacity, and synchronised cameras. Both
are desktop installs, and Slicer's user guide advises "10x more memory than the amount of data that
you load" [@slicerdocs]. In the browser, NiiVue [@niivue; @eckstein2026niivue], Neuroglancer
[@neuroglancer] and itk-vtk-viewer [@itkvtkviewer] render meshes client-side, and all three already
bind a dataset at run time as this viewer does: NiiVue's web app and itk-vtk-viewer take mesh URLs
as `?images=` and `?fileToLoad=` respectively, and a Neuroglancer scene is a pasteable link. The
Open Anatomy Browser [@halle2017oabrowser] is closest, being zero-install, manifest-described, named
and static. We claim novelty in none of this.

What none supplies is the other half of the comparison. None of the Open Anatomy atlases is ocular,
and of six related open projects we surveyed (ISETBio [@cottaris2019isetbio], OpenRetina
[@dagostino2026openretina], V-Cornea [@vanin2025vcornea; @vanin2025vcorneacode], OpenEyeSim
[@priamikov2016openeyesim], `pulse2percept` [@beyeler2017pulse2percept] and Open Source Brain
[@gleeson2019osb]) none ships usable 3D geometry. This viewer therefore ships its own: three
published eye models with per-structure names and provenance, in a second camera-linked pane. A
multi-toggle layer panel would have been a fair contribution to itk-vtk-viewer, whose geometry panel
selects one mesh at a time. The second pane would not: itk-vtk-viewer and the Open Anatomy Browser
each build one model scene — one `vtkProxyManager`, and one model `THREE.Scene` beside an axes-only
inset scene — so a second populated scene changes a central assumption instead of extending it.
Neuroglancer and NiiVue already link cameras across panes, but neither reads glTF, the format of
this viewer's bundled meshes. Hence a small library over three.js [@threejs], not a fork.

# Software design

The site is bare ES modules behind an import map, and the deploy workflow uploads the repository
tree itself, so a reviewer reads the files the browser runs. The price of refusing a bundled build
is that `three` (r169) and the Draco decoder (1.5.7) are fetched from public CDNs and load-bearing
for the deployed viewer.

The core library cannot tell that it is running in a browser. Renderer and controls enter through
injected adapters, bytes through an injected `io`, state leaves only through an event emitter, and
a single module constructs the WebGL context. Freedom from the DOM is enforced by a denylist scan
over `core/` rather than proved. In exchange the geometry, clipping and loading logic runs under
Node in seconds.

Data reaches the viewer by one path whatever its source: the default manifest, a manifest URL typed
into the Import dialog or passed as `?dataset=`, and files dropped onto the page all become the same
sample records. Dropped meshes are served to the core through an `io` wrapper that reads them from
memory, so the core never learns that a `File` exists and nothing is uploaded. A manifest URL is
written back into the address bar, which makes a view shareable as a link; a drop is not, because
the files it names live on one machine.

Decimation answers a client cost, not a hosting one: the viewer does load a 1 GB, 21 M-triangle STL,
but reading and parsing it took about 12 s and 4.6 GB of memory, where the decimated copy loads in
under a second. A documented pipeline built on glTF Transform [@gltftransform] converts binary STL
to glTF, welds it into an indexed mesh, decimates it with the `meshoptimizer` simplifier
[@meshoptimizer] and compresses it with Draco [@draco]; layers stream on toggle into the Cache
Storage API, so each mesh downloads at most once per browser. `tools/bench` measures the cost as a
symmetric point-to-surface distance, area-weighted over both meshes and normalised by the
bounding-box diagonal:

| Mesh | Triangles | Source | Shipped | Reduction | Mean error | p99 | Area |
|---|---:|---:|---:|---:|---:|---:|---:|
| eye | 21.1 M | 1008 MB | 633 KB | 1631× | 0.017% | 0.062% | +0.63% |
| feature | 3.13 M | 149 MB | 325 KB | 471× | 0.006% | 0.024% | +0.21% |

Discarding 98.5% of `eye.stl`'s triangles moves the surface by 0.017% of the diagonal on average;
the worst-case (Hausdorff) distances, 3.99% and 1.10%, fall almost entirely in the
original-to-decimated direction, consistent with fragments removed rather than the principal surface
displaced. The result is an instrument for orientation and triage, not morphometry. A first visit
transfers a 213 KB shell, served gzipped at 69 KB; loading the default reference eye adds 343 KB,
against 1.13 GB of source meshes, with `three`, the webfonts and the Draco decoder fetched from CDNs
on top.

The left pane holds third-party published anatomy, not NASA data: `feelpp/mesh.eye`
[@chabannes2024mesheye; @sala2024ovs], the SolidWorks CAD eye it derives from, and the Upatras
OpenSim oculomotor model with its six extraocular muscles [@filip2018upat], each with one named node
per structure under its own upstream licence. Because these models are human while the segmentation
is murine, the interface states that the left pane is for orientation, not cross-species
morphometry.

# Research impact statement

The NASA GeneLab Analysis Working Group, for whom the viewer was built, has used it to load the
segmented µCT data and compare structures across it; the specimen in \autoref{fig:viewer} is that
data.

The viewer is deployed at <https://gojian.github.io/awg_retina_tomography_ui/>, and the data behind
it are open and ungated. The segmented meshes, the CSV manifest, the source reconstruction slices
and the full-resolution meshes the shipped assets were decimated from are published under MIT on
Hugging Face [@shah2025awgdata], so a reader can recompute the reduction factors and error bounds
above instead of taking them on trust. `tools/bench` uses a fixed seed, so runs are reproducible.

`optimized/anatomy/README.md` is a licence-and-geometry audit of nine entries from eight open
projects: per-structure triangle counts, volumes and upstream DOIs for the three that distribute
usable 3D eye geometry [@chabannes2024mesheye; @sala2024ovs; @filip2018upat], and a recorded check
for the six that do not. That geometry is other groups' published work, carried under its own
GPL-3.0 and CC BY 4.0 terms; MIT covers the viewer code only.

552 unit tests on Node's built-in runner cover the data and caching layers, the file import, the
geometry code behind the error figures above, and the core library, run headless under a stub
renderer with the real orbit controls on synthetic STL and uncompressed glTF. 22 Playwright tests
drive the real application in Chromium, including a file import from disk and a manifest loaded by
URL. CI runs both suites and decodes every shipped asset, so a corrupt mesh fails the build.

# AI usage disclosure

Generative AI was used in developing this software and preparing this submission: Claude
(Anthropic), accessed through Claude Code from June to October 2026, using Claude Opus 4.8
(`claude-opus-4-8`), Claude Opus 5 (`claude-opus-5`), Claude Fable 5.1 (`claude-fable-5-1`) and
Claude Opus 5.5 (`claude-opus-5-5`).

- *The application.* The first viewer (November 2025 to January 2026) was written without AI.
  From June 2026 it was rewritten with AI assistance: Claude Opus 4.8 wrote `viewer.js`,
  `asset-loader.js`, the decimation pipeline and the shipped µCT meshes; Opus 5 the anatomy-model
  build scripts; Opus 5.5 the file import.
- *Core-library refactor.* The DOM-free `core/` library was extracted from `viewer.js` with
  Claude Fable 5.1, following a written architecture plan the authors reviewed; each step was
  gated on the full test suite and verified against the unchanged end-to-end tests.
- *Tests.* The unit and Playwright suites were generated with AI assistance from the authors'
  description of the intended behaviour.
- *Benchmark tooling.* `tools/bench/` was implemented with AI assistance. Its correctness rests on
  the geometry tests, which cross-check the spatial index against brute force, and the numbers
  reported here are the tool's output, not the model's.
- *Eye-model survey.* The survey of open eye-modelling projects and the licence-and-geometry audit
  in `optimized/anatomy/README.md` were done with Claude Opus 5.
- *Documentation and paper.* The README, `CONTRIBUTING.md`, `docs/api.md`, the changelog, the
  citation file and this paper were drafted with AI assistance and edited by the authors; the
  figure was captured by an AI session driving the application. Bibliographic entries were checked
  against Crossref, arXiv and Zenodo with AI assistance and confirmed by the authors.

The authors ran the tests and benchmarks through Claude Code and checked the results, reviewed,
edited and validated all AI-assisted output, and made the core design decisions: the two-pane
linked-view concept, shipping decimated Draco assets with a documented accuracy budget, using
published open eye models as reference anatomy, and the in-browser import of a user's own data.
The authors take full responsibility for the accuracy, originality and licensing of all submitted
material.

# Acknowledgements

We thank the NASA GeneLab Analysis Working Group for access to the ocular µCT data, and the
authors of `mesh.eye` and the Upatras model for publishing their geometry openly. This work
received no external funding.

# References
