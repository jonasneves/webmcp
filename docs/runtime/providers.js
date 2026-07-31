// Provider adapters: stream Claude (Anthropic) and OpenAI, parse SSE.
//
// Three transports for Claude:
//   1. Direct fetch to api.anthropic.com (browser → user's API key)
//   2. Local proxy at 127.0.0.1:7337 (works on localhost; HTTPS pages can't
//      reach it because of mixed content — that's where ai-bridge comes in)
//   3. ai-bridge Chrome extension via DOM events (works on github.io)
//
// The bridge is auto-detected; when present and the user picked "local",
// we use it. Otherwise we fall through to the HTTP localhost proxy.

export const LOCAL_PROXY_URL = 'http://127.0.0.1:7337/v1/messages';
export const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
// termd runs the whole agent loop on the operator's own machine and hands tool
// calls back to us.
//
// It only works SAME-ORIGIN — i.e. when these pages are served by the daemon
// itself. termd sends no CORS headers, deliberately: it has no authentication,
// and anything that can reach its port gets a shell as the operator, so the
// same-origin policy is the gate. A page on any other origin (including another
// port on localhost, and every https:// deploy) cannot call it, and the option
// below stays hidden because the probe fails. Don't "fix" that by loosening CORS
// on the daemon; serve the page from it instead.
// Overridable so a second daemon (a dev build on another port) can be pointed at
// without editing source: localStorage['webmcp-termd-url'].
export const TERMD_URL = (() => {
  try { return localStorage.getItem('webmcp-termd-url') || 'http://127.0.0.1:5000'; }
  catch { return 'http://127.0.0.1:5000'; }
})();

let aiBridgeAvailable = false;
window.addEventListener('message', (e) => {
  if (e.data?.type === 'ai-bridge-ready') aiBridgeAvailable = true;
});

export function probeAiBridge() {
  return new Promise((resolve) => {
    const id = '_probe_' + Math.random().toString(36).slice(2);
    const onPing = (e) => {
      if (e.detail?._id !== id) return;
      clearTimeout(timer);
      document.removeEventListener('ai-bridge-response', onPing);
      aiBridgeAvailable = !!e.detail.ok;
      resolve(aiBridgeAvailable);
    };
    const timer = setTimeout(() => {
      document.removeEventListener('ai-bridge-response', onPing);
      resolve(aiBridgeAvailable);
    }, 400);
    document.addEventListener('ai-bridge-response', onPing);
    document.dispatchEvent(new CustomEvent('ai-bridge-request', { detail: { type: 'ping', _id: id } }));
  });
}

// Mixed content: an https page cannot reach http://127.0.0.1 at all, so the
// probe can only fail — noisily, in every visitor's console. Skip it there.
export const localhostReachable = () => location.protocol !== 'https:';

export async function checkLocalProxy() {
  if (!localhostReachable()) return false;
  try {
    const res = await fetch(LOCAL_PROXY_URL, { method: 'OPTIONS', signal: AbortSignal.timeout(800) });
    return res.status === 204;
  } catch { return false; }
}

export async function checkLocalClaudeReachable() {
  const [http, bridge] = await Promise.all([checkLocalProxy(), probeAiBridge()]);
  return http || bridge;
}

// Wrap the extension's port-stream chunks as a ReadableStream so the SSE
// parser path doesn't care about transport.
function streamClaudeViaBridge(body, signal) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const encoder = new TextEncoder();
    let controller = null;

    const cleanup = () => {
      document.removeEventListener('ai-bridge-response', onResponse);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      document.dispatchEvent(new CustomEvent('ai-bridge-abort', { detail: { _id: id } }));
      try { controller?.error(new DOMException('Aborted', 'AbortError')); } catch {}
    };
    const onResponse = (e) => {
      if (e.detail?._id !== id) return;
      if (e.detail.error) {
        cleanup();
        const msg = e.detail.status ? `API ${e.detail.status}: ${(e.detail.body || '').slice(0, 200)}` : e.detail.error;
        try { controller?.error(new Error(msg)); } catch {}
        reject(new Error(msg));
        return;
      }
      if (e.detail.chunk) controller?.enqueue(encoder.encode(e.detail.chunk));
      if (e.detail.done) { cleanup(); try { controller?.close(); } catch {} }
    };

    signal?.addEventListener('abort', onAbort);
    document.addEventListener('ai-bridge-response', onResponse);

    const stream = new ReadableStream({
      start(c) { controller = c; },
      cancel() { onAbort(); }
    });
    document.dispatchEvent(new CustomEvent('ai-bridge-request', {
      detail: { _id: id, provider: 'claude', path: '/v1/messages', method: 'POST', stream: true, body }
    }));
    resolve(stream);
  });
}

