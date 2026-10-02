// ============================================================================
//  Tests for app/ui/import-panel.js — the import dialog and drop targets
//  rendered into the fake DOM: the top-bar button opens the dialog, the close
//  paths, the browse button forwarding to the hidden input, a file pick and
//  a drop reaching onFiles (dialog closed, input cleared, drags without files
//  ignored, the over / dropping highlights following enter and leave), and a
//  manifest URL reaching onManifestUrl trimmed, on click or Enter, never empty.
// ============================================================================

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, tick } from './helpers/fake-dom.js';
import { createImportPanel } from '../app/ui/import-panel.js';

let dom;
beforeEach(() => { dom = installFakeDom(); });
afterEach(() => dom.restore());

function makePanel() {
  const doc = dom.doc;
  // The static markup the panel expects: a <dialog> with a close button, the
  // hidden file input, the URL field, the drop zone and the viewport.
  const dialog = doc.el('#import-dialog');
  dialog.innerHTML = '<button class="dialog-close"></button>';
  dialog.showModal = mock.fn();
  dialog.close = mock.fn();
  const input = doc.el('#import-files');
  input.click = mock.fn();
  // Like a real file input: `files` is a live list that empties when value is cleared.
  let picked = [];
  Object.defineProperty(input, 'files', { get: () => (input.value === '' ? [] : picked), set: (v) => { picked = v; } });
  const onFiles = mock.fn(async () => {});
  const onManifestUrl = mock.fn(async () => {});
  const panel = createImportPanel({ onFiles, onManifestUrl });
  panel.wire();
  return { doc, dialog, input, onFiles, onManifestUrl, panel };
}

const dragEvent = (files, types = ['Files']) => ({
  preventDefault: mock.fn(),
  dataTransfer: { types, files, dropEffect: '' },
});

describe('dialog', () => {
  test('the top-bar button opens it; the close button, a backdrop click and close() shut it', () => {
    const { doc, dialog, panel } = makePanel();
    doc.el('#btn-import').click();
    assert.equal(dialog.showModal.mock.callCount(), 1);
    dialog.querySelector('.dialog-close').click();
    assert.equal(dialog.close.mock.callCount(), 1);
    dialog.dispatch('click', { target: dialog });
    assert.equal(dialog.close.mock.callCount(), 2);
    dialog.dispatch('click', { target: doc.el('#import-url') });
    assert.equal(dialog.close.mock.callCount(), 2, 'a click inside the card does not close it');
    panel.open(); panel.close();
    assert.equal(dialog.showModal.mock.callCount(), 2);
    assert.equal(dialog.close.mock.callCount(), 3);
  });
});

