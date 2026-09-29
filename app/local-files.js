// ============================================================================
//  local-files.js — serves the files a user picked or dropped through the same
//  io the workbench downloads from. samplesFromFiles() (data-loader.js) gives
//  each such structure a `local:<name>` path; this wraps the network io so a
//  local path is read from the File in memory while every other URL still
//  goes to the network and the Cache Storage as before. App layer, on
//  purpose: it holds File objects, which the DOM-free core never sees — the
//  core only ever calls io.fetchBuffer(url) and io.isCached(url).
// ============================================================================

/** The scheme samplesFromFiles() gives a structure that is read from a File. */
export const LOCAL_PREFIX = 'local:';

/** Whether a structure path names a locally supplied file. */
export const isLocalPath = (url) => typeof url === 'string' && url.startsWith(LOCAL_PREFIX);

/**
 * Wrap a network io so `local:` paths resolve from files held in memory.
 *
 * @param {{ fetchBuffer: Function, isCached: Function }} base the network io
 *   (asset-loader.js's fetchBuffer / isCached)
 * @returns {{ io: { fetchBuffer: Function, isCached: Function },
 *   add: (files: Map<string, object>) => void, has: (url: string) => boolean,
 *   files: Map<string, object> }}
 *   `io` is what the workbench and the panels take; `add` registers the map
 *   samplesFromFiles() returns.
 */
export function createLocalIo(base) {
  const files = new Map();

  async function fetchBuffer(url, { onProgress, signal } = {}) {
    const file = files.get(url);
    if (!file) return base.fetchBuffer(url, { onProgress, signal });
    if (signal?.aborted) throw abortError();
    const buf = await file.arrayBuffer();
    if (signal?.aborted) throw abortError();
    onProgress?.({ loaded: buf.byteLength, total: buf.byteLength });
    return buf;
  }

  // A local file needs no download, so for the heavy-layer confirm and the
  // row label it counts as already present.
  async function isCached(url) {
    return files.has(url) ? true : base.isCached(url);
  }

  return {
    io: { fetchBuffer, isCached },
    add(map) { for (const [path, file] of map) files.set(path, file); },
    has: (url) => files.has(url),
    files,
  };
}

function abortError() {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}
