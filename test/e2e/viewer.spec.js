// ============================================================================
//  End-to-end smoke tests — the unit suite covers the data layer, but only a
//  real browser can show that WebGL initialises, that a decimated mesh actually
//  reaches the GPU, and that the panes and controls stay wired together.
//
//  The manifest is pinned to the checked-in F10 dataset (?dataset=…) so these
//  never depend on Hugging Face being reachable. `?demo=off` suppresses the
//  synthetic second sample so counts are predictable.
// ============================================================================

import fs from 'node:fs';
import { test, expect } from '@playwright/test';

const APP = '/index.html?dataset=local/F10/F10_layers.csv&demo=off';

/**
 * Triangles drawn in the most recent frame, read from the status bar. The
 * status bar is refreshed from the render loop roughly every 250ms, so callers
 * must poll this rather than read it once.
 */
async function triangleCount(page) {
  const text = await page.locator('#stat-tris').innerText();
  return Number(text.replace(/[^0-9]/g, '')) || 0;
}

/**
 * Toggle a segmented layer on. The visible control is the label; the checkbox
 * itself sits underneath it, so the click is forced rather than hit-tested.
 * Note `.layer-check` — `.sample-vis` is the whole-sample toggle above it.
 */
async function toggleLayer(page, index = 0, on = true) {
  const box = page.locator('.layer-check').nth(index);
  await (on ? box.check({ force: true }) : box.uncheck({ force: true }));
}

/** The left pane loads its reference eye on demand, behind a "Load model" card. */
async function loadAnatomy(page) {
  await page.locator('#overlay-load').click();
  await expect(page.locator('#anatomy-count')).toHaveText('10', { timeout: 45_000 });
}

/** Console errors and uncaught exceptions for the lifetime of the page. */
function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test.describe('viewer boot', () => {
  test('loads, initialises both WebGL panes, and lists the manifest', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(APP);

    await expect(page).toHaveTitle(/tomography/i);
    await expect(page.locator('#pane-glb canvas')).toBeVisible();
    await expect(page.locator('#pane-stl canvas')).toBeVisible();

    await expect(page.locator('#layer-count')).toHaveText('5');
    const tree = page.locator('#layer-tree');
    for (const label of ['Retina', 'RPE', 'Choroid', 'Sclera', 'Vitreous']) {
      await expect(tree).toContainText(label);
    }
    await expect(tree).toContainText('F10 mouse eye');

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('starts with the segmented pane empty and nothing on the GPU', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('#stl-empty')).toBeVisible();
    expect(await triangleCount(page)).toBe(0);
  });

  test('shows each layer size before it is downloaded', async ({ page }) => {
    await page.goto(APP);
    // probeSizes() fills these in from HEAD requests, without fetching meshes.
    await expect(page.locator('.layer-row').first()).toContainText(/\d+(\.\d+)?\s*KB/, { timeout: 20_000 });
  });
});

test.describe('reference anatomy', () => {
  test('loads on demand and builds the structure tree', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('#anatomy-tree')).toBeEmpty();

    await loadAnatomy(page);

    const tree = page.locator('#anatomy-tree');
    for (const s of ['Cornea', 'Iris', 'Lens', 'Sclera', 'Lamina cribrosa', 'Optic nerve']) {
      await expect(tree).toContainText(s);
    }
    await expect.poll(() => triangleCount(page), { timeout: 20_000 }).toBeGreaterThan(100_000);
  });
});

