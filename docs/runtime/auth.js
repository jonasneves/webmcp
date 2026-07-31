// Provider/auth UI: model picker, API key form, local-Claude availability
// detection.

import { checkLocalClaudeReachable, checkTermd } from './providers.js';

const STORAGE = {
  apiKey: 'webmcp-api-key',
  openaiKey: 'webmcp-openai-key',
  model: 'webmcp-model',
};

// GitHub Models was retired on 2026-07-30 (playground, catalog, inference API
// and BYOK, for everyone). The provider is gone, so the OAuth token it needed is
// too — drop any copy a returning visitor still has rather than leaving a live
// GitHub credential in localStorage that nothing reads.
const RETIRED_KEYS = ['webmcp-gh-auth', 'webmcp-github-notice-dismissed'];

let state;  // { currentProvider }
let listeners = { onProviderChange: () => {} };

export function getProvider() { return state.currentProvider; }
export function getApiKey() { return document.getElementById('api-key')?.value.trim() || ''; }
export function getOpenAIKey() { return document.getElementById('openai-key')?.value.trim() || ''; }
export function getSelectedModel() { return document.getElementById('model-select').value; }
export function getSelectedModelName() {
  return getSelectedModel().split(':').slice(1).join(':');
}

export function initAuth({ onProviderChange, defaultModel = 'anthropic:claude-haiku-4-5' }) {
  state = { currentProvider: 'anthropic' };
  listeners.onProviderChange = onProviderChange;
  for (const k of RETIRED_KEYS) localStorage.removeItem(k);

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
}

export function applyProviderUI() {
  const isOpenAI = state.currentProvider === 'openai';

  const claudeBar = document.getElementById('chat-claude-bar');
  if (claudeBar) claudeBar.hidden = state.currentProvider !== 'anthropic';

  const openaiBar = document.getElementById('chat-openai-bar');
  if (openaiBar) openaiBar.hidden = !isOpenAI;

  updateModelLabel();
}

function updateModelLabel() {
  const label = document.getElementById('chat-model-label');
  const modelSelect = document.getElementById('model-select');
  if (!label || !modelSelect) return;
  label.textContent = modelSelect.options[modelSelect.selectedIndex]?.text || '';
}
