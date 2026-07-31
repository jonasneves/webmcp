// Provider/auth UI: model picker, API key form, GitHub OAuth connect button,
// local-Claude availability detection.

import { checkLocalClaudeReachable, checkTermd } from './providers.js';

// Pin the direct subdomain: the apex redirects and the intermediate hops strip
// Access-Control-Allow-Origin, so importing via a redirect fails CORS preflight.
// auth.neevs.io went NXDOMAIN when the host moved to neves.cloud; lib.js is the
// canonical module (connect.js is a back-compat shim).
//
// Loaded on demand, never as a top-level import. A static `import` from a remote
// URL couples this whole module to that host: the ES module graph resolves before
// any of it executes, so one dead URL means the page paints and registers nothing.
// That is exactly what NXDOMAIN did here — this demo shipped with zero tools
// registered while every build stayed green.
const AUTH_MODULE_URL = 'https://auth.neves.cloud/lib.js';

const STORAGE = {
  apiKey: 'webmcp-api-key',
  openaiKey: 'webmcp-openai-key',
  ghAuth: 'webmcp-gh-auth',
  model: 'webmcp-model',
  ghNoticeDismissed: 'webmcp-github-notice-dismissed',
};

let state;  // { currentProvider, githubAuth, ghOAuthScope }
let listeners = { onProviderChange: () => {} };

export function getProvider() { return state.currentProvider; }
export function getGitHubAuth() { return state.githubAuth; }
export function getApiKey() { return document.getElementById('api-key')?.value.trim() || ''; }
export function getOpenAIKey() { return document.getElementById('openai-key')?.value.trim() || ''; }
export function getSelectedModel() { return document.getElementById('model-select').value; }
export function getSelectedModelName() {
  return getSelectedModel().split(':').slice(1).join(':');
}

export function initAuth({ onProviderChange, ghOAuthScope, defaultModel = 'anthropic:claude-haiku-4-5' }) {
  state = {
    currentProvider: 'anthropic',
    githubAuth: JSON.parse(localStorage.getItem(STORAGE.ghAuth) || 'null'),
    ghOAuthScope,
  };
  listeners.onProviderChange = onProviderChange;

  const modelSelect = document.getElementById('model-select');
  const apiKeyInput = document.getElementById('api-key');
  const localOption = modelSelect.querySelector('option[value="local:claude"]');
  const termdOption = modelSelect.querySelector('option[value="termd:agent"]');

  // Restore API key from localStorage, then attempt config.json override
  // (only meaningful on localhost dev).
  apiKeyInput.value = localStorage.getItem(STORAGE.apiKey) || '';
  const openaiKeyInput = document.getElementById('openai-key');
  if (openaiKeyInput) {
    openaiKeyInput.value = localStorage.getItem(STORAGE.openaiKey) || '';
    openaiKeyInput.addEventListener('input', () => localStorage.setItem(STORAGE.openaiKey, openaiKeyInput.value));
  }
  (location.protocol === 'https:' ? Promise.resolve(null) : fetch('config.json'))
    .then(r => (r && r.ok) ? r.json() : null)
    .then(cfg => {
      if (cfg?.apiKey && !apiKeyInput.value) {
        apiKeyInput.value = cfg.apiKey;
        localStorage.setItem(STORAGE.apiKey, cfg.apiKey);
      }
    })
    .catch(() => {});

  // Both localhost providers are hidden until they answer, so the menu never
  // offers something that cannot work from this page.
  Promise.all([checkLocalClaudeReachable(), checkTermd()]).then(([reachable, termdUp]) => {
    if (localOption) localOption.hidden = !reachable;
    if (termdOption) termdOption.hidden = !termdUp;
    const saved = localStorage.getItem(STORAGE.model) || defaultModel;
    // A stored id that no longer exists as an option (a retired model, or one
    // that lost its date suffix) would leave the select blank while
    // currentProvider was read from the stale string. Fall back instead.
    const known = [...modelSelect.options].some(o => o.value === saved);
    const unreachable = (!reachable && saved === 'local:claude') || (!termdUp && saved === 'termd:agent');
    const value = (!known || unreachable) ? defaultModel : saved;
    modelSelect.value = value;
    localStorage.setItem(STORAGE.model, value);
    state.currentProvider = value.split(':')[0];
    applyProviderUI();
  });

  modelSelect.addEventListener('change', () => {
    state.currentProvider = modelSelect.value.split(':')[0];
    localStorage.setItem(STORAGE.model, modelSelect.value);
    applyProviderUI();
    listeners.onProviderChange();
  });

  apiKeyInput.addEventListener('input', () => {
    localStorage.setItem(STORAGE.apiKey, apiKeyInput.value);
  });
  document.getElementById('key-save')?.addEventListener('click', () => {
    localStorage.setItem(STORAGE.apiKey, apiKeyInput.value);
  });
  document.getElementById('github-notice-dismiss')?.addEventListener('click', () => {
    localStorage.setItem(STORAGE.ghNoticeDismissed, '1');
    document.getElementById('github-notice').hidden = true;
  });
}

