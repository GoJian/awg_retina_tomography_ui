// ============================================================================
//  Tests for data-loader.js — manifest parsing (from a URL and from text),
//  building samples from the user's own files, optimized-asset resolution and
//  the Hugging Face cold-request retry.
// ============================================================================

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setLocation, makeFetch, importFresh, withCleanGlobals,
} from './helpers/browser-env.js';

const MANIFEST_URL = 'https://example.test/manifest.csv';

const HEADER = 'sample_name,sample_link,file_name,seg_mesh_label,seg_mesh_link,notes';
const CSV = [
  HEADER,
  'F10 mouse eye,,retina.glb,Retina,local/F10/retina.glb,inner neural retina',
  'F10 mouse eye,,sclera.glb,Sclera,local/F10/sclera.glb,outer sclera',
  'Sample 1,https://hf.test/s1,eye.stl,Primary Structure,https://hf.test/resolve/main/sample_1_seg_mesh/eye.stl,',
].join('\n');

let restore;
beforeEach(() => { restore = withCleanGlobals(); setLocation('?demo=off'); });
afterEach(() => restore());

describe('formatBytes', () => {
  test('renders each magnitude with sensible precision', async () => {
    const { formatBytes } = await importFresh('data-loader.js');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1024), '1.00 KB');
    assert.equal(formatBytes(103 * 1024), '103 KB');
    assert.equal(formatBytes(15 * 1024), '15.0 KB');
    assert.equal(formatBytes(1024 ** 3), '1.00 GB');
  });

  test('returns an empty string for non-sizes', async () => {
    const { formatBytes } = await importFresh('data-loader.js');
    for (const v of [0, -1, NaN, Infinity, null, undefined]) {
      assert.equal(formatBytes(v), '', `expected '' for ${v}`);
    }
  });
});

describe('fileKind', () => {
  test('recognises glTF containers', async () => {
    const { fileKind } = await importFresh('data-loader.js');
    assert.equal(fileKind('a/b/retina.glb'), 'gltf');
    assert.equal(fileKind('a/b/retina.GLTF'), 'gltf');
    assert.equal(fileKind('retina.glb?download=true'), 'gltf');
  });

  test('treats anything else as STL', async () => {
    const { fileKind } = await importFresh('data-loader.js');
    assert.equal(fileKind('eye.stl'), 'stl');
    assert.equal(fileKind('eye.STL'), 'stl');
    assert.equal(fileKind('mystery'), 'stl');
    assert.equal(fileKind(), 'stl');
  });
});

describe('deriveOptimizedURL', () => {
  test('maps a Hugging Face STL to its shipped GLB', async () => {
    const { deriveOptimizedURL } = await importFresh('data-loader.js');
    assert.equal(
      deriveOptimizedURL('https://hf.test/resolve/main/sample_1_seg_mesh/eye.stl'),
      'optimized/sample_1_seg_mesh/eye.glb',
    );
  });

  test('preserves nesting and strips query strings', async () => {
    const { deriveOptimizedURL } = await importFresh('data-loader.js');
    assert.equal(
      deriveOptimizedURL('https://hf.test/resolve/abc123/a/b/c.stl?download=true'),
      'optimized/a/b/c.glb',
    );
  });

  test('falls back to the bare path when there is no /resolve/ segment', async () => {
    const { deriveOptimizedURL } = await importFresh('data-loader.js');
    assert.equal(deriveOptimizedURL('https://host.test/x/y.stl'), 'optimized/x/y.glb');
  });

  test('returns null for assets that are not STL', async () => {
    const { deriveOptimizedURL } = await importFresh('data-loader.js');
    assert.equal(deriveOptimizedURL('local/F10/retina.glb'), null);
    assert.equal(deriveOptimizedURL(''), null);
    assert.equal(deriveOptimizedURL(), null);
  });
});

