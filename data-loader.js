// ============================================================================
//  data-loader.js — loads & parses the dataset manifest (CSV) from Hugging Face
//  and exposes a clean, typed data model for the viewer to consume. The same
//  parser also builds sample records from files the user picks or drops
//  (samplesFromFiles), so a manifest URL, a manifest file and a bare set of
//  meshes all arrive in the viewer in one shape.
// ============================================================================

// Location of the dataset manifest. Can be overridden via ?dataset=<url>.
const DEFAULT_CSV_URL =
  'https://huggingface.co/datasets/kush1434/awg_retina_tomography_ui/resolve/main/retina_tomography_ui%20dataset.csv';

/** Shared, reactive data structure consumed by the viewer. */
export const samplesData = { samples: [] };

// A curated, perceptually-spaced palette for auto-assigning structure colors.
const COLOR_PALETTE = [
  0x4dd0e1, 0x7e9cff, 0xff8a65, 0xba68c8,
  0xffd54f, 0x4db6ac, 0xef5350, 0x64b5f6,
  0x81c784, 0xffb74d, 0x90a4ae, 0xf06292,
];
let colorIndex = 0;
function nextColor() {
  return COLOR_PALETTE[colorIndex++ % COLOR_PALETTE.length];
}

/**
 * Parse a single CSV line, honouring double-quoted fields that may contain
 * commas. Good enough for this manifest (no embedded newlines expected).
 * @param {string} line
 * @returns {string[]}
 */
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Infer the renderable type from a file URL. */
export function fileKind(url = '') {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.glb') || clean.endsWith('.gltf')) return 'gltf';
  if (clean.endsWith('.stl')) return 'stl';
  return 'stl';
}

/** The file extensions the viewer renders, lower-case, with the dot. */
export const MESH_EXTENSIONS = ['.glb', '.gltf', '.stl'];

/** Whether a file name or URL carries an extension the viewer renders. */
export function isMeshFile(name = '') {
  const clean = String(name).split('?')[0].toLowerCase();
  return MESH_EXTENSIONS.some((ext) => clean.endsWith(ext));
}

/** The last path segment of a file name, path or URL, without any query. */
export function baseName(name = '') {
  return String(name).split('?')[0].split(/[\\/]/).pop();
}

/** A display label from a file name: `retina_inner-v2.glb` → `Retina inner v2`. */
export function labelFromFileName(name = '') {
  const base = baseName(name).replace(/\.[^.]+$/, '');
  const words = base.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : base;
}

/**
 * Load and parse the dataset manifest.
 * @param {string} [csvUrl]
 * @returns {Promise<typeof samplesData>}
 */
/**
 * Fetch the manifest, retrying on failure.
 *
 * Hugging Face's edge answers the *first*, cold request for the manifest path
 * with `405 Method Not Allowed` instead of following its own redirect, and only
 * serves the file on a retry — reproducibly, on a fresh browser profile, for
 * both `fetch(url)` and `fetch(url, {mode:'cors'})`. Without this every new
 * visitor lands on an empty layer tree; the second attempt essentially always
 * succeeds.
 */
async function fetchManifest(url, tries = 4) {
  let lastStatus = 0, lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (res.ok) return res;
      lastStatus = res.status;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200 * 2 ** i));
  }
  throw new Error(lastStatus
    ? `Could not load dataset manifest (HTTP ${lastStatus}).`
    : `Could not load dataset manifest. ${lastErr?.message || ''}`.trim());
}

export async function loadCSVData(csvUrl) {
  const url = csvUrl || new URLSearchParams(location.search).get('dataset') || DEFAULT_CSV_URL;

  const res = await fetchManifest(url);
  const text = await res.text();

  samplesData.samples = parseManifest(text);
  if (new URLSearchParams(location.search).get('demo') !== 'off') addDemoSample();
  return samplesData;
}

/**
 * Parse the text of a CSV manifest into sample records. Pure: no fetch, no
 * `location`, nothing written to `samplesData` — loadCSVData and the file
 * import both build on it. Header names are matched case-insensitively and
 * column order does not matter; a row missing `sample_name`, `file_name` or
 * `seg_mesh_link` is skipped.
 * @param {string} text
 * @returns {object[]} samples, in first-seen order
 * @throws {Error} when the manifest has no data rows
 */