export function applyProviderUI() {
  const isLocal = state.currentProvider === 'local';
  const isGitHub = state.currentProvider === 'github';
  const isOpenAI = state.currentProvider === 'openai';
  const isTermd = state.currentProvider === 'termd';

  const claudeBar = document.getElementById('chat-claude-bar');
  if (claudeBar) claudeBar.hidden = isLocal || isGitHub || isOpenAI || isTermd;

  const openaiBar = document.getElementById('chat-openai-bar');
  if (openaiBar) openaiBar.hidden = !isOpenAI;

  updateGitHubAuthBar();

  const notice = document.getElementById('github-notice');
  if (notice) notice.hidden = !isGitHub || !!localStorage.getItem(STORAGE.ghNoticeDismissed);

  updateModelLabel();
}

function updateModelLabel() {
  const label = document.getElementById('chat-model-label');
  const modelSelect = document.getElementById('model-select');
  if (!label || !modelSelect) return;
  label.textContent = modelSelect.options[modelSelect.selectedIndex]?.text || '';
}

function updateGitHubAuthBar() {
  const bar = document.getElementById('github-auth-bar');
  if (!bar) return;
  bar.innerHTML = '';
  if (state.currentProvider !== 'github') return;

  if (state.githubAuth) {
    const label = document.createElement('span');
    label.className = 'github-user-label';
    label.textContent = `@${state.githubAuth.username}`;
    const disconnect = document.createElement('button');
    disconnect.className = 'github-disconnect-btn';
    disconnect.textContent = 'Disconnect';
    disconnect.addEventListener('click', () => {
      state.githubAuth = null;
      localStorage.removeItem(STORAGE.ghAuth);
      listeners.onProviderChange();
      updateGitHubAuthBar();
    });
    bar.append(label, disconnect);
  } else {
    const connect = document.createElement('button');
    connect.className = 'github-connect-btn';
    connect.textContent = 'Connect GitHub';
    connect.addEventListener('click', async () => {
      connect.textContent = 'Connecting\u2026';
      connect.disabled = true;
      try {
        let connectGitHub;
        try {
          ({ connectGitHub } = await import(AUTH_MODULE_URL));
        } catch {
          throw new Error(`GitHub sign-in unavailable (${AUTH_MODULE_URL} unreachable).`);
        }
        state.githubAuth = await connectGitHub('read:user', state.ghOAuthScope);
        localStorage.setItem(STORAGE.ghAuth, JSON.stringify(state.githubAuth));
        updateGitHubAuthBar();
      } catch (err) {
        connect.textContent = 'Connect GitHub';
        connect.disabled = false;
        if (err.message !== 'OAuth flow cancelled') {
          // Surface the error via the chat message system.
          const { appendMessage } = await import('./chat.js');
          appendMessage('error', err.message);
        }
      }
    });
    bar.appendChild(connect);
  }
}