describe('loadCSVData', () => {
  test('groups rows into samples and keeps structure order', async () => {
    globalThis.fetch = makeFetch({ [MANIFEST_URL]: { body: CSV } });
    const { loadCSVData } = await importFresh('data-loader.js');
    const data = await loadCSVData(MANIFEST_URL);

    assert.equal(data.samples.length, 2);
    const [f10, s1] = data.samples;
    assert.equal(f10.label, 'F10 mouse eye');
    assert.equal(f10.id, 'f10_mouse_eye', 'ids are slugified');
    assert.deepEqual(f10.structures.map((s) => s.label), ['Retina', 'Sclera']);
    assert.equal(s1.link, 'https://hf.test/s1');
    assert.equal(s1.structures[0].kind, 'stl');
    assert.equal(f10.structures[0].kind, 'gltf');
  });

  test('assigns every structure a distinct id and a colour', async () => {
    globalThis.fetch = makeFetch({ [MANIFEST_URL]: { body: CSV } });
    const { loadCSVData } = await importFresh('data-loader.js');
    const data = await loadCSVData(MANIFEST_URL);
    const all = data.samples.flatMap((s) => s.structures);

    assert.equal(new Set(all.map((s) => s.id)).size, all.length);
    for (const s of all) {
      assert.ok(Number.isInteger(s.color), `${s.label} has no colour`);
      assert.equal(s.opacity, 1.0);
      assert.equal(s.bytes, null, 'sizes are probed later, not at parse time');
    }
  });

  test('honours quoted fields containing commas', async () => {
    const csv = [
      HEADER,
      'S,,a.glb,"Retina, inner",local/a.glb,"edge-detected, thresholded"',
    ].join('\n');
    globalThis.fetch = makeFetch({ [MANIFEST_URL]: { body: csv } });
    const { loadCSVData } = await importFresh('data-loader.js');
    const { samples } = await loadCSVData(MANIFEST_URL);

    assert.equal(samples[0].structures[0].label, 'Retina, inner');
    assert.equal(samples[0].structures[0].notes, 'edge-detected, thresholded');
  });

  test('unescapes doubled quotes inside a quoted field', async () => {
    const csv = [HEADER, 'S,,a.glb,"the ""outer"" coat",local/a.glb,'].join('\n');
    globalThis.fetch = makeFetch({ [MANIFEST_URL]: { body: csv } });
    const { loadCSVData } = await importFresh('data-loader.js');
    const { samples } = await loadCSVData(MANIFEST_URL);
    assert.equal(samples[0].structures[0].label, 'the "outer" coat');
  });

  test('skips malformed rows rather than failing the whole manifest', async () => {
    const csv = [
      HEADER,
      ',,orphan.glb,No sample,local/a.glb,',   // no sample_name
      'S,,,No file,local/b.glb,',              // no file_name
      'S,,c.glb,No link,,',                    // no seg_mesh_link
      'S,,d.glb,Good,local/d.glb,',            // valid
    ].join('\n');
    globalThis.fetch = makeFetch({ [MANIFEST_URL]: { body: csv } });
    const { loadCSVData } = await importFresh('data-loader.js');
    const { samples } = await loadCSVData(MANIFEST_URL);

    assert.equal(samples.length, 1);
    assert.deepEqual(samples[0].structures.map((s) => s.label), ['Good']);
  });

  test('falls back to the file name when no label column value is present', async () => {
    const csv = [HEADER, 'S,,retina.glb,,local/a.glb,'].join('\n');
    globalThis.fetch = makeFetch({ [MANIFEST_URL]: { body: csv } });
    const { loadCSVData } = await importFresh('data-loader.js');
    const { samples } = await loadCSVData(MANIFEST_URL);
    assert.equal(samples[0].structures[0].label, 'retina.glb');
  });

  test('tolerates CRLF line endings and a trailing blank line', async () => {
    const csv = `${HEADER}\r\nS,,a.glb,Retina,local/a.glb,\r\n\r\n`;
    globalThis.fetch = makeFetch({ [MANIFEST_URL]: { body: csv } });
    const { loadCSVData } = await importFresh('data-loader.js');
    const { samples } = await loadCSVData(MANIFEST_URL);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].structures.length, 1);
  });

  test('rejects a manifest with no data rows', async () => {
    globalThis.fetch = makeFetch({ [MANIFEST_URL]: { body: HEADER } });
    const { loadCSVData } = await importFresh('data-loader.js');
    await assert.rejects(() => loadCSVData(MANIFEST_URL), /empty/i);
  });

  test('reads the manifest URL from the ?dataset= parameter', async () => {
    const custom = 'https://elsewhere.test/other.csv';
    setLocation(`?demo=off&dataset=${encodeURIComponent(custom)}`);
    const fetchStub = makeFetch({ [custom]: { body: CSV } });
    globalThis.fetch = fetchStub;
    const { loadCSVData } = await importFresh('data-loader.js');
    await loadCSVData();
    assert.equal(fetchStub.calls[0].url, custom);
  });

  test('appends a demo copy when the manifest holds a single sample', async () => {
    const oneSample = [
      HEADER,
      'F10 mouse eye,,retina.glb,Retina,local/F10/retina.glb,',
      'F10 mouse eye,,sclera.glb,Sclera,local/F10/sclera.glb,',
    ].join('\n');
    setLocation('');
    globalThis.fetch = makeFetch({ [MANIFEST_URL]: { body: oneSample } });
    const { loadCSVData } = await importFresh('data-loader.js');
    const { samples } = await loadCSVData(MANIFEST_URL);

    const demo = samples.find((s) => s.demo);
    assert.ok(demo, 'a demo copy should be present by default');
    assert.equal(demo.id, 'f10_mouse_eye_demo');
    assert.notEqual(demo.offset.x, 0, 'the copy is offset so it does not overlap');
    assert.equal(demo.structures.length, samples[0].structures.length);
    assert.equal(demo.structures[0].sampleId, demo.id);
    assert.notEqual(demo.structures[0].color, samples[0].structures[0].color,
      'the copy is recoloured so the two are distinguishable when overlaid');
  });

  test('does not add a demo copy when the manifest already has several samples', async () => {
    setLocation('');
    globalThis.fetch = makeFetch({ [MANIFEST_URL]: { body: CSV } });
    const { loadCSVData } = await importFresh('data-loader.js');
    const { samples } = await loadCSVData(MANIFEST_URL);
    assert.equal(samples.length, 2);
    assert.ok(!samples.some((s) => s.demo));
  });

  test('?demo=off suppresses the demo copy', async () => {
    const oneSample = [HEADER, 'F10 mouse eye,,retina.glb,Retina,local/F10/retina.glb,'].join('\n');
    setLocation('?demo=off');
    globalThis.fetch = makeFetch({ [MANIFEST_URL]: { body: oneSample } });
    const { loadCSVData } = await importFresh('data-loader.js');
    const { samples } = await loadCSVData(MANIFEST_URL);
    assert.equal(samples.length, 1);
  });
});

