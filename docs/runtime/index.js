// WebMCP runtime — single entry. Demos call mount(config) with their tool
// definitions and page-context hooks; the runtime registers the tools
// (statically once, dynamically as state changes), renders the tools panel
// and source bar, and wires the settings popover. There is no embedded
// chat — tools are driven by whatever WebMCP-aware agent shares the tab.
//
// What lives where:
//   ui.js     — toast, dialogs, markdown
//   theme.js  — light/dark/system theme
//   tools.js  — document.modelContext mirror, tools-panel sidebar
//   source.js — data provenance: the source bar
//
// Per-demo: HTML structure, dataset, TOOL_DEFS, render functions,
//           hash routing, init.

import { initTheme } from './theme.js';
import { registerTools, listTools, syncToolsPanel, syncDynamicTools, initToolsToggle } from './tools.js';
import { renderSourceBar } from './source.js';
import { dismissToast } from './ui.js';

/**
 * Mount the runtime.
 *
 * @param {object} cfg
 * @param {Array}  cfg.tools                 Tool definitions (registered via document.modelContext)
 * @param {()=>Array} [cfg.getDynamicTools]  Optional: extra tools that depend on app state
 * @param {(tool)=>tool} [cfg.adjustTool]    Optional: rewrite a tool's schema based on current view
 * @param {()=>object} [cfg.dataSource]      Provenance of the loaded data — see source.js. Rendered
 *                                           under the header.
 */
export function mount(cfg) {
  initTheme();
  initSettingsPopover();

  registerTools(cfg.tools);

  // Tools refresh hook — call this after page state changes that should
  // affect what tools are exposed (a filter, a flag, a view change). Updates
  // both the visible panel and the live document.modelContext registration,
  // so an agent sharing the tab sees the same tool surface the panel shows.
  const refresh = () => {
    let snapshot = listTools();
    if (cfg.adjustTool) snapshot = snapshot.map(cfg.adjustTool);
    if (cfg.getDynamicTools) snapshot = [...snapshot, ...cfg.getDynamicTools()];
    syncToolsPanel(snapshot);
    syncDynamicTools(snapshot);
    // Same hook the demos already call after every render, so the bar fills in
    // when the fetch lands and its relative timestamp stays honest afterwards.
    renderSourceBar(cfg.dataSource);
  };
  refresh();
  initToolsToggle();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const sp = document.getElementById('settings-popover');
      const sb = document.getElementById('settings-btn');
      if (sp && !sp.hidden) {
        sp.hidden = true;
        sb?.setAttribute('aria-expanded', 'false');
        sb?.focus();
        return;
      }
      const panel = document.getElementById('tools-panel');
      if (panel?.dataset.collapsed === 'false') {
        document.getElementById('tools-toggle').click();
        return;
      }
      dismissToast();
    }
  });

  return { refresh };
}

function initSettingsPopover() {
  const btn = document.getElementById('settings-btn');
  const popover = document.getElementById('settings-popover');
  if (!btn || !popover) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = popover.hidden;
    popover.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!popover.hidden && !popover.contains(e.target) && e.target !== btn) {
      popover.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

// Re-exports for demos that want individual primitives.
export { readInitialTheme } from './theme.js';
export { showToast, showConfirmDialog, showPromptDialog } from './ui.js';
