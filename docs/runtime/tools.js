// Tool registry + navigator.modelContext polyfill + tools panel renderer.
//
// We keep an internal registry of the full tool definitions (with `exec`,
// `schema`, trust hints, etc.) — the runtime reads from it directly. If the
// browser ships native WebMCP we *also* register a spec-adapted view so
// browser AI agents can discover the same tools through the standard API.
//
// Spec: https://webmachinelearning.github.io/webmcp/

const registry = new Map();  // name -> full tool def (internal shape)

// Polyfill: install only if the browser doesn't already have a native
// implementation. The polyfill mirrors what we'd want browsers to expose.
export const mcHost = ('modelContext' in document) ? document
  : ('modelContext' in navigator) ? navigator
  : document;

if (!mcHost.modelContext) {
  mcHost.modelContext = {
    registerTool(def) { /* spec view, no-op storage */ },
    unregisterTool(_name) {},
    clearContext() {},
    provideContext(_ctx) {},
    get tools() { return [...registry.values()].map(toSpecShape); },
  };
}

// Translate our internal tool shape into what native WebMCP expects.
// Spec uses `inputSchema` + `execute`; we carry `schema` + `exec` plus
// presentation hints the spec doesn't define.
function toSpecShape(def) {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.schema,
    execute: def.exec,
    annotations: {
      title: def.title,
      readOnlyHint: def.readOnlyHint,
      idempotentHint: def.idempotentHint,
      destructiveHint: def.destructiveHint,
      openWorldHint: def.openWorldHint,
    },
  };
}

export function registerTools(defs) {
  for (const d of defs) {
    registry.set(d.name, d);
    // Best-effort mirror to native. Specs and browser implementations are
    // still in flux — if validation rejects our adapted shape, log and
    // continue rather than break the page.
    try { mcHost.modelContext.registerTool(toSpecShape(d)); }
    catch (err) { console.warn('[tools] native registerTool rejected', d.name, err); }
  }
}

export function listTools() {
  return [...registry.values()];
}

// Tools panel UI — surfaces what's currently registered + their trust
// annotations. New tools get a fade-in highlight via .new.

let previousToolNames = new Set();
let toolsInitialized = false;

export function syncToolsPanel(tools) {
  const currentNames = new Set(tools.map(t => t.name));
  const newNames = toolsInitialized
    ? new Set([...currentNames].filter(n => !previousToolNames.has(n)))
    : new Set();
  previousToolNames = currentNames;
  renderToolsPanel(tools, newNames);
  toolsInitialized = true;
}

// First sentence of a description. Split on a period that's actually a
// sentence boundary (followed by whitespace or end-of-string) rather than
// the first '.' anywhere — descriptions routinely carry ".ext" tokens
// (".stl") that would otherwise truncate mid-sentence. No boundary found:
// fall back to the whole string rather than guess.
function firstSentence(text) {
  const m = text.match(/\.(\s|$)/);
  return m ? text.slice(0, m.index + 1) : text;
}

// Trigger label is two spans — caret + count — instead of one text node, so
// the caret can be targeted by CSS (rotation on open) independent of the
// count text. Shared across every write-site so they can't drift.
function setToggleLabel(toggle, count) {
  toggle.innerHTML =
    `<span class="tools-toggle-caret">&#9660;</span>` +
    `<span class="tools-toggle-count">${count} tools</span>`;
}

function renderToolsPanel(tools, newNames) {
  const inner = document.getElementById('tools-panel-inner');
  const toggle = document.getElementById('tools-toggle');
  const panel = document.getElementById('tools-panel');
  if (!inner || !toggle || !panel) return;
  setToggleLabel(toggle, tools.length);

  inner.innerHTML = tools.map(t => {
    const badges = [];
    if (t.readOnlyHint) badges.push('<span class="annotation-badge read-only">read-only</span>');
    if (t.idempotentHint) badges.push('<span class="annotation-badge idempotent">idempotent</span>');
    if (t.destructiveHint) badges.push('<span class="annotation-badge destructive">destructive</span>');
    if (!t.openWorldHint) badges.push('<span class="annotation-badge closed-world">closed-world</span>');

    const isNew = newNames.has(t.name);
    const enumProp = Object.entries(t.schema?.properties || {}).find(([, v]) => v.enum);
    const paramsHtml = enumProp
      ? `<div class="tool-item-params">${enumProp[1].enum.length} options available</div>`
      : '';
    const desc = firstSentence(t.description || '');

    return `
      <div class="tool-item${isNew ? ' new' : ''}">
        <div class="tool-item-name">${t.name}</div>
        <div class="tool-item-badges">${badges.join('')}</div>
        <div class="tool-item-desc">${desc}</div>
        ${paramsHtml}
      </div>
    `;
  }).join('');
}

export function initToolsToggle() {
  const toggle = document.getElementById('tools-toggle');
  const panel = document.getElementById('tools-panel');
  if (!toggle || !panel) return;
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const collapsed = panel.dataset.collapsed === 'true';
    panel.dataset.collapsed = collapsed ? 'false' : 'true';
    toggle.setAttribute('aria-expanded', String(collapsed));
    setToggleLabel(toggle, listTools().length);
  });
  // Same dismiss-on-outside-click as the settings popover (index.js) — the
  // toggle click above stops propagation, so this only ever sees clicks
  // that land outside both the panel and its trigger.
  document.addEventListener('click', (e) => {
    if (panel.dataset.collapsed === 'false' && !panel.contains(e.target) && e.target !== toggle) {
      panel.dataset.collapsed = 'true';
      toggle.setAttribute('aria-expanded', 'false');
      setToggleLabel(toggle, listTools().length);
    }
  });
}