describe('fetchManifest retry', () => {
  test('recovers from the Hugging Face cold-start 405', async () => {
    let n = 0;
    const fetchStub = makeFetch({
      [MANIFEST_URL]: () => (++n < 3
        ? { status: 405, statusText: 'Method Not Allowed' }
        : { body: CSV }),
    });
    globalThis.fetch = fetchStub;
    const { loadCSVData } = await importFresh('data-loader.js');
    const { samples } = await loadCSVData(MANIFEST_URL);

    assert.equal(n, 3, 'should have retried twice before succeeding');
    assert.equal(samples.length, 2);
  });

  test('retries network errors too', async () => {
    let n = 0;
    globalThis.fetch = makeFetch({
      [MANIFEST_URL]: () => (++n < 2 ? new TypeError('Failed to fetch') : { body: CSV }),
    });
    const { loadCSVData } = await importFresh('data-loader.js');
    const { samples } = await loadCSVData(MANIFEST_URL);
    assert.equal(n, 2);
    assert.equal(samples.length, 2);
  });

  test('gives up after four attempts and reports the status', async () => {
    let n = 0;
    globalThis.fetch = makeFetch({
      [MANIFEST_URL]: () => { n++; return { status: 500, statusText: 'Server Error' }; },
    });
    const { loadCSVData } = await importFresh('data-loader.js');
    await assert.rejects(() => loadCSVData(MANIFEST_URL), /HTTP 500/);
    assert.equal(n, 4);
  });
});