test.describe('layer loading', () => {
  test('toggling a layer downloads it and puts geometry on the GPU', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('#layer-count')).toHaveText('5');

    await toggleLayer(page, 0);

    await expect(page.locator('.layer-row').first()).toHaveAttribute('data-state', 'loaded', { timeout: 45_000 });
    await expect(page.locator('#stl-empty')).toBeHidden();
    await expect.poll(() => triangleCount(page), { timeout: 20_000 }).toBeGreaterThan(1000);
  });

  test('unchecking a layer removes its geometry again', async ({ page }) => {
    await page.goto(APP);
    await toggleLayer(page, 0);
    await expect(page.locator('.layer-row').first()).toHaveAttribute('data-state', 'loaded', { timeout: 45_000 });

    await toggleLayer(page, 0, false);
    await expect.poll(() => triangleCount(page), { timeout: 20_000 }).toBe(0);
    await expect(page.locator('#stl-empty')).toBeVisible();
  });

  test('several layers accumulate in the same scene', async ({ page }) => {
    await page.goto(APP);
    await toggleLayer(page, 0);
    await expect(page.locator('.layer-row').nth(0)).toHaveAttribute('data-state', 'loaded', { timeout: 45_000 });
    await expect.poll(() => triangleCount(page), { timeout: 20_000 }).toBeGreaterThan(1000);
    const one = await triangleCount(page);

    await toggleLayer(page, 1);
    await expect(page.locator('.layer-row').nth(1)).toHaveAttribute('data-state', 'loaded', { timeout: 45_000 });
    await expect.poll(() => triangleCount(page), { timeout: 20_000 }).toBeGreaterThan(one);
  });

  test('a downloaded mesh is kept in the asset cache', async ({ page }) => {
    await page.goto(APP);
    await toggleLayer(page, 0);
    await expect(page.locator('.layer-row').first()).toHaveAttribute('data-state', 'loaded', { timeout: 45_000 });

    const keys = await page.evaluate(async () => {
      const c = await caches.open('retina-assets-v2');
      return (await c.keys()).map((r) => r.url);
    });
    expect(keys.some((u) => u.includes('retina.glb'))).toBe(true);

    // After a reload the row reports the mesh as cached rather than re-fetching.
    await page.reload();
    await toggleLayer(page, 0);
    await expect(page.locator('.layer-row').first()).toContainText(/cached/i, { timeout: 45_000 });
  });
});

