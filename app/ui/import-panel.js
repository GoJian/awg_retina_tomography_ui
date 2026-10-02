// ============================================================================
//  import-panel.js — the "Import" dialog and the drag-and-drop targets: the
//  one place the app takes the user's own data. It owns the top-bar button,
//  the dialog (file picker, drop zone, manifest-URL field) and the
//  whole-viewport drop overlay, and hands whatever it receives to the two
//  callbacks the controller supplies — it never builds a sample itself, and
//  nothing it takes leaves the browser. Pure view: it touches the document
//  only from wire() onwards.
// ============================================================================

const $ = (s) => document.querySelector(s);

/** Whether a drag carries files (as opposed to text or a link). */
const carriesFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

/**
 * Build the import panel.
 * @param {object} handlers
 * @param {(files: File[]) => Promise<void>|void} handlers.onFiles files the
 *   user picked or dropped, in the order given
 * @param {(url: string) => Promise<void>|void} handlers.onManifestUrl a manifest
 *   URL typed into the dialog, trimmed and non-empty
 */
export function createImportPanel({ onFiles, onManifestUrl }) {
  const dialog = $('#import-dialog');
  const input = $('#import-files');
  const urlField = $('#import-url');

  const open = () => dialog.showModal();
  const close = () => dialog.close();

  async function takeFiles(list) {
    const files = [...(list || [])];
    if (!files.length) return;
    close();
    await onFiles(files);
  }

  async function takeUrl() {
    const url = (urlField.value || '').trim();
    if (!url) return;
    close();
    await onManifestUrl(url);
  }

  // A drop target: highlight while files hover over it, take them on drop.
  // The counter survives dragenter/dragleave pairs fired by child elements.
  function dropTarget(el, setOver) {
    let depth = 0;
    el.addEventListener('dragenter', (e) => { if (!carriesFiles(e)) return; e.preventDefault(); depth++; setOver(true); });
    el.addEventListener('dragover', (e) => { if (!carriesFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    el.addEventListener('dragleave', (e) => { if (!carriesFiles(e)) return; if (--depth <= 0) { depth = 0; setOver(false); } });
    el.addEventListener('drop', async (e) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth = 0; setOver(false);
      await takeFiles(e.dataTransfer.files);
    });
  }

  function wire() {
    $('#btn-import').addEventListener('click', open);
    dialog.querySelector('.dialog-close').addEventListener('click', close);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });

    $('#import-browse').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      // Copy first: input.files is a live FileList that empties when the
      // value is cleared, and it is cleared so the same file can be picked again.
      const picked = [...(input.files || [])];
      input.value = '';
      await takeFiles(picked);
    });

    $('#import-load-url').addEventListener('click', takeUrl);
    urlField.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); takeUrl(); } });

    const zone = $('#import-drop');
    dropTarget(zone, (on) => zone.classList.toggle('over', on));
    dropTarget($('#viewport'), (on) => document.body.classList.toggle('dropping', on));
  }

  return { wire, open, close, takeFiles, takeUrl };
}
