// ============================================================================
//  Tests for app/ui/anatomy-panel.js — the reference-eye panel rendered into
//  a fake DOM over a real headless workbench: the model menu (one entry per
//  registered model, the active mark, the source line), the preset
//  segmented control, the structure tree built from the loaded parts (group
//  headers, rows, the µCT coat tag, the count) and its input turned into
//  wb.anatomy.* calls, the overlay card's idle / loading / error states with
//  their buttons, and the anatomy events (model switch, status, parts, preset)
//  rendered back. Models come from uncompressed glbWithNodes fixtures.
// ============================================================================

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbench } from '../core/workbench.js';
import { headlessAdapters } from '../core/adapters-headless.js';
import { ANATOMY_MODELS, modelById } from '../core/anatomy-models.js';
import { glbWithNodes, stubIo } from './helpers/fixtures.js';
import { installFakeDom, tick, waitFor } from './helpers/fake-dom.js';
import { createAnatomyPanel } from '../app/ui/anatomy-panel.js';

let dom;
beforeEach(() => { dom = installFakeDom(); });
afterEach(() => dom.restore());

const MESHEYE_URL = modelById('mesheye').url;
const UPAT_URL = modelById('upat').url;
const MESHEYE_KEYS = ['sclera', 'choroid', 'retina', 'cornea', 'lens'];
const UPAT_KEYS = ['globe', 'pupil', 'lateral_rectus'];

function makePanel({ cached = [], routes = null, options = {} } = {}) {
  const io = stubIo(routes ?? {
    [MESHEYE_URL]: glbWithNodes(MESHEYE_KEYS),
    [UPAT_URL]: glbWithNodes(UPAT_KEYS),
    cached,
  });
  const wb = createWorkbench({ adapters: headlessAdapters(), io, ...options });
  const panel = createAnatomyPanel(wb, io);
  panel.wireEvents();
  const doc = dom.doc;
  const tree = () => doc.el('#anatomy-tree');
  const rows = () => tree().querySelectorAll('.anat-row');
  const rowOf = (key) => rows().find((r) => r.querySelector(`#anat-${key}`));
  const overlay = () => doc.el('#glb-overlay');
  const presetBtns = () => doc.el('#anatomy-preset').querySelectorAll('.seg-btn');
  return { wb, io, panel, doc, tree, rows, rowOf, overlay, presetBtns };
}

const loaded = (wb) => waitFor(() => wb.anatomy.parts.size > 0 && !wb.anatomy.loading);
const sub = (overlay) => overlay().querySelector('.overlay-sub')?.textContent;

