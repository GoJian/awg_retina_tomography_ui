# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Dates are UTC.

## [Unreleased]

### Security

- **Manifest and file-name text is no longer parsed as HTML.** Sample names,
  layer labels and the manifest error reached `innerHTML` unescaped in the
  layer rail, the study menu and the heavy-download confirm, so a shared
  `?dataset=` link (or an imported file's name) could run script on the app's
  origin through an `<img onerror>` payload. They are now set as text on
  elements built node by node (`app/ui/layer-panel.js`, `app/ui/chrome.js`).
  A manifest's `sample_link` becomes the source link only when it resolves to
  `http(s)`, so a `javascript:` or `data:` URL is dropped, and `focusSample`
  no longer splices a sample id into a CSS selector.

### Added

- 9 unit tests and 1 browser test for the fix above (549 and 21 in all). The
  test fake DOM now logs every `innerHTML` write so a test can assert that
  untrusted text never reached it, and its `append()` takes strings as the
  DOM's does. The browser test loads `test/e2e/fixtures/xss-manifest.csv`, a
  same-origin manifest whose names are `<img onerror>` payloads, and imports a
  file named like one.

### Changed

- The About dialog lists both authors, with the affiliations the paper gives.
- `tools/bench` reports `First visit` (the app shell alone) and `Load model`
  (the shell plus the default anatomy) instead of a `First paint` line that
  counted the anatomy, which a first visit does not download until **Load
  model** is clicked. The README and `tools/bench/README.md` now say the same:
  a 212 KB shell, served gzipped at 68 KB, with 343 KB more for the default
  reference eye.

## [1.1.0] — 2026-10-03

### Added

- **Import your own data.** An **Import** button in the top bar and a
  drop target over both views take `.glb` / `.gltf` / `.stl` meshes, or a CSV
  manifest together with the meshes it names, and add them as a new sample
  beside the bundled dataset — read in memory, never uploaded, every layer
  switched on at once. The same dialog loads a hosted manifest by URL and
  writes it into the address bar as `?dataset=`, so the view can be shared.
  `data-loader.js` gains `parseManifest(text)`, `samplesFromFiles(files)`,
  `isMeshFile`, `baseName` and `labelFromFileName`; `app/local-files.js`
  (`createLocalIo`, also the package's `./local-files` subpath) serves the
  imported files through the workbench's `io`; `app/ui/import-panel.js` is the
  dialog and the drop targets; `LayerController.clear()` empties the pane
  when a dataset is replaced, and the layer panel's `activate(id)` is the
  programmatic tick.
- 33 unit tests and 2 browser tests for the import path (540 and 20 in all).

### Changed

- The software is now called **OcuLayer**; "Retina Tomography Viewer" stays
  as its descriptive subtitle. The repository name, package name and import
  paths are unchanged.
- The reference-eye menu lists only the three models it can load. The six
  open eye-modelling projects that were surveyed and ship no 3D geometry were
  shown as disabled entries; they are now recorded, with the reason each was
  rejected, in `optimized/anatomy/README.md` only. `ANATOMY_MODELS` no longer
  carries `unavailable` stubs and `modelById` / `resolveModelId` need no
  availability check.
- The JOSS paper is restructured to the journal's section set and word limit,
  and the second author's affiliation is corrected.
- Releases, the install command and the live site now come from
  `GoJian/awg_retina_tomography_ui` and
  <https://gojian.github.io/awg_retina_tomography_ui/>. 1.0.0 was tagged on the
  `kush1434` fork, before the core library was merged upstream, and its release
  stays there.

## [1.0.0] — 2026-09-15

The first release: the viewer as a core library with a thin browser app over it.

### Added

- **`core/` — a DOM-free library** (12 ES modules plus the `core/index.js`
  barrel). Scenes, cameras, framing, clipping and slice caps, camera
  synchronisation, and the layer and anatomy loading state machines, with no
  reference to `document`, `window`, `fetch` or the DOM anywhere in its module
  graph. Renderer and controls enter through injected adapters, bytes through an
  injected `io`, and every state transition leaves through an event emitter, so
  the same code drives this page, a page of your own, or a Node process with no
  browser.
- **`core/index.js`** barrel and a `package.json` `exports` map, with `./core/*`
  for the individual core modules and `./browser`, `./headless`,
  `./asset-loader` and `./data-loader` subpaths.
- **"Using the core in your own page"** in the README: a minimal working page,
  the import table, the import-map note and the record shapes `layers` accepts.
- **`app/browser-adapters.js`** — the only module that constructs a
  `WebGLRenderer` or browser `OrbitControls`.
- **`tools/bench`** — asset inventory, a first-visit size report, and a symmetric
  point-to-surface error measurement between a full-resolution scan and the
  shipped mesh, using an exact uniform spatial hash cross-checked against brute
  force in the test suite. The size report resolves the app shell by walking
  `index.html`'s module graph rather than a hard-coded list, so it cannot
  understate the shell when a module moves, and gzips it — the raw and
  over-the-wire numbers quoted in the README and the paper come from here.
- **507 unit tests** on Node's built-in runner, including a static DOM-free scan
  that follows imports so an app-layer module cannot be pulled into `core/`
  behind a file that is itself clean.
- **18 Playwright end-to-end tests** and CI running both suites plus a decode of
  every shipped asset.
- `package.json` — `engines` requiring Node >= 20, and `three` r169 as a peer
  dependency and as a devDependency so the core can be exercised headless.
- `CONTRIBUTING.md`, including support and governance expectations, a manual
  smoke test for what the automated suites cannot reach, `CODE_OF_CONDUCT.md`
  and `CITATION.cff`.

### Changed

- `viewer.js` went from 1,689 lines holding the entire application to 235 lines
  of view/controller over the core, with the DOM panels split into `app/ui/`.
- `tools/optimize/optimize.sh` now documents `@gltf-transform/cli@4.0.0` as the
  CLI version the shipped assets were built with: an unpinned CLI bundles a
  different meshoptimizer and will not reproduce them.

[Unreleased]: https://github.com/GoJian/awg_retina_tomography_ui/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/GoJian/awg_retina_tomography_ui/releases/tag/v1.1.0
[1.0.0]: https://github.com/kush1434/awg_retina_tomography_ui/releases/tag/v1.0.0
