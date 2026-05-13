// Provider adapters: stream Claude (Anthropic) and GitHub Models, parse SSE.
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
export const GITHUB_API_URL = 'https://models.github.ai/inference/chat/completions';

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

export async function checkLocalProxy() {
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
  const body = { model, max_tokens: 1024, system, messages, tools, stream: true };

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

export async function streamGitHubModelsAPI({ token, model, messages, tools, signal }) {
  const res = await fetch(GITHUB_API_URL, {
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
    throw new Error(`GitHub API ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.body;
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