describe('resolveStructure', () => {
  const stlPath = 'https://hf.test/resolve/main/sample_1_seg_mesh/eye.stl';

  test('swaps in the optimized GLB when one is published', async () => {
    globalThis.fetch = makeFetch({
      'optimized/sample_1_seg_mesh/eye.glb': { headers: { 'content-length': '622000' } },
    });
    const { resolveStructure } = await importFresh('data-loader.js');
    const st = { path: stlPath, kind: 'stl' };
    await resolveStructure(st);

    assert.equal(st.path, 'optimized/sample_1_seg_mesh/eye.glb');
    assert.equal(st.kind, 'gltf');
    assert.equal(st.optimized, true);
    assert.equal(st.bytes, 622000);
  });

  test('keeps the original when no optimized copy exists', async () => {
    globalThis.fetch = makeFetch({ [stlPath]: { headers: { 'content-length': '1073741824' } } });
    const { resolveStructure } = await importFresh('data-loader.js');
    const st = { path: stlPath, kind: 'stl' };
    await resolveStructure(st);

    assert.equal(st.path, stlPath, 'falls back to the Hugging Face original');
    assert.equal(st.kind, 'stl');
    assert.notEqual(st.optimized, true);
    assert.equal(st.bytes, 1073741824);
  });

  test('still resolves when the size probe fails', async () => {
    globalThis.fetch = makeFetch({ [stlPath]: new TypeError('network down') });
    const { resolveStructure } = await importFresh('data-loader.js');
    const st = { path: stlPath, kind: 'stl' };
    await resolveStructure(st);
    assert.equal(st._resolved, true);
  });

  test('is idempotent and probes the network only once', async () => {
    const fetchStub = makeFetch({
      'optimized/sample_1_seg_mesh/eye.glb': { headers: { 'content-length': '10' } },
    });
    globalThis.fetch = fetchStub;
    const { resolveStructure } = await importFresh('data-loader.js');
    const st = { path: stlPath, kind: 'stl' };

    await Promise.all([resolveStructure(st), resolveStructure(st)]);
    await resolveStructure(st);
    assert.equal(fetchStub.calls.length, 1);
  });

  test('uses HEAD so that probing never downloads the mesh', async () => {
    const fetchStub = makeFetch({
      'optimized/sample_1_seg_mesh/eye.glb': { headers: { 'content-length': '10' } },
    });
    globalThis.fetch = fetchStub;
    const { resolveStructure } = await importFresh('data-loader.js');
    await resolveStructure({ path: stlPath, kind: 'stl' });
    assert.equal(fetchStub.calls[0].init.method, 'HEAD');
  });
});

describe('probeSizes', () => {
  test('resolves every structure and reports each one', async () => {
    globalThis.fetch = makeFetch({
      [MANIFEST_URL]: { body: CSV },
      'local/': { headers: { 'content-length': '103424' } },
      'optimized/': { headers: { 'content-length': '622000' } },
    });
    const { loadCSVData, probeSizes } = await importFresh('data-loader.js');
    const data = await loadCSVData(MANIFEST_URL);

    const seen = [];
    await probeSizes((st) => seen.push(st));

    const total = data.samples.flatMap((s) => s.structures).length;
    assert.equal(seen.length, total);
    assert.ok(seen.every((s) => s._resolved));
  });

  test('one failing probe does not abort the others', async () => {
    globalThis.fetch = makeFetch({
      [MANIFEST_URL]: { body: CSV },
      'local/F10/retina.glb': new TypeError('boom'),
      'local/': { headers: { 'content-length': '1000' } },
      'optimized/': { headers: { 'content-length': '2000' } },
    });
    const { loadCSVData, probeSizes } = await importFresh('data-loader.js');
    const data = await loadCSVData(MANIFEST_URL);
    await probeSizes(() => {});
    assert.ok(data.samples.flatMap((s) => s.structures).every((s) => s._resolved));
  });
});