// ---------------------------------------------------------------------------
//  Model menu
// ---------------------------------------------------------------------------
describe('buildModelMenu', () => {
  test('lists every registered model, each enabled, clickable and carrying its blurb and licence', () => {
    const { panel, doc } = makePanel();
    panel.buildModelMenu();
    const items = doc.el('#model-menu').children;
    assert.equal(items.length, ANATOMY_MODELS.length);
    assert.equal(items.length, 3, 'nothing the pane cannot load is offered');
    for (const [i, m] of ANATOMY_MODELS.entries()) {
      const item = items[i];
      assert.equal(item.classList.contains('model-item'), true);
      assert.equal(item.dataset.modelId, m.id);
      assert.equal(item.disabled, false);
      assert.match(item.innerHTML, new RegExp(`<span class="model-name">${m.label.replace(/[+]/g, '\\+')}</span>`));
      assert.match(item.innerHTML, new RegExp(`<span class="model-sub">${m.blurb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`));
      assert.match(item.innerHTML, new RegExp(`<span class="model-lic mono">${m.license.replace(/[.]/g, '\\.')}</span>`));
      assert.equal(item.listeners.has('click'), true, 'every entry has a handler');
    }
    assert.deepEqual(items.filter((i) => i.classList.contains('active')).map((i) => i.dataset.modelId), ['mesheye']);
  });

  test('writes the label and the linked source line for the active model', () => {
    const { panel, doc } = makePanel();
    panel.buildModelMenu();
    assert.equal(doc.el('#model-label').textContent, 'mesh.eye');
    assert.equal(doc.el('#anatomy-source').innerHTML,
      '<a href="https://github.com/feelpp/mesh.eye" target="_blank" rel="noopener">feelpp/mesh.eye ↗</a> · GPL-3.0');
  });

  test('honours a ?model= choice: the menu marks it and the label follows', () => {
    const { panel, doc } = makePanel({ options: { modelId: 'upat' } });
    panel.buildModelMenu();
    const active = doc.el('#model-menu').children.filter((i) => i.classList.contains('active'));
    assert.deepEqual(active.map((i) => i.dataset.modelId), ['upat']);
    assert.equal(doc.el('#model-label').textContent, 'Upatras oculomotor');
    assert.equal(doc.el('#anatomy-source').innerHTML,
      '<a href="https://simtk.org/projects/eye" target="_blank" rel="noopener">Upatras eye model ↗</a> · CC BY 4.0');
  });

  test('clicking an available model closes the menu and switches the workbench model', () => {
    const { wb, panel, doc } = makePanel();
    const setModel = mock.method(wb.anatomy, 'setModel', () => {});
    panel.buildModelMenu();
    const menu = doc.el('#model-menu');
    menu.classList.add('open');
    menu.children.find((i) => i.dataset.modelId === 'upat').click();
    assert.equal(menu.classList.contains('open'), false);
    assert.deepEqual(setModel.mock.calls[0].arguments, ['upat']);
  });

  test('a model switch re-marks the menu, relabels, and empties the tree before the new model loads', async () => {
    const { wb, panel, doc, tree, presetBtns } = makePanel();
    panel.buildModelMenu();
    await wb.anatomy.load();
    await loaded(wb);
    assert.equal(tree().querySelectorAll('.anat-row').length, 5);
    assert.equal(doc.el('#anatomy-count').textContent, 5);

    let rowsAtSwitch = null;
    wb.on('anatomy:status', (s) => { if (s.state === 'loading' && s.phase === 'start' && rowsAtSwitch === null) rowsAtSwitch = tree().querySelectorAll('.anat-row').length; });
    const p = wb.anatomy.setModel('upat');
    assert.equal(rowsAtSwitch, 0, 'tree already empty when the download starts');
    assert.equal(doc.el('#model-label').textContent, 'Upatras oculomotor');
    assert.deepEqual(doc.el('#model-menu').children.filter((i) => i.classList.contains('active')).map((i) => i.dataset.modelId), ['upat']);
    assert.equal(doc.el('#anatomy-count').textContent, '—');
    assert.deepEqual(presetBtns().map((b) => b.textContent), ['Whole', 'Muscles', 'Recti'], 'presets are the new model\'s');

    await p;
    await loaded(wb);
    assert.deepEqual(tree().querySelectorAll('.anat-row').map((r) => r.querySelector('.layer-check').id), ['anat-globe', 'anat-pupil', 'anat-lateral_rectus']);
    assert.equal(doc.el('#anatomy-count').textContent, 3);
  });
});