describe('files', () => {
  test('Choose files forwards to the hidden input', () => {
    const { doc, input } = makePanel();
    doc.el('#import-browse').click();
    assert.equal(input.click.mock.callCount(), 1);
  });

  test('a pick hands the files to onFiles, closes the dialog and clears the input', async () => {
    const { input, dialog, onFiles } = makePanel();
    const files = [{ name: 'retina.glb' }, { name: 'sclera.glb' }];
    input.files = files; input.value = 'C:\\fakepath\\retina.glb';
    await Promise.all(input.dispatch('change'));
    assert.equal(onFiles.mock.callCount(), 1, 'the files were copied before the input was cleared');
    assert.deepEqual(onFiles.mock.calls[0].arguments[0], files);
    assert.equal(dialog.close.mock.callCount(), 1);
    assert.equal(input.value, '');
  });

  test('an empty pick is ignored', async () => {
    const { input, dialog, onFiles } = makePanel();
    input.files = []; input.value = 'x';
    await Promise.all(input.dispatch('change'));
    assert.equal(onFiles.mock.callCount(), 0);
    assert.equal(dialog.close.mock.callCount(), 0);
  });

  test('a drop on the viewport reaches onFiles; the dropping highlight follows enter and leave', async () => {
    const { doc, onFiles } = makePanel();
    const viewport = doc.el('#viewport');
    const files = [{ name: 'a.stl' }];

    const enter = dragEvent(files);
    viewport.dispatch('dragenter', enter);
    assert.equal(enter.preventDefault.mock.callCount(), 1);
    assert.equal(doc.body.classList.contains('dropping'), true);
    viewport.dispatch('dragenter', dragEvent(files));       // a child element
    viewport.dispatch('dragleave', dragEvent(files));
    assert.equal(doc.body.classList.contains('dropping'), true, 'still over the viewport');
    const over = dragEvent(files);
    viewport.dispatch('dragover', over);
    assert.equal(over.preventDefault.mock.callCount(), 1);
    assert.equal(over.dataTransfer.dropEffect, 'copy');

    const drop = dragEvent(files);
    await Promise.all(viewport.dispatch('drop', drop));
    assert.equal(drop.preventDefault.mock.callCount(), 1);
    assert.equal(doc.body.classList.contains('dropping'), false);
    assert.deepEqual(onFiles.mock.calls[0].arguments[0], files);

    viewport.dispatch('dragleave', dragEvent(files));
    assert.equal(doc.body.classList.contains('dropping'), false, 'the counter never goes negative');
  });

  test('the dialog drop zone highlights with the over class and takes a drop too', async () => {
    const { doc, dialog, onFiles } = makePanel();
    const zone = doc.el('#import-drop');
    zone.dispatch('dragenter', dragEvent([{ name: 'a.stl' }]));
    assert.equal(zone.classList.contains('over'), true);
    zone.dispatch('dragleave', dragEvent([{ name: 'a.stl' }]));
    assert.equal(zone.classList.contains('over'), false);
    await Promise.all(zone.dispatch('drop', dragEvent([{ name: 'a.stl' }])));
    assert.equal(onFiles.mock.callCount(), 1);
    assert.equal(dialog.close.mock.callCount(), 1);
  });

  test('a drag that carries text or a link, not files, is left to the browser', async () => {
    const { doc, onFiles } = makePanel();
    const viewport = doc.el('#viewport');
    const e = dragEvent([], ['text/plain']);
    viewport.dispatch('dragenter', e);
    viewport.dispatch('dragover', e);
    await Promise.all(viewport.dispatch('drop', e));
    assert.equal(e.preventDefault.mock.callCount(), 0);
    assert.equal(doc.body.classList.contains('dropping'), false);
    assert.equal(onFiles.mock.callCount(), 0);
  });
});

describe('manifest URL', () => {
  test('Load hands the trimmed URL to onManifestUrl and closes the dialog', async () => {
    const { doc, dialog, onManifestUrl } = makePanel();
    doc.el('#import-url').value = '  https://example.test/m.csv \n';
    await Promise.all(doc.el('#import-load-url').dispatch('click'));
    assert.deepEqual(onManifestUrl.mock.calls[0].arguments, ['https://example.test/m.csv']);
    assert.equal(dialog.close.mock.callCount(), 1);
  });

  test('Enter in the field does the same and swallows the key; other keys do nothing', async () => {
    const { doc, onManifestUrl } = makePanel();
    const field = doc.el('#import-url');
    field.value = 'local/F10/F10_layers.csv';
    const enter = { key: 'Enter', preventDefault: mock.fn() };
    field.dispatch('keydown', enter);
    await tick();
    assert.equal(enter.preventDefault.mock.callCount(), 1);
    assert.deepEqual(onManifestUrl.mock.calls[0].arguments, ['local/F10/F10_layers.csv']);
    field.dispatch('keydown', { key: 'a', preventDefault: mock.fn() });
    await tick();
    assert.equal(onManifestUrl.mock.callCount(), 1);
  });

  test('an empty field is ignored', async () => {
    const { doc, dialog, onManifestUrl } = makePanel();
    doc.el('#import-url').value = '   ';
    await Promise.all(doc.el('#import-load-url').dispatch('click'));
    assert.equal(onManifestUrl.mock.callCount(), 0);
    assert.equal(dialog.close.mock.callCount(), 0);
  });
});
