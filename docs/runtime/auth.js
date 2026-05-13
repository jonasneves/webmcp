// Provider/auth UI: model picker, API key form, GitHub OAuth connect button,
// local-Claude availability detection.

// Direct subdomain — the apex (neevs.io) redirects through neves.cloud and
// the intermediate hops strip the Access-Control-Allow-Origin header, so
// any page that imports from /auth/ fails CORS preflight. Pin the final URL.
import { connectGitHub } from 'https://auth.neevs.io/connect.js';
import { checkLocalClaudeReachable } from './providers.js';

const STORAGE = {
  apiKey: 'webmcp-api-key',
  ghAuth: 'webmcp-gh-auth',
  model: 'webmcp-model',
  ghNoticeDismissed: 'webmcp-github-notice-dismissed',
};

let state;  // { currentProvider, githubAuth, ghOAuthScope }
let listeners = { onProviderChange: () => {} };

export function getProvider() { return state.currentProvider; }
export function getGitHubAuth() { return state.githubAuth; }
export function getApiKey() { return document.getElementById('api-key')?.value.trim() || ''; }
export function getSelectedModel() { return document.getElementById('model-select').value; }
export function getSelectedModelName() {
  return getSelectedModel().split(':').slice(1).join(':');
}

export function initAuth({ onProviderChange, ghOAuthScope, defaultModel = 'anthropic:claude-haiku-4-5-20251001' }) {
  state = {
    currentProvider: 'anthropic',
    githubAuth: JSON.parse(localStorage.getItem(STORAGE.ghAuth) || 'null'),
    ghOAuthScope,
  };
  listeners.onProviderChange = onProviderChange;

  const modelSelect = document.getElementById('model-select');
  const apiKeyInput = document.getElementById('api-key');
  const localOption = modelSelect.querySelector('option[value="local:claude"]');

  // Restore API key from localStorage, then attempt config.json override
  // (only meaningful on localhost dev).
  apiKeyInput.value = localStorage.getItem(STORAGE.apiKey) || '';
  fetch('config.json')
    .then(r => r.ok ? r.json() : null)
    .then(cfg => {
      if (cfg?.apiKey && !apiKeyInput.value) {
        apiKeyInput.value = cfg.apiKey;
        localStorage.setItem(STORAGE.apiKey, cfg.apiKey);
      }
    })
    .catch(() => {});

  checkLocalClaudeReachable().then(reachable => {
    if (localOption) localOption.hidden = !reachable;
    const saved = localStorage.getItem(STORAGE.model) || defaultModel;
    const value = (!reachable && saved === 'local:claude') ? defaultModel : saved;
    modelSelect.value = value;
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

  const claudeBar = document.getElementById('chat-claude-bar');
  if (claudeBar) claudeBar.hidden = isLocal || isGitHub;

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