// ---------------------------------------------------------------------------
//  Tree + presets
// ---------------------------------------------------------------------------
describe('buildTree', () => {
  test('before a load: the tree stays empty, the count is a dash, but the preset control is built', () => {
    const { panel, doc, tree, presetBtns } = makePanel();
    panel.buildTree();
    assert.equal(tree().children.length, 0);
    assert.equal(tree().innerHTML, '');
    assert.equal(doc.el('#anatomy-count').textContent, '—');
    assert.deepEqual(presetBtns().map((b) => [b.dataset.preset, b.textContent, b.classList.contains('active')]),
      [['whole', 'Whole eye', true], ['coats', 'Coats', false], ['media', 'Media', false]]);
    assert.equal(doc.el('#anatomy-preset').classList.contains('seg-2'), false);
    assert.equal(doc.el('#anatomy-preset-desc').textContent, 'Intact globe · clear cornea');
  });

  test('a preset button drives wb.anatomy.setPreset; the event marks it and syncs the rows', async () => {
    const { wb, doc, rowOf, presetBtns } = makePanel();
    await wb.anatomy.load();
    await loaded(wb);
    const setPreset = mock.method(wb.anatomy, 'setPreset');
    presetBtns().find((b) => b.dataset.preset === 'coats').click();
    assert.deepEqual(setPreset.mock.calls[0].arguments, ['coats']);
    assert.deepEqual(presetBtns().map((b) => b.classList.contains('active')), [false, true, false]);
    assert.equal(doc.el('#anatomy-preset-desc').textContent, 'The three coats the µCT segments');
    const cornea = rowOf('cornea'), sclera = rowOf('sclera');
    assert.equal(cornea.querySelector('.layer-check').checked, false, 'hidden by the preset');
    assert.equal(cornea.classList.contains('is-off'), true);
    assert.equal(sclera.querySelector('.layer-check').checked, true);
    assert.equal(sclera.querySelector('.layer-opacity').value, '26');
    assert.equal(sclera.querySelector('.layer-opacity').style['--fill'], '26%');
  });

  test('after a load: group headers, one row per matched structure with the µCT tag on coats, and the count', async () => {
    const { wb, doc, tree, rowOf } = makePanel();
    await wb.anatomy.load();
    await loaded(wb);
    const kids = tree().children;
    assert.deepEqual(kids.map((k) => k.className), [
      'anat-group', 'layer-row anat-row', 'layer-row anat-row', 'layer-row anat-row',
      'anat-group', 'layer-row anat-row', 'layer-row anat-row',
    ]);
    assert.deepEqual(kids.filter((k) => k.className === 'anat-group').map((k) => k.textContent), ['Ocular coats', 'Anterior segment']);
    assert.equal(doc.el('#anatomy-count').textContent, 5);

    const retina = rowOf('retina');
    assert.equal(retina.dataset.state, 'loaded');
    assert.equal(retina.querySelector('.layer-check').checked, true);
    assert.equal(retina.querySelector('.layer-swatch').style.background, '#d9634c');
    assert.equal(retina.querySelector('.layer-color-input').value, '#d9634c');
    assert.equal(retina.querySelector('.layer-label').htmlFor, 'anat-retina');
    assert.match(retina.querySelector('.layer-label').innerHTML, /<span class="layer-name">Retina<\/span><span class="coat-tag"/);
    assert.equal(retina.querySelector('.layer-opacity').value, '100');

    const cornea = rowOf('cornea');
    assert.doesNotMatch(cornea.querySelector('.layer-label').innerHTML, /coat-tag/);
    assert.equal(cornea.querySelector('.layer-opacity').value, '15');
    assert.equal(cornea.querySelector('.layer-opacity').style['--fill'], '15%');
  });

  test('row input: visibility, colour and opacity reach the controller and the row reflects them', async () => {
    const { wb, rowOf } = makePanel();
    await wb.anatomy.load();
    await loaded(wb);
    const setVisible = mock.method(wb.anatomy, 'setVisible');
    const setColor = mock.method(wb.anatomy, 'setColor');
    const setOpacity = mock.method(wb.anatomy, 'setOpacity');
    const row = rowOf('lens');

    const cb = row.querySelector('.layer-check');
    cb.checked = false; cb.dispatch('change');
    assert.deepEqual(setVisible.mock.calls[0].arguments, ['lens', false]);
    assert.equal(row.classList.contains('is-off'), true);
    assert.equal(wb.anatomy.stateFor('lens').visible, false);
    cb.checked = true; cb.dispatch('change');
    assert.equal(row.classList.contains('is-off'), false);

    const swatch = row.querySelector('.layer-swatch'), input = row.querySelector('.layer-color-input');
    const opened = mock.method(input, 'click');
    swatch.click();
    assert.equal(opened.mock.callCount(), 1);
    input.dispatch('input', { target: { value: '#abcdef' } });
    assert.equal(swatch.style.background, '#abcdef');
    assert.deepEqual(setColor.mock.calls[0].arguments, ['lens', 0xabcdef]);
    assert.equal(wb.anatomy.stateFor('lens').color, 0xabcdef);

    const op = row.querySelector('.layer-opacity');
    op.value = '40'; op.dispatch('input');
    assert.deepEqual(setOpacity.mock.calls[0].arguments, ['lens', 0.4]);
    assert.equal(op.style['--fill'], '40%');
    assert.equal(wb.anatomy.stateFor('lens').opacity, 0.4);
  });

  test('a model whose nodes match nothing leaves the tree empty with a dash', async () => {
    const { wb, tree, doc } = makePanel({ routes: { [MESHEYE_URL]: glbWithNodes(['foo', 'bar']) } });
    await wb.anatomy.load();
    await waitFor(() => !wb.anatomy.loading);
    assert.equal(tree().children.length, 0);
    assert.equal(doc.el('#anatomy-count').textContent, '—');
  });
});