test.describe('controls', () => {
  test('render modes switch without tearing down the scene', async ({ page }) => {
    await page.goto(APP);
    await toggleLayer(page, 0);
    await expect(page.locator('.layer-row').first()).toHaveAttribute('data-state', 'loaded', { timeout: 45_000 });

    for (const mode of ['wireframe', 'slices', 'surface']) {
      await page.locator(`#render-mode [data-mode="${mode}"]`).click();
      await expect(page.locator(`#render-mode [data-mode="${mode}"]`)).toHaveClass(/active/);
      await expect(page.locator('#stat-mode')).toHaveText(new RegExp(mode, 'i'));
      await expect(page.locator('#pane-stl canvas')).toBeVisible();
      // The layer stays loaded throughout; only its material changes.
      await expect(page.locator('.layer-row').first()).toHaveAttribute('data-state', 'loaded');
    }

    // Wireframe draws line primitives, so the triangle counter legitimately
    // reads zero there — it must come back once the surface material returns.
    await expect.poll(() => triangleCount(page), { timeout: 20_000 }).toBeGreaterThan(1000);
  });

  test('slices mode exposes the clipping controls and enables one axis', async ({ page }) => {
    await page.goto(APP);
    await toggleLayer(page, 0);
    await expect(page.locator('.layer-row').first()).toHaveAttribute('data-state', 'loaded', { timeout: 45_000 });

    await expect(page.locator('#slice-sec')).toBeHidden();
    await page.locator('#render-mode [data-mode="slices"]').click();
    await expect(page.locator('#slice-sec')).toBeVisible();
    // Entering slices with nothing cut turns on one axis, so a cut is visible.
    await expect(page.locator('.slice-toggle input[data-axis="x"]')).toBeChecked();
  });

  test('the layout toggle switches between split and overlay', async ({ page }) => {
    await page.goto(APP);
    await page.locator('#layout-seg [data-layout="overlay"]').click();
    await expect(page.locator('#layout-seg [data-layout="overlay"]')).toHaveClass(/active/);

    await page.locator('#layout-seg [data-layout="split"]').click();
    await expect(page.locator('#layout-seg [data-layout="split"]')).toHaveClass(/active/);
    await expect(page.locator('#pane-glb canvas')).toBeVisible();
    await expect(page.locator('#pane-stl canvas')).toBeVisible();
  });

  test('sync links and unlinks the two cameras', async ({ page }) => {
    await page.goto(APP);
    const sync = page.locator('#btn-sync');
    await expect(sync).toHaveAttribute('aria-pressed', 'false');
    await sync.click();
    await expect(sync).toHaveAttribute('aria-pressed', 'true');
    await sync.click();
    await expect(sync).toHaveAttribute('aria-pressed', 'false');
  });

  test('the global opacity slider updates its readout', async ({ page }) => {
    await page.goto(APP);
    await toggleLayer(page, 0);
    await expect(page.locator('.layer-row').first()).toHaveAttribute('data-state', 'loaded', { timeout: 45_000 });

    await page.locator('#global-opacity').fill('45');
    await expect(page.locator('#opacity-val')).toHaveText('45%');
    await expect.poll(() => triangleCount(page), { timeout: 20_000 }).toBeGreaterThan(1000);
  });

  test('reset returns the camera without dropping the geometry', async ({ page }) => {
    await page.goto(APP);
    await toggleLayer(page, 0);
    await expect(page.locator('.layer-row').first()).toHaveAttribute('data-state', 'loaded', { timeout: 45_000 });
    await expect.poll(() => triangleCount(page), { timeout: 20_000 }).toBeGreaterThan(1000);

    await page.locator('#btn-reset').click();
    await expect(page.locator('#stat-cam')).toContainText('az');
    // The camera moves; the geometry must not go anywhere.
    await expect.poll(() => triangleCount(page), { timeout: 20_000 }).toBeGreaterThan(1000);
  });

  test('the help and about dialogs open, credit the model licences and list both authors', async ({ page }) => {
    await page.goto(APP);
    await page.locator('#btn-help').click();
    await expect(page.locator('#help-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#help-dialog')).toBeHidden();

    await page.locator('#btn-about').click();
    await expect(page.locator('#about-dialog')).toBeVisible();
    await expect(page.locator('#about-dialog')).toContainText(/GPL|CC BY|licen[cs]e/i);
    // Both authors, with the affiliations the paper gives.
    await expect(page.locator('#about-dialog')).toContainText('Del Norte High School');
    await expect(page.locator('#about-dialog')).toContainText('Jian Gong');
    await expect(page.locator('#about-dialog')).toContainText('University of Wyoming');
  });
});

test.describe('URL parameters', () => {
  test('?model= selects a different reference eye', async ({ page }) => {
    await page.goto('/index.html?dataset=local/F10/F10_layers.csv&demo=off&model=upat');
    await expect(page.locator('#model-label')).toContainText(/upat|oculomotor|opensim/i);
    await page.locator('#overlay-load').click();
    await expect(page.locator('#anatomy-tree')).toContainText(/rectus|oblique/i, { timeout: 45_000 });
  });

  test('a missing ?dataset= leaves the app usable instead of hanging', async ({ page }) => {
    await page.goto('/index.html?dataset=local/does-not-exist.csv&demo=off');
    await expect(page.locator('#layer-count')).toHaveText('0', { timeout: 30_000 });
    // The anatomy pane is independent of the manifest and must still work.
    await expect(page.locator('#pane-glb canvas')).toBeVisible();
  });
});