export async function streamClaudeAPI({ apiKey, model, messages, system, tools, signal, transport }) {
  // Thinking shares this budget on Sonnet 5 / Opus 5, and the response is
  // streamed, so a tight cap truncates mid-answer for no benefit.
  const body = { model, max_tokens: 16000, system, messages, tools, stream: true };

  if (transport === 'local' && aiBridgeAvailable) {
    return streamClaudeViaBridge(body, signal);
  }

  const proxy = transport === 'local';
  const url = proxy ? LOCAL_PROXY_URL : 'https://api.anthropic.com/v1/messages';
  const headers = { 'Content-Type': 'application/json' };
  if (!proxy) {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  const res = await fetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`API ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.body;
}

/* api.openai.com allows browser calls (it echoes the page origin and permits an
 * Authorization header), so a user's own key needs no proxy. */
async function streamChatCompletions({ token, model, messages, tools, signal }) {
  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: tools?.length ? 'auto' : undefined,
      max_completion_tokens: 1024,
      stream: true
    })
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.body;
}

// The bridge extension (termd/extension) runs on its own origin with
// host_permissions, so it can reach 127.0.0.1 when this page cannot. Same shape
// as the ai-bridge relay above, minus the DOM-event hop: externally_connectable
// lets the page hold a port to the extension directly.
export const TERMD_EXTENSION_ID = 'mgcgjhbjenjaboahijedcngmgigofkhh';

let termdPort = null;
function getTermdPort() {
  if (termdPort) return termdPort;
  if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return null;
  try {
    termdPort = chrome.runtime.connect(TERMD_EXTENSION_ID);
    termdPort.onDisconnect.addListener(() => { termdPort = null; });
  } catch { termdPort = null; }
  return termdPort;
}

const newId = () => Math.random().toString(36).slice(2);

function bridgeSend(msg, { onChunk } = {}) {
  return new Promise((resolve, reject) => {
    const port = getTermdPort();
    if (!port) return reject(new Error('no bridge'));
    const id = newId();
    const onMessage = (m) => {
      if (m.id !== id) return;
      if (m.type === 'chunk') return onChunk?.(m.text);
      port.onMessage.removeListener(onMessage);
      if (m.type === 'error') reject(new Error(m.status ? `termd ${m.status}: ${(m.body || '').slice(0, 200)}` : m.error));
      else resolve(m);
    };
    port.onMessage.addListener(onMessage);
    port.postMessage({ ...msg, id });
  });
}

export async function checkTermd() {
  // Bridge first: it is the only path that works from an https page.
  try {
    const pong = await Promise.race([
      bridgeSend({ type: 'ping' }),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 600)),
    ]);
    if (pong?.type === 'pong') return true;
  } catch { /* fall through to the direct probe */ }
  if (!localhostReachable()) return false;
  try {
    const res = await fetch(`${TERMD_URL}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch { return false; }
}

/* Unlike the other providers this is not a model API. termd owns the
 * conversation, the history and the agent loop; we hand it a prompt plus the
 * page's tool definitions and answer the tool calls it streams back. */
export async function streamTermdAgent({ prompt, tools, cwd, model, signal }) {
  // 'default' lets the daemon's own TERMD_MODEL decide.
  const body = { prompt, tools, cwd, maxTurns: 24, ...(model && model !== 'default' ? { model } : {}) };
  if (getTermdPort()) {
    // Re-expose the bridge's chunks as a ReadableStream so the SSE parser does
    // not care which transport delivered them.
    let controller = null;
    const stream = new ReadableStream({ start(c) { controller = c; } });
    const enc = new TextEncoder();
    bridgeSend({ type: 'request', path: '/agent/stream', body },
               { onChunk: (t) => controller?.enqueue(enc.encode(t)) })
      .then(() => { try { controller?.close(); } catch {} })
      .catch((e) => { try { controller?.error(e); } catch {} });
    signal?.addEventListener('abort', () => { try { controller?.close(); } catch {} }, { once: true });
    return stream;
  }
  const res = await fetch(`${TERMD_URL}/agent/stream`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`termd ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.body;
}

/* Answer a parked tool call. A 404 means the call already settled — it timed
 * out, or the turn ended — so the caller should stop rather than retry. */
export async function answerTermdTool(token, result) {
  const path = `/agent/tool/${encodeURIComponent(token)}`;
  if (getTermdPort()) {
    try { await bridgeSend({ type: 'request', path, body: result }); return true; }
    catch { return false; }
  }
  const res = await fetch(`${TERMD_URL}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  });
  return res.ok;
}

export function streamOpenAIAPI({ apiKey, model, messages, tools, signal }) {
  if (!apiKey) throw new Error('Add an OpenAI API key in settings (sk-…).');
  return streamChatCompletions({ token: apiKey, model, messages, tools, signal });
}

async function* readStreamLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) yield line;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* parseSSEStream(body) {
  let currentEvent = null;
  for await (const line of readStreamLines(body)) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ') && currentEvent) {
      // Each SSE data: line is supposed to be complete JSON for that event.
      // Bad JSON shouldn't kill the stream, but it shouldn't be silent either.
      try { yield { event: currentEvent, data: JSON.parse(line.slice(6)) }; }
      catch (err) { console.warn('[providers] dropped malformed SSE event:', currentEvent, err); }
      currentEvent = null;
    }
  }
}

export async function* parseOpenAIStream(body) {
  for await (const line of readStreamLines(body)) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') return;
    try { yield JSON.parse(payload); }
    catch (err) { console.warn('[providers] dropped malformed OpenAI chunk:', err); }
  }
}