// ---------------------------------------------------------------------------
//  parseManifest — the pure parser under loadCSVData and the file import
// ---------------------------------------------------------------------------
describe('parseManifest', () => {
  test('parses text into the same records loadCSVData produces, without touching samplesData', async () => {
    const { parseManifest, samplesData } = await importFresh('data-loader.js');
    const samples = parseManifest(CSV);
    assert.equal(samples.length, 2);
    assert.equal(samples[0].id, 'f10_mouse_eye');
    assert.deepEqual(samples[0].structures.map((s) => s.id), ['f10_mouse_eye__retina.glb', 'f10_mouse_eye__sclera.glb']);
    assert.equal(samples[1].structures[0].kind, 'stl');
    assert.deepEqual(samplesData.samples, [], 'the shared model is not written');
  });

  test('rejects a header-only manifest with the same error as loadCSVData', async () => {
    const { parseManifest } = await importFresh('data-loader.js');
    assert.throws(() => parseManifest(HEADER), /empty/i);
    assert.throws(() => parseManifest(''), /empty/i);
  });
});

// ---------------------------------------------------------------------------
//  File-name helpers
// ---------------------------------------------------------------------------
describe('isMeshFile / baseName / labelFromFileName', () => {
  test('isMeshFile accepts the three renderable extensions, any case, with or without a query', async () => {
    const { isMeshFile, MESH_EXTENSIONS } = await importFresh('data-loader.js');
    assert.deepEqual(MESH_EXTENSIONS, ['.glb', '.gltf', '.stl']);
    for (const n of ['a.glb', 'A.GLB', 'dir/b.gltf', 'c.stl?download=1']) assert.equal(isMeshFile(n), true, n);
    for (const n of ['manifest.csv', 'notes.txt', 'mesh.obj', 'glb', '', undefined]) assert.equal(isMeshFile(n), false, String(n));
  });

  test('baseName strips directories, both slashes, and the query', async () => {
    const { baseName } = await importFresh('data-loader.js');
    assert.equal(baseName('https://h/resolve/main/F10_layers/retina.glb?download=true'), 'retina.glb');
    assert.equal(baseName('C:\\scans\\eye.stl'), 'eye.stl');
    assert.equal(baseName('retina.glb'), 'retina.glb');
  });

  test('labelFromFileName makes a readable label from a file name', async () => {
    const { labelFromFileName } = await importFresh('data-loader.js');
    assert.equal(labelFromFileName('retina.glb'), 'Retina');
    assert.equal(labelFromFileName('scans/retina_inner-v2.glb'), 'Retina inner v2');
    assert.equal(labelFromFileName('RPE.stl'), 'RPE');
    assert.equal(labelFromFileName('optic.nerve.head.gltf'), 'Optic nerve head');
  });
});

// ---------------------------------------------------------------------------
//  samplesFromFiles — the user's own data
// ---------------------------------------------------------------------------
const file = (name, size = 10, text = '') => ({ name, size, async text() { return text; } });