export function parseManifest(text) {
  const lines = String(text).replace(/\r/g, '').trim().split('\n').filter((l) => l.trim());
  if (lines.length < 2) throw new Error('Dataset manifest is empty.');

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name) => headers.indexOf(name);
  const iSample = col('sample_name');
  const iSampleLink = col('sample_link');
  const iFile = col('file_name');
  const iLabel = col('seg_mesh_label');
  const iLink = col('seg_mesh_link');
  const iNotes = col('notes');

  const byName = new Map();
  colorIndex = 0;

  for (let i = 1; i < lines.length; i++) {
    const v = parseCSVLine(lines[i]);
    const sampleName = v[iSample];
    const fileName = v[iFile];
    const link = v[iLink];
    if (!sampleName || !fileName || !link) continue; // skip malformed rows

    if (!byName.has(sampleName)) {
      byName.set(sampleName, {
        id: sampleName.toLowerCase().replace(/\s+/g, '_'),
        label: sampleName,
        link: iSampleLink >= 0 ? v[iSampleLink] : '',
        offset: { x: 0, y: 0, z: 0 },   // per-sample position in the overlay workspace
        opacity: 1,                     // whole-sample opacity multiplier
        structures: [],
      });
    }
    const sample = byName.get(sampleName);
    sample.structures.push({
      id: `${sample.id}__${fileName}`,
      sampleId: sample.id,
      label: (iLabel >= 0 && v[iLabel]) ? v[iLabel] : fileName,
      path: link,
      kind: fileKind(link),
      notes: iNotes >= 0 ? v[iNotes] : '',
      color: nextColor(),
      opacity: 1.0,       // structures render as solid volumes by default (X-ray toggle to see inside)
      bytes: null,        // filled in asynchronously by probeSizes()
    });
  }

  return [...byName.values()];
}

/**
 * Build sample records from files the user picked or dropped — the seamless
 * import path, which needs no manifest to be written first. Two shapes are
 * accepted:
 *
 *   - **meshes only** (`.glb`, `.gltf`, binary `.stl`): one sample, labelled
 *     `Imported` (then `Imported 2`, …), holding one structure per file, each
 *     labelled from its file name;
 *   - **a CSV manifest plus its meshes**: the manifest's own samples and rows,
 *     each `seg_mesh_link` matched to a supplied file by base name. A link that
 *     matches nothing but is an `http(s)` URL is kept and fetched as usual; any
 *     other unmatched link is skipped and reported. Files the manifest does not
 *     name are ignored.
 *
 * Every structure that resolved to a file gets `path: 'local:<file name>'`,
 * `bytes` from the file, `local: true`, and is pre-resolved so no size probe
 * runs. Serve those paths through `createLocalIo()` (app/local-files.js) and
 * hand the samples to the layer controller as usual. Nothing is uploaded.
 *
 * @param {Iterable<{name: string, size?: number, text?: () => Promise<string>}>} fileList
 *   File objects, or anything with a name, a size and (for a manifest) text().
 * @param {{ existing?: Array<{id: string, imported?: boolean}> }} [opts]
 *   `existing` is the samples already shown, so ids and labels stay unique.
 * @returns {Promise<{ samples: object[], files: Map<string, object>, skipped: string[] }>}
 *   `files` maps each `local:` path to its file; `skipped` lists what could not be used.
 * @throws {Error} when no mesh file and no manifest were supplied
 */