// ---------------------------------------------------------------------------
//  Overlay card
// ---------------------------------------------------------------------------
describe('renderOverlay', () => {
  test('idle: the model label and blurb with a Load button that starts the load', async () => {
    const { wb, panel, overlay } = makePanel();
    const load = mock.method(wb.anatomy, 'load', async () => {});
    overlay().classList.add('hidden');
    await panel.renderOverlay('idle');
    assert.equal(overlay().classList.contains('hidden'), false);
    assert.equal(overlay().querySelector('.overlay-icon').textContent, 'visibility');
    assert.equal(overlay().querySelector('.overlay-title').textContent, 'mesh.eye');
    assert.equal(sub(overlay), 'Human eyeball · 10 structures incl. lamina cribrosa');
    assert.equal(overlay().querySelector('#overlay-load').textContent, 'Load model');
    assert.equal(overlay().querySelector('#overlay-load').className, 'btn btn-primary');
    overlay().querySelector('#overlay-load').onclick();
    assert.equal(load.mock.callCount(), 1);
  });

  test('idle: says when the model file is already cached', async () => {
    const { panel, overlay } = makePanel({ cached: [MESHEYE_URL] });
    await panel.renderOverlay('idle');
    assert.match(sub(overlay), /lamina cribrosa · cached$/);
  });

  test('idle: an ?anatomy= override is what the cache is asked about', async () => {
    const { panel, io } = makePanel({ options: { anatomyUrl: 'custom/eye.glb' } });
    const isCached = mock.method(io, 'isCached');
    await panel.renderOverlay('idle');
    assert.deepEqual(isCached.mock.calls[0].arguments, ['custom/eye.glb']);
  });

  test('loading: progress width and label with a Cancel button that aborts', async () => {
    const { wb, panel, overlay } = makePanel();
    const cancel = mock.method(wb.anatomy, 'cancel', () => {});
    await panel.renderOverlay('loading', { pct: 42, label: '42% · 1 MB / 2 MB' });
    assert.equal(overlay().querySelector('.overlay-title').textContent, 'Loading eye anatomy');
    assert.equal(overlay().querySelector('.progress .progress-fill').style.width, '42%');
    assert.equal(sub(overlay), '42% · 1 MB / 2 MB');
    assert.equal(overlay().querySelector('#overlay-cancel').className, 'btn btn-ghost');
    overlay().querySelector('#overlay-cancel').onclick();
    assert.equal(cancel.mock.callCount(), 1);
    await panel.renderOverlay('loading', {});
    assert.equal(overlay().querySelector('.progress-fill').style.width, '0%');
    assert.equal(sub(overlay), '');
  });

  test('error: the message with a Try again button that reloads', async () => {
    const { wb, panel, overlay } = makePanel();
    const load = mock.method(wb.anatomy, 'load', async () => {});
    await panel.renderOverlay('error', { message: 'HTTP 404 Not Found' });
    assert.equal(overlay().querySelector('.overlay-title').textContent, "Couldn't load model");
    assert.equal(sub(overlay), 'HTTP 404 Not Found');
    overlay().querySelector('#overlay-retry').onclick();
    assert.equal(load.mock.callCount(), 1);
  });

  test('each render replaces the previous card', async () => {
    const { panel, overlay } = makePanel();
    await panel.renderOverlay('loading', { pct: 10 });
    await panel.renderOverlay('error', { message: 'x' });
    assert.equal(overlay().children.length, 1);
    assert.equal(overlay().querySelector('#overlay-cancel'), null);
  });

  test('error: a message quoting the fetched file is set as text, never parsed as HTML', async () => {
    const { panel, overlay } = makePanel();
    const payload = 'THREE.GLTFLoader: <img src=x onerror=alert(1)> buffer type is not supported.';
    await panel.renderOverlay('error', { message: payload });
    assert.equal(sub(overlay), payload);
    assert.deepEqual(dom.doc.htmlWrites.filter((h) => h.includes('<img')), []);
  });
});

