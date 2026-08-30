// Tool registry, native WebMCP mirror, and tools panel renderer.
//
// We keep an internal registry of the full tool definitions (with `exec`,
// `schema`, trust hints for the panel, etc.) — the page's own UI reads from
// it directly via listTools(). Whatever WebMCP-aware agent is sharing the
// tab never sees this registry; it only sees what we mirror through
// document.modelContext.registerTool(), so that mirror is kept to the
// actual spec shape (inputSchema/execute/annotations.readOnlyHint), not
// our richer internal one.
//
// No polyfill is installed here. If nothing on the page already provides
// document.modelContext (native support, an origin-trial token, or an
// extension that injects one before this script runs), mirroring is a
// silent no-op — the feature-detect the spec itself recommends.
//
// Spec: https://webmachinelearning.github.io/webmcp/

const registry = new Map();          // name -> internal tool def (schema/exec/panel hints)
const nativeControllers = new Map(); // name -> AbortController backing its native registration
const nativeShapes = new Map();      // name -> last-mirrored shape fingerprint, to skip no-op re-registers
const dynamicNames = new Set();      // names mirrored natively that aren't in `registry` (state-only tools)

// registerTool() throws InvalidStateError on a name that's already
// registered, and the only way to replace one is to abort the
// AbortController passed at registration time — there is no public
// unregister/update method. So every native registration carries its own
// controller, and updating a tool means aborting the old one before
// registering the new.
function toSpecShape(def) {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.schema || { type: 'object', properties: {} },
    annotations: { readOnlyHint: !!def.readOnlyHint },
    execute: def.exec,
  };
}

function mirrorToNative(def) {
  if (!('modelContext' in document)) return; // no WebMCP support in this browser — silent no-op, per the spec's own feature-detect guidance
  const spec = toSpecShape(def);
  const shapeKey = JSON.stringify({ d: spec.description, s: spec.inputSchema, a: spec.annotations });
  if (nativeShapes.get(def.name) === shapeKey) return; // unchanged since last mirror — don't re-register for nothing
  nativeControllers.get(def.name)?.abort();
  const controller = new AbortController();
  nativeControllers.set(def.name, controller);
  nativeShapes.set(def.name, shapeKey);
  document.modelContext.registerTool(spec, { signal: controller.signal })
    .catch(err => {
      // Superseding a tool means aborting its old registration's signal,
      // which rejects that old registerTool() call with AbortError — the
      // expected shape of "cancel and replace", not a real failure.
      if (err.name === 'AbortError') return;
      console.warn('[tools] native registerTool rejected', def.name, err);
    });
}

function unmirrorFromNative(name) {
  nativeControllers.get(name)?.abort();
  nativeControllers.delete(name);
  nativeShapes.delete(name);
}

// Static tools: registered once, mirrored once. Call at mount with the
// page's fixed TOOL_DEFS.
export function registerTools(defs) {
  for (const d of defs) {
    registry.set(d.name, d);
    mirrorToNative(d);
  }
}

// State-dependent tools: call from `refresh()` with the same snapshot the
// tools panel renders (adjustTool-rewritten + getDynamicTools() entries).
// Unchanged tools no-op via the shape-diff cache above; a tool whose schema
// actually changed (e.g. compare_countries' enum) gets unregistered and
// re-registered; a dynamic tool no longer in the list (e.g. clear_all_flags
// after the last flag is removed) gets unregistered.
export function syncDynamicTools(effectiveList) {
  const desired = new Set(effectiveList.map(t => t.name));
  for (const name of [...dynamicNames]) {
    if (!desired.has(name)) { unmirrorFromNative(name); dynamicNames.delete(name); }
  }
  for (const t of effectiveList) {
    mirrorToNative(t);
    if (!registry.has(t.name)) dynamicNames.add(t.name);
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