export async function samplesFromFiles(fileList, { existing = [] } = {}) {
  const files = [...(fileList || [])];
  const meshes = files.filter((f) => isMeshFile(f.name));
  const manifests = files.filter((f) => /\.csv$/i.test(baseName(f.name)));
  const skipped = files.filter((f) => !isMeshFile(f.name) && !/\.csv$/i.test(baseName(f.name))).map((f) => baseName(f.name));
  if (!meshes.length && !manifests.length) {
    throw new Error('No mesh files (.glb, .gltf, .stl) or CSV manifest were provided.');
  }

  const byBase = new Map(meshes.map((f) => [baseName(f.name).toLowerCase(), f]));
  const localFiles = new Map();
  const taken = new Set(existing.map((s) => s.id));
  const uniqueId = (base) => { let id = base, n = 2; while (taken.has(id)) id = `${base}_${n++}`; taken.add(id); return id; };
  const attach = (st, file) => {
    const path = `local:${baseName(file.name)}`;
    localFiles.set(path, file);
    return Object.assign(st, { path, kind: fileKind(file.name), bytes: file.size || null, local: true, _resolved: true });
  };

  let samples;
  if (manifests.length) {
    samples = parseManifest(await manifests[0].text());
    for (const sample of samples) {
      const oldId = sample.id;
      sample.id = uniqueId(oldId);
      sample.imported = true;
      sample.structures = sample.structures.filter((st) => {
        st.sampleId = sample.id;
        st.id = `${sample.id}__${st.id.slice(oldId.length + 2)}`;
        const file = byBase.get(baseName(st.path).toLowerCase());
        if (file) { attach(st, file); return true; }
        if (/^https?:\/\//i.test(st.path)) return true;   // a remote mesh the manifest points at
        skipped.push(st.path);
        return false;
      });
    }
    samples = samples.filter((s) => s.structures.length);
    if (!samples.length) throw new Error('The manifest names no mesh that was provided or reachable.');
  } else {
    const n = existing.filter((s) => s.imported).length;
    const label = n ? `Imported ${n + 1}` : 'Imported';
    const id = uniqueId(label.toLowerCase().replace(/\s+/g, '_'));
    const sample = { id, label, link: '', offset: { x: 0, y: 0, z: 0 }, opacity: 1, imported: true, structures: [] };
    for (const file of meshes) {
      sample.structures.push(attach({
        id: `${id}__${baseName(file.name)}`, sampleId: id, label: labelFromFileName(file.name),
        path: '', kind: 'stl', notes: '', color: nextColor(), opacity: 1.0, bytes: null,
      }, file));
    }
    samples = [sample];
  }
  return { samples, files: localFiles, skipped };
}

// A palette used to re-colour demo samples so they stand out when overlaid.
const DEMO_PALETTES = [
  [0xff6ec7, 0xffd166, 0x9b8cff, 0x4dd0e1],
  [0xff8a5c, 0x6ee7a8, 0xf25c8a, 0x8ecbff],
];

/**
 * Append a synthetic duplicate of the first sample so multi-sample overlay is
 * demonstrable while the dataset has only one real sample. Reuses the same
 * (cached) meshes, re-coloured and offset. Disable with ?demo=off.
 */
function addDemoSample() {
  const base = samplesData.samples[0];
  if (!base || samplesData.samples.length > 1) return;
  const pal = DEMO_PALETTES[0];
  const demo = {
    id: `${base.id}_demo`,
    label: `${base.label} · copy`,
    link: base.link,
    demo: true,
    offset: { x: 0.4, y: 0, z: 0 },   // sits beside the original by default
    opacity: 1,
    structures: base.structures.map((s, i) => ({
      ...s,
      id: `${s.id}_demo`,
      sampleId: `${base.id}_demo`,
      color: pal[i % pal.length],
      _resolved: false,
      _resolving: null,
    })),
  };
  samplesData.samples.push(demo);
}

/**
 * Derive the path of an optimized (decimated + Draco) copy of an STL asset.
 * Optimized GLBs ship with the app under `optimized/<relative-path>.glb`
 * (same-origin → fast, no CORS), mirroring the dataset's folder layout.
 * Returns null when the source is not an STL we know how to optimize.
 *
 * Note: the F10 ocular coats (already .glb) intentionally load their original
 * remote meshes here; the "Solid fill" toggle swaps in the local solid-fill
 * variant (see solidVariant in viewer.js) only when the user turns it on.
 */
export function deriveOptimizedURL(url = '') {
  if (!/\.stl(\?|$)/i.test(url)) return null;
  // Take the path after Hugging Face's `/resolve/<rev>/`, or the bare path.
  const m = url.match(/\/resolve\/[^/]+\/(.+)$/);
  const rel = (m ? m[1] : url.replace(/^https?:\/\/[^/]+\//, '')).split('?')[0];
  return `optimized/${rel.replace(/\.stl$/i, '.glb')}`;
}

async function headSize(url) {
  const res = await fetch(url, { method: 'HEAD', mode: 'cors' });
  if (!res.ok) return null;
  const len = Number(res.headers.get('content-length'));
  return Number.isFinite(len) && len > 0 ? len : 0;
}

/**
 * Resolve a single structure: prefer an optimized GLB if one has been
 * published, otherwise keep the original — and learn its byte size. Idempotent
 * (safe to call repeatedly); the result is memoised on the structure.
 * @returns {Promise<object>} the (mutated) structure.
 */
export async function resolveStructure(st) {
  if (st._resolved) return st;
  st._resolving ??= (async () => {
    const optURL = deriveOptimizedURL(st.path);
    if (optURL) {
      try {
        const optLen = await headSize(optURL);
        if (optLen !== null) {
          st.path = optURL; st.kind = 'gltf'; st.optimized = true;
          if (optLen) st.bytes = optLen;
          st._resolved = true;
          return st;
        }
      } catch { /* optimized copy not published — fall back */ }
    }
    try { const len = await headSize(st.path); if (len) st.bytes = len; }
    catch { /* size is a nice-to-have */ }
    st._resolved = true;
    return st;
  })();
  return st._resolving;
}

/**
 * Resolve every structure (optimized-vs-original + size) so the UI can show how
 * heavy a layer is before it is downloaded. All best-effort.
 * @param {(structure: object) => void} onResolved called as each one resolves.
 */
export async function probeSizes(onResolved) {
  const all = samplesData.samples.flatMap((s) => s.structures);
  await Promise.allSettled(all.map((st) => resolveStructure(st).then(onResolved)));
}

/** Human-readable byte size, e.g. 1.06 GB. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / 1024 ** i;
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(val >= 10 ? 1 : 2)} ${units[i]}`;
}
