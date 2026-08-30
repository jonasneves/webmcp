// Discovery panel: a collapsed-by-default drawer with two views — Guide
// (what this page is, what to try) and Activity (a live log of every tool
// call, from whichever agent is sharing the tab). Neither view is
// required reading; the edge tab stays out of the way until opened.
//
// Activity listens for `webmcp-tool-call` (tools.js), which fires once
// per settled call regardless of caller — a human clicking the page's own
// controls never fires it, since those call render functions directly,
// not a tool's exec.

const MAX_ACTIVITY = 50;
let activityEntries = [];
let activityInitialized = false;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderGuide(el, guide) {
  if (!el || !guide) return;
  el.innerHTML = `
    <p class="discovery-intro">${guide.intro}</p>
    ${guide.prompts?.length ? `
      <p class="discovery-section-label">Try asking</p>
      <ul class="discovery-prompts">${guide.prompts.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
    ` : ''}
  `;
}

function renderActivity(el) {
  if (!el) return;
  if (!activityEntries.length) {
    el.innerHTML = `<p class="discovery-empty">Nothing yet — this fills in as an agent sharing the tab calls a tool.</p>`;
    return;
  }
  el.innerHTML = activityEntries.map(entry => {
    const time = new Date(entry.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const summary = entry.error || entry.result?.summary || '';
    return `
      <div class="discovery-activity-item${entry.error ? ' error' : ''}">
        <div class="discovery-activity-head">
          <span class="discovery-activity-name">${escapeHtml(entry.name)}</span>
          <span class="discovery-activity-time">${time}</span>
        </div>
        ${summary ? `<div class="discovery-activity-summary">${escapeHtml(summary)}</div>` : ''}
      </div>
    `;
  }).join('');
}

export function initDiscoveryPanel(guide) {
  const tab = document.getElementById('discovery-tab');
  const panel = document.getElementById('discovery-panel');
  const guideEl = document.getElementById('discovery-guide');
  const activityEl = document.getElementById('discovery-activity');
  if (!tab || !panel || !guideEl || !activityEl) return;

  renderGuide(guideEl, guide);
  renderActivity(activityEl); // seeds the empty state

  tab.addEventListener('click', () => {
    const collapsed = panel.dataset.collapsed !== 'false';
    panel.dataset.collapsed = collapsed ? 'false' : 'true';
    tab.setAttribute('aria-expanded', String(collapsed));
  });

  panel.querySelectorAll('.discovery-panel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.discovery-panel-tab').forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });
      guideEl.hidden = btn.dataset.view !== 'guide';
      activityEl.hidden = btn.dataset.view !== 'activity';
    });
  });

  if (!activityInitialized) {
    activityInitialized = true;
    document.addEventListener('webmcp-tool-call', (e) => {
      activityEntries = [e.detail, ...activityEntries].slice(0, MAX_ACTIVITY);
      // Only touch the DOM if a panel is actually mounted to read it —
      // avoids rendering into a detached tree if this ever fires before init.
      const el = document.getElementById('discovery-activity');
      if (el) renderActivity(el);
    });
  }
}