// ---------------------------------------------------------------------------
//  Status events
// ---------------------------------------------------------------------------
describe('anatomy:status', () => {
  test('a real load walks the card through Starting… → percent → Building model… and then hides it', async () => {
    const { wb, overlay } = makePanel();
    const labels = [];
    wb.on('anatomy:status', () => { labels.push(overlay().querySelector('.overlay-sub')?.textContent ?? null); });
    const p = wb.anatomy.load();
    await tick();
    assert.equal(labels[0], 'Starting…');
    await p;
    await loaded(wb);
    // The listener above is registered after the panel's, so each snapshot is
    // the card as rendered for that very event.
    assert.ok(labels.some((l) => /^\d+% · .* \/ .*/.test(l)), `a percent label among ${JSON.stringify(labels)}`);
    assert.ok(labels.includes('Building model…'));
    assert.equal(overlay().classList.contains('hidden'), true, 'hidden once loaded');
  });

  test('a cached file reports Loading from cache…', async () => {
    const { wb, overlay } = makePanel({ cached: [MESHEYE_URL] });
    const labels = [];
    wb.on('anatomy:parts', () => labels.push('parts'));
    // Registered after the panel's listener, so this sees the card already rendered for the same event.
    wb.on('anatomy:status', (s) => { if (s.state === 'loading' && s.phase === 'download') labels.push(sub(overlay)); });
    await wb.anatomy.load();
    await loaded(wb);
    assert.equal(labels[0], 'Loading from cache…');
  });

  test('a failed download shows the error card and an error toast', async (t) => {
    t.mock.method(console, 'error', () => {});
    const { wb, overlay } = makePanel({ routes: {} });
    await wb.anatomy.load();
    await waitFor(() => !wb.anatomy.loading);
    assert.equal(overlay().classList.contains('hidden'), false);
    assert.equal(overlay().querySelector('.overlay-title').textContent, "Couldn't load model");
    assert.equal(sub(overlay), 'HTTP 404 Not Found');
    const toasts = dom.doc.el('#toast-host').children;
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].className, 'toast toast-error');
    assert.equal(toasts[0].textContent, 'Couldn\'t load the eye-anatomy model. HTTP 404 Not Found');
  });

  test('an ?anatomy= file whose glTF puts markup in the loader error shows it as text', async (t) => {
    t.mock.method(console, 'error', () => {});
    // three's GLTFLoader quotes bufferDef.type in the error it throws, so the
    // hosted file decides that text.
    const payload = '<img src=x onerror=alert(document.domain)>';
    const gltf = {
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ type: payload, byteLength: 36 }],
    };
    const url = 'https://elsewhere.example/eye.gltf';
    const { wb, overlay } = makePanel({ routes: { [url]: new TextEncoder().encode(JSON.stringify(gltf)).buffer }, options: { anatomyUrl: url } });
    await wb.anatomy.load();
    await waitFor(() => !wb.anatomy.loading);
    assert.equal(overlay().querySelector('.overlay-title').textContent, "Couldn't load model");
    assert.ok(sub(overlay).includes(payload), `the loader's message, verbatim: ${sub(overlay)}`);
    assert.deepEqual(dom.doc.htmlWrites.filter((h) => h.includes('<img')), []);
  });

  test('cancelling mid-download returns to the idle card', async () => {
    const { wb, overlay } = makePanel();
    const p = wb.anatomy.load();
    await tick();
    assert.equal(overlay().querySelector('.overlay-title').textContent, 'Loading eye anatomy');
    overlay().querySelector('#overlay-cancel').onclick();
    await p;
    await tick();
    assert.equal(overlay().querySelector('#overlay-load').textContent, 'Load model');
    assert.equal(overlay().classList.contains('hidden'), false);
    assert.equal(wb.anatomy.parts.size, 0);
  });
});
