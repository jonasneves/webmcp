// Tool registry + navigator.modelContext polyfill + tools panel renderer.
//
// The polyfill makes the page conform to the WebMCP spec shape: pages
// register tools via navigator.modelContext.registerTool, and the runtime
// reads them through navigator.modelContext.tools. Native browsers that
// ship WebMCP later expose the same surface — at which point this polyfill
// becomes a no-op (we check for an existing implementation first).
//
// Spec: https://webmachinelearning.github.io/webmcp/

const registry = new Map();  // name -> tool definition

function ensurePolyfill() {
  if (navigator.modelContext) return;
  navigator.modelContext = {
    registerTool(def) { registry.set(def.name, def); },
    unregisterTool(name) { registry.delete(name); },
    clearContext() { registry.clear(); },
    provideContext(_context) { /* reserved — used by the spec for ambient context */ },
    get tools() { return [...registry.values()]; },
  };
}

ensurePolyfill();

export function registerTools(defs) {
  defs.forEach(d => navigator.modelContext.registerTool(d));
}

export function listTools() {
  return navigator.modelContext.tools;
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

function renderToolsPanel(tools, newNames) {
  const inner = document.getElementById('tools-panel-inner');
  const toggle = document.getElementById('tools-toggle');
  const panel = document.getElementById('tools-panel');
  if (!inner || !toggle || !panel) return;
  const collapsed = panel.dataset.collapsed === 'true';
  toggle.innerHTML = `${collapsed ? '&#9660;' : '&#9650;'} ${tools.length} tools`;

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
    const desc = (t.description || '').split('.')[0] + '.';

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
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const panel = document.getElementById('tools-panel');
    const collapsed = panel.dataset.collapsed === 'true';
    panel.dataset.collapsed = collapsed ? 'false' : 'true';
    toggle.setAttribute('aria-expanded', String(collapsed));
    const tools = listTools();
    toggle.innerHTML = `${collapsed ? '&#9650;' : '&#9660;'} ${tools.length} tools`;
  });
}

// Adapters for upstream API tool-call shapes.
export function toAnthropicTools(tools) {
  return tools.map(t => ({ name: t.name, description: t.description, input_schema: t.schema }));
}
export function toOpenAITools(tools) {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.schema || { type: 'object', properties: {} } }
  }));
}