describe('samplesFromFiles', () => {
  test('meshes alone become one "Imported" sample, one local, pre-resolved structure per file', async () => {
    const { samplesFromFiles } = await importFresh('data-loader.js');
    const retina = file('retina.glb', 1234), sclera = file('outer_sclera.stl', 99);
    const { samples, files, skipped } = await samplesFromFiles([retina, sclera, file('readme.txt')]);

    assert.equal(samples.length, 1);
    const [s] = samples;
    assert.equal(s.id, 'imported');
    assert.equal(s.label, 'Imported');
    assert.equal(s.imported, true);
    assert.deepEqual(s.offset, { x: 0, y: 0, z: 0 });
    assert.equal(s.opacity, 1);
    assert.deepEqual(s.structures.map((st) => [st.id, st.label, st.path, st.kind, st.bytes, st.local, st._resolved, st.sampleId]), [
      ['imported__retina.glb', 'Retina', 'local:retina.glb', 'gltf', 1234, true, true, 'imported'],
      ['imported__outer_sclera.stl', 'Outer sclera', 'local:outer_sclera.stl', 'stl', 99, true, true, 'imported'],
    ]);
    assert.notEqual(s.structures[0].color, s.structures[1].color);
    assert.equal(s.structures[0].opacity, 1);
    assert.deepEqual([...files.entries()], [['local:retina.glb', retina], ['local:outer_sclera.stl', sclera]]);
    assert.deepEqual(skipped, ['readme.txt']);
  });

  test('a second import gets a distinct id and label, avoiding whatever is already shown', async () => {
    const { samplesFromFiles } = await importFresh('data-loader.js');
    const first = (await samplesFromFiles([file('a.glb')])).samples;
    const existing = [{ id: 'f10_mouse_eye' }, ...first];
    const second = (await samplesFromFiles([file('a.glb')], { existing })).samples;
    assert.equal(second[0].id, 'imported_2');
    assert.equal(second[0].label, 'Imported 2');
    assert.equal(second[0].structures[0].id, 'imported_2__a.glb');
    // Even when an unrelated sample already holds the slug, the id stays unique.
    const clash = (await samplesFromFiles([file('a.glb')], { existing: [{ id: 'imported' }] })).samples;
    assert.equal(clash[0].id, 'imported_2');
  });

  test('a manifest plus its meshes: rows matched to files by base name, remote links kept, the rest skipped', async () => {
    const { samplesFromFiles } = await importFresh('data-loader.js');
    const csv = [
      HEADER,
      'My eye,https://example.test/src,retina.glb,Retina,/somewhere/on/disk/Retina.GLB,',
      'My eye,,sclera.stl,,sclera.stl,',
      'My eye,,choroid.glb,Choroid,https://cdn.test/choroid.glb,',
      'My eye,,vitreous.glb,Vitreous,vitreous.glb,',
    ].join('\n');
    const retina = file('retina.glb', 500), sclera = file('sclera.stl', 700), extra = file('unreferenced.glb');
    const { samples, files, skipped } = await samplesFromFiles([file('layers.csv', 1, csv), retina, sclera, extra]);

    assert.equal(samples.length, 1);
    const [s] = samples;
    assert.equal(s.id, 'my_eye');
    assert.equal(s.label, 'My eye');
    assert.equal(s.link, 'https://example.test/src');
    assert.equal(s.imported, true);
    assert.deepEqual(s.structures.map((st) => [st.id, st.label, st.path, st.kind, st.local === true]), [
      ['my_eye__retina.glb', 'Retina', 'local:retina.glb', 'gltf', true],
      ['my_eye__sclera.stl', 'sclera.stl', 'local:sclera.stl', 'stl', true],
      ['my_eye__choroid.glb', 'Choroid', 'https://cdn.test/choroid.glb', 'gltf', false],
    ]);
    assert.equal(s.structures[0].bytes, 500);
    assert.equal(s.structures[2]._resolved, undefined, 'a remote mesh is still probed later');
    assert.deepEqual([...files.keys()], ['local:retina.glb', 'local:sclera.stl'], 'unreferenced files are not registered');
    assert.deepEqual(skipped, ['vitreous.glb']);
  });

  test('a manifest whose samples clash with existing ids is renamed consistently', async () => {
    const { samplesFromFiles } = await importFresh('data-loader.js');
    const csv = [HEADER, 'F10 mouse eye,,retina.glb,Retina,retina.glb,'].join('\n');
    const { samples } = await samplesFromFiles([file('m.csv', 1, csv), file('retina.glb')], { existing: [{ id: 'f10_mouse_eye' }] });
    assert.equal(samples[0].id, 'f10_mouse_eye_2');
    assert.equal(samples[0].structures[0].id, 'f10_mouse_eye_2__retina.glb');
    assert.equal(samples[0].structures[0].sampleId, 'f10_mouse_eye_2');
  });

  test('rejects when nothing usable was supplied, or when a manifest names no reachable mesh', async () => {
    const { samplesFromFiles } = await importFresh('data-loader.js');
    await assert.rejects(() => samplesFromFiles([]), /No mesh files/);
    await assert.rejects(() => samplesFromFiles([file('notes.txt')]), /No mesh files/);
    const csv = [HEADER, 'S,,a.glb,A,a.glb,'].join('\n');
    await assert.rejects(() => samplesFromFiles([file('m.csv', 1, csv)]), /names no mesh/);
  });

  test('a manifest is recognised by its extension whatever the case, and text() is what is parsed', async () => {
    const { samplesFromFiles } = await importFresh('data-loader.js');
    const csv = [HEADER, 'S,,a.glb,A,a.glb,'].join('\n');
    const { samples } = await samplesFromFiles([file('MANIFEST.CSV', 1, csv), file('A.glb', 3)]);
    assert.equal(samples[0].structures[0].path, 'local:A.glb', 'matched case-insensitively, path keeps the file\'s own name');
  });
});
