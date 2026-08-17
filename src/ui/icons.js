// Vendored Lucide icon loader (/vendor/icons/*.svg, ISC-licensed — see
// /vendor/icons/LICENSE). No CDN calls at runtime: every icon is a local
// static file, fetched once at boot and cached as a parsed template, so
// every later createIcon() call is synchronous — needed because row-building
// code (libraryView.js, editorView.js's color-manage rows, beadCatalogDialog.js)
// constructs DOM synchronously and can't await a fetch per row.

const ICON_NAMES = [
  'pencil', 'eraser', 'paint-bucket', 'replace', 'lasso-select', 'copy',
  'scissors', 'clipboard-paste', 'flip-horizontal-2', 'flip-vertical-2',
  'square-x', 'trash-2', 'copy-plus', 'log-in', 'grip-vertical',
  'chevron-left', 'undo-2', 'redo-2', 'printer', 'panel-right', 'settings',
  'ruler', 'square', 'crosshair', 'list', 'layout-grid', 'palette', 'image',
  'move', 'plus', 'check', 'x', 'bring-to-front', 'send-to-back', 'pipette',
  'layers', 'cloud', 'cloud-upload', 'cloud-download', 'log-out', 'download',
  'upload', 'triangle-alert',
];

const templates = new Map(); // name -> parsed <svg> template element

// Fetches and parses every vendored icon once — called from main.js's boot()
// before any view mounts, so every renderList()/buildRow() call afterward can
// call createIcon() synchronously.
export async function preloadIcons() {
  await Promise.all(ICON_NAMES.map(async (name) => {
    const res = await fetch(`vendor/icons/${name}.svg`);
    const svgText = await res.text();
    const template = document.createElement('template');
    template.innerHTML = svgText.trim();
    templates.set(name, template.content.firstElementChild);
  }));
}

// Returns a fresh <svg> element ready to insert — callers own the returned
// node. Sizing/color are CSS-driven: the vendored files already stroke with
// currentColor, and .icon-btn's CSS sizes the svg, so no per-call sizing here.
export function createIcon(name) {
  const template = templates.get(name);
  if (!template) {
    console.warn(`icons.js: "${name}" was not preloaded (call preloadIcons() first)`);
    return document.createElement('span');
  }
  const svg = template.cloneNode(true);
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

// Scans for [data-icon="name"] elements already in index.html's static
// markup (top bar, tool rail, dialogs) and injects the matching SVG into
// each. Static HTML never duplicates icon markup — this is the one place
// it's resolved. Called once from main.js's boot(), after preloadIcons().
export function mountIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.prepend(createIcon(el.dataset.icon));
  }
}
