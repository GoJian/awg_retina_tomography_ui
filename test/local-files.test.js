// ============================================================================
//  Tests for app/local-files.js — the io wrapper that serves `local:` paths
//  from File objects held in memory and hands every other URL to the network
//  io: the read, the progress report, the abort paths, the cache answer and
//  the pass-through.
// ============================================================================

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalIo, isLocalPath, LOCAL_PREFIX } from '../app/local-files.js';

// A File stand-in: what samplesFromFiles() puts in its map.
const fakeFile = (name, bytes) => ({
  name, size: bytes.length,
  async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
});

function makeBase() {
  return {
    fetchBuffer: mock.fn(async () => new Uint8Array([9, 9]).buffer),
    isCached: mock.fn(async (url) => url === 'cached.glb'),
  };
}

describe('isLocalPath', () => {
  test('recognises the prefix and nothing else', () => {
    assert.equal(LOCAL_PREFIX, 'local:');
    assert.equal(isLocalPath('local:retina.glb'), true);
    assert.equal(isLocalPath('local/F10/retina.glb'), false);
    assert.equal(isLocalPath('https://x/local:y'), false);
    assert.equal(isLocalPath(undefined), false);
  });
});

describe('createLocalIo', () => {
  test('a registered path is read from the file with one complete progress report', async () => {
    const base = makeBase();
    const local = createLocalIo(base);
    local.add(new Map([['local:retina.glb', fakeFile('retina.glb', [1, 2, 3])]]));
    const progress = [];
    const buf = await local.io.fetchBuffer('local:retina.glb', { onProgress: (p) => progress.push(p) });
    assert.deepEqual([...new Uint8Array(buf)], [1, 2, 3]);
    assert.deepEqual(progress, [{ loaded: 3, total: 3 }]);
    assert.equal(base.fetchBuffer.mock.callCount(), 0, 'the network io is not consulted');
    assert.equal(local.has('local:retina.glb'), true);
    assert.equal(local.files.size, 1);
  });

  test('any other URL goes to the network io with the same options', async () => {
    const base = makeBase();
    const local = createLocalIo(base);
    const opts = { onProgress: () => {}, signal: new AbortController().signal };
    const buf = await local.io.fetchBuffer('optimized/eye.glb', opts);
    assert.deepEqual([...new Uint8Array(buf)], [9, 9]);
    assert.deepEqual(base.fetchBuffer.mock.calls[0].arguments, ['optimized/eye.glb', opts]);
    assert.equal(local.has('optimized/eye.glb'), false);
  });

  test('isCached is true for a local path and defers to the network io otherwise', async () => {
    const base = makeBase();
    const local = createLocalIo(base);
    local.add(new Map([['local:a.stl', fakeFile('a.stl', [1])]]));
    assert.equal(await local.io.isCached('local:a.stl'), true);
    assert.equal(await local.io.isCached('cached.glb'), true);
    assert.equal(await local.io.isCached('other.glb'), false);
    assert.equal(base.isCached.mock.callCount(), 2);
  });

  test('an already-aborted signal rejects with AbortError before the file is read', async () => {
    const local = createLocalIo(makeBase());
    const file = fakeFile('a.stl', [1]);
    const read = mock.method(file, 'arrayBuffer');
    local.add(new Map([['local:a.stl', file]]));
    const ctl = new AbortController(); ctl.abort();
    await assert.rejects(() => local.io.fetchBuffer('local:a.stl', { signal: ctl.signal }), { name: 'AbortError' });
    assert.equal(read.mock.callCount(), 0);
  });

  test('an abort that lands during the read rejects with AbortError and reports no progress', async () => {
    const local = createLocalIo(makeBase());
    const ctl = new AbortController();
    const file = { name: 'a.stl', size: 1, async arrayBuffer() { ctl.abort(); return new Uint8Array([1]).buffer; } };
    local.add(new Map([['local:a.stl', file]]));
    const progress = [];
    await assert.rejects(() => local.io.fetchBuffer('local:a.stl', { signal: ctl.signal, onProgress: (p) => progress.push(p) }), { name: 'AbortError' });
    assert.deepEqual(progress, []);
  });

  test('add() merges into the map, later registrations winning', async () => {
    const local = createLocalIo(makeBase());
    local.add(new Map([['local:a.stl', fakeFile('a.stl', [1])]]));
    local.add(new Map([['local:a.stl', fakeFile('a.stl', [2])], ['local:b.stl', fakeFile('b.stl', [3])]]));
    assert.equal(local.files.size, 2);
    assert.deepEqual([...new Uint8Array(await local.io.fetchBuffer('local:a.stl'))], [2]);
  });
});