test.describe('importing your own data', () => {
  test('files picked from disk appear as a new local sample, load at once and render', async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('#layer-count')).toHaveText('5');

    await page.locator('#btn-import').click();
    await expect(page.locator('#import-dialog')).toBeVisible();
    // The bundled F10 coats stand in for a user's own files; the input is the
    // same one the drop zone and the Choose-files button feed.
    await page.locator('#import-files').setInputFiles(['local/F10/retina.glb', 'local/F10/sclera.glb']);

    await expect(page.locator('#import-dialog')).toBeHidden();
    await expect(page.locator('#layer-count')).toHaveText('7');
    const group = page.locator('.sample.is-imported');
    await expect(group).toContainText('Imported');
    await expect(group).toContainText('Retina');
    await expect(group).toContainText('Sclera');
    // Local layers switch on without a click and read from memory, never the network.
    await expect(group.locator('.layer-row').nth(0)).toHaveAttribute('data-state', 'loaded', { timeout: 45_000 });
    await expect(group.locator('.layer-row').nth(1)).toHaveAttribute('data-state', 'loaded', { timeout: 45_000 });
    await expect(group.locator('.layer-row').first()).toContainText(/local file/i);
    await expect(page.locator('#stl-empty')).toBeHidden();
    await expect.poll(() => triangleCount(page), { timeout: 20_000 }).toBeGreaterThan(1000);
    await expect(page.locator('#study-label')).toContainText(/IMPORTED/);
  });

  test('a manifest URL typed into the dialog replaces the dataset and lands in the address bar', async ({ page }) => {
    await page.goto('/index.html?dataset=local/does-not-exist.csv&demo=off');
    await expect(page.locator('#layer-count')).toHaveText('0', { timeout: 30_000 });

    await page.locator('#btn-import').click();
    await page.locator('#import-url').fill('local/F10/F10_layers.csv');
    await page.locator('#import-load-url').click();

    await expect(page.locator('#import-dialog')).toBeHidden();
    await expect(page.locator('#layer-count')).toHaveText('5');
    await expect(page.locator('#layer-tree')).toContainText('F10 mouse eye');
    expect(new URL(page.url()).searchParams.get('dataset')).toBe('local/F10/F10_layers.csv');
  });
});

test.describe('responsive', () => {
  test('both panes survive a phone-sized viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(APP);
    await expect(page.locator('#pane-glb canvas')).toBeVisible();
    await expect(page.locator('#pane-stl canvas')).toBeVisible();
    await expect(page.locator('#layer-count')).toHaveText('5');
  });
});

test.describe('untrusted text', () => {
  // A ?dataset= link can point at anyone's manifest, and an imported file can
  // be named anything, so both are hostile input. The fixture's sample name and
  // layer labels are <img onerror> payloads and its sample_link is a
  // javascript: URL; the imported file's name is another payload.
  const SAMPLE = "<img src=x onerror=alert('sample')>";
  const LAYER = "<img src=x onerror=alert('layer')>";
  const FILE = "<img src=x onerror=alert('file')>";

  test('manifest and file names render as literal text and run nothing', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await page.goto('/index.html?dataset=test/e2e/fixtures/xss-manifest.csv&demo=off');
    await expect(page.locator('#layer-count')).toHaveText('2');

    const tree = page.locator('#layer-tree');
    await expect(tree.locator('.sample-name')).toHaveText(SAMPLE);
    await expect(tree.locator('.layer-name')).toHaveText([LAYER, '<b>RPE</b>']);
    await expect(page.locator('#study-menu .study-item-name')).toHaveText(SAMPLE);
    await expect(tree.locator('.sample-src'), 'a javascript: sample_link gets no anchor').toHaveCount(0);

    await page.locator('#btn-import').click();
    await page.locator('#import-files').setInputFiles({
      name: `${FILE}.glb`, mimeType: 'model/gltf-binary', buffer: fs.readFileSync('local/F10/rpe.glb'),
    });
    await expect(page.locator('#layer-count')).toHaveText('3');
    await expect(page.locator('.sample.is-imported .layer-name')).toHaveText(FILE);

    // Nothing was parsed out of the strings: no <img>/<b> elements anywhere
    // they are shown, and no handler fired (an <img> error fires within
    // milliseconds of insertion, so a short settle is enough to catch one).
    await expect(page.locator('#layer-tree img, #layer-tree b, #study-menu img')).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(dialogs).toEqual([]);
  });
});
