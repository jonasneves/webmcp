// Agent loop: stream model → parse tool_use → gate on trust → execute →
// inject result → continue. One implementation, two providers via adapter.

import {
  streamClaudeAPI, streamGitHubModelsAPI, streamOpenAIAPI,
  streamTermdAgent, answerTermdTool,
  parseSSEStream, parseOpenAIStream,
} from './providers.js';
import {
  appendMessage, appendDivider, appendToolMsg,
  createPendingToolCard, resolveToolCard,
  hideSpinner, showSpinner,
} from './chat.js';
import { showConfirmDialog, scrollDisplayIntoView, renderMarkdown } from './ui.js';
import { toAnthropicTools, toOpenAITools, listTools } from './tools.js';
import { getProvider, getGitHubAuth, getApiKey, getOpenAIKey, getSelectedModelName } from './auth.js';

// Trust gate: prompt the user only for tools annotated as actually
// destructive. The previous gate fired on the absence of `readOnlyHint`,
// which meant any tool that hit an external API but wasn't explicitly marked
// read-only got a confirm prompt for no reason.
async function requestPermission(toolDef, args) {
  if (toolDef.destructiveHint === true) {
    return showConfirmDialog(toolDef.title || toolDef.name, args);
  }
  return true;
}

function findTool(name) {
  return listTools().find(t => t.name === name);
}

async function executeTool(name, input, pendingEl, getDividerContext) {
  const def = findTool(name);
  if (!def) {
    const result = { error: `Unknown tool: ${name}` };
    if (pendingEl) resolveToolCard(pendingEl, name, input, result.error, true);
    else appendToolMsg(name, input, result.error, true);
    return result;
  }

  const ok = await requestPermission(def, input);
  if (!ok) {
    const result = { summary: `User declined: ${def.title || def.name}` };
    if (pendingEl) resolveToolCard(pendingEl, name, input, result.summary, true);
    else appendToolMsg(name, input, result.summary, true);
    return result;
  }

  let result;
  try {
    // Pass a minimal client conforming to the WebMCP spec interaction shape.
    // requestUserInteraction lets a tool open a confirm/prompt dialog from
    // within its exec without the runtime baking in which one to call.
    const client = { requestUserInteraction: (cb) => cb() };
    result = await def.exec(input, client);
  } catch (err) {
    result = { error: err.message || String(err) };
    if (pendingEl) resolveToolCard(pendingEl, name, input, result.error, true);
    else appendToolMsg(name, input, result.error, true);
    return result;
  }

  const summary = result?.summary ?? '';
  if (pendingEl) resolveToolCard(pendingEl, name, input, summary, false);
  else appendToolMsg(name, input, summary, false);

  if (result?.displayed) {
    scrollDisplayIntoView();
    const ctx = getDividerContext();
    if (ctx?.length) appendDivider(ctx.join(' \u00b7 '));
  }
  return result;
}

// Claude / Anthropic loop ────────────────────────────────────────────────

async function runConversationClaude(messages, { signal, getSystemPrompt, getDividerContext, onComplete }) {
  const pendingToolCards = {};

  const transport = getProvider() === 'local' ? 'local' : 'direct';
  const apiKey = transport === 'local' ? null : getApiKey();
  const model = getSelectedModelName();

  while (true) {
    let body;
    try {
      body = await streamClaudeAPI({
        apiKey, model, messages,
        system: getSystemPrompt(),
        tools: toAnthropicTools(listTools()),
        signal, transport,
      });
    } catch (err) {
      hideSpinner();
      if (err.name === 'AbortError') return;
      appendMessage('error', err.message);
      return;
    }

    const contentBlocks = [];
    let currentTextEl = null;
    let currentTextContent = '';
    let currentToolInput = '';
    let currentBlockType = null;
    let rafId = 0;

    try {
      for await (const { event, data } of parseSSEStream(body)) {
        switch (event) {
          case 'content_block_start': {
            const block = data.content_block;
            currentBlockType = block.type;
            if (block.type === 'text') {
              hideSpinner();
              currentTextContent = block.text || '';
              currentTextEl = appendMessage('assistant', currentTextContent);
            } else if (block.type === 'thinking') {
              // Models from Sonnet 5 / Opus 5 on think by default. The block has to
              // be replayed to the same model unchanged — signature included — or the
              // next turn of a tool-use loop is rejected. `thinking` text is empty
              // unless display:"summarized" was requested; the signature still matters.
              contentBlocks.push({ type: 'thinking', thinking: block.thinking || '', signature: block.signature || '' });
            } else if (block.type === 'tool_use') {
              contentBlocks.push({ type: 'tool_use', id: block.id, name: block.name, input: {} });
              currentToolInput = '';
              hideSpinner();
              pendingToolCards[block.id] = createPendingToolCard(block.name);
            }
            break;
          }
          case 'content_block_delta': {
            if (data.delta.type === 'text_delta') {
              currentTextContent += data.delta.text;
              if (currentTextEl && !rafId) {
                rafId = requestAnimationFrame(() => {
                  rafId = 0;
                  if (currentTextEl) currentTextEl.innerHTML = renderMarkdown(currentTextContent);
                });
              }
            } else if (data.delta.type === 'input_json_delta') {
              currentToolInput += data.delta.partial_json;
            } else if (data.delta.type === 'thinking_delta') {
              const b = contentBlocks[contentBlocks.length - 1];
              if (b?.type === 'thinking') b.thinking += data.delta.thinking;
            } else if (data.delta.type === 'signature_delta') {
              const b = contentBlocks[contentBlocks.length - 1];
              if (b?.type === 'thinking') b.signature += data.delta.signature;
            }
            break;
          }
          case 'content_block_stop': {
            if (currentBlockType === 'text' && currentTextContent) {
              if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
              if (currentTextEl) currentTextEl.innerHTML = renderMarkdown(currentTextContent);
              contentBlocks.push({ type: 'text', text: currentTextContent });
              currentTextEl = null;
              currentTextContent = '';
            } else if (currentBlockType === 'tool_use') {
              const toolBlock = contentBlocks[contentBlocks.length - 1];
              try { toolBlock.input = currentToolInput ? JSON.parse(currentToolInput) : {}; }
              catch (err) {
                console.warn('[loop] malformed tool input JSON:', err);
                toolBlock.input = {};
              }
              currentToolInput = '';
            }
            currentBlockType = null;
            break;
          }
        }
      }
    } catch (err) {
      if (rafId) cancelAnimationFrame(rafId);
      hideSpinner();
      Object.values(pendingToolCards).forEach(el => el.remove());
      if (err.name === 'AbortError') return;
      appendMessage('error', 'Stream interrupted: ' + err.message);
      return;
    }
    if (rafId) cancelAnimationFrame(rafId);

    messages.push({ role: 'assistant', content: contentBlocks });

    const toolUses = contentBlocks.filter(b => b.type === 'tool_use');
    if (toolUses.length === 0) {
      hideSpinner();
      onComplete?.();
      return;
    }

    const toolResults = [];
    for (const tu of toolUses) {
      const pendingEl = pendingToolCards[tu.id];
      delete pendingToolCards[tu.id];
      const result = await executeTool(tu.name, tu.input, pendingEl, getDividerContext);
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: toolResults });
    showSpinner();
  }
}

// GitHub Models / OpenAI-shape loop ─────────────────────────────────────
//
// Both providers use the chat-completions wire format, so one loop drives
// them; `stream` decides whether the request carries a GitHub OAuth token or
// the user's own OpenAI key.

async function runConversationOpenAIShape(messages, { signal, getSystemPrompt, getDividerContext, onComplete }, stream) {
  const model = getSelectedModelName();

  while (true) {
    let body;
    try {
      body = await stream({
        model, signal,
        messages: [{ role: 'system', content: getSystemPrompt() }, ...messages],
        tools: toOpenAITools(listTools()),
      });
    } catch (err) {
      hideSpinner();
      if (err.name === 'AbortError') return;
      appendMessage('error', err.message);
      return;
    }

    let currentTextEl = null;
    let currentTextContent = '';
    let rafId = 0;
    const tcMap = {};

    try {
      for await (const chunk of parseOpenAIStream(body)) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          if (!currentTextEl) {
            hideSpinner();
            currentTextContent = '';
            currentTextEl = appendMessage('assistant', '');
          }
          currentTextContent += delta.content;
          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              rafId = 0;
              if (currentTextEl) currentTextEl.innerHTML = renderMarkdown(currentTextContent);
            });
          }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const entry = tcMap[tc.index] ?? (tcMap[tc.index] = { id: '', name: '', arguments: '' });
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.arguments += tc.function.arguments;
          }
        }
      }
    } catch (err) {
      if (rafId) cancelAnimationFrame(rafId);
      hideSpinner();
      if (err.name === 'AbortError') return;
      appendMessage('error', 'Stream interrupted: ' + err.message);
      return;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      if (currentTextEl) currentTextEl.innerHTML = renderMarkdown(currentTextContent);
    }

    const toolCalls = Object.values(tcMap);
    const assistantMsg = { role: 'assistant', content: currentTextContent || null };
    if (toolCalls.length) {
      assistantMsg.tool_calls = toolCalls.map(tc => ({
        id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments }
      }));
    }
    messages.push(assistantMsg);

    if (toolCalls.length === 0) {
      hideSpinner();
      onComplete?.();
      return;
    }

    for (const tc of toolCalls) {
      let args;
      try { args = JSON.parse(tc.arguments || '{}'); }
      catch (err) {
        console.warn('[loop] malformed tool_call arguments JSON:', err);
        args = {};
      }
      const pendingEl = createPendingToolCard(tc.name);
      const result = await executeTool(tc.name, args, pendingEl, getDividerContext);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
    showSpinner();
  }
}

// termd loop ────────────────────────────────────────────────────────────
//
// The odd one out: termd runs the agent loop on the operator's machine, so
// there is no history to carry and no tool_result to inject. We send the
// prompt with the page's tool definitions, then answer the calls that come
// back. executeTool is reused unchanged, which is the point — the trust gate
// and the tool cards behave the same whether the loop runs here or there.

async function runConversationTermd(messages, { signal, getSystemPrompt, getDividerContext, onComplete }) {
  const last = [...messages].reverse().find(m => m.role === 'user');
  const prompt = typeof last?.content === 'string' ? last.content : '';
  let body;
  try {
    body = await streamTermdAgent({
      prompt: `${getSystemPrompt()}\n\n---\n\n${prompt}`,
      tools: listTools().map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      signal,
    });
  } catch (err) {
    hideSpinner();
    if (err.name === 'AbortError') return;
    appendMessage('error', err.message);
    return;
  }

  let textEl = null, text = '';
  try {
    // termd's stream is data:-prefixed JSON with no event names, which is the
    // shape parseOpenAIStream already reads.
    for await (const evt of parseOpenAIStream(body)) {
      if (evt.type === 'text') {
        if (!textEl) { hideSpinner(); textEl = appendMessage('assistant', ''); }
        text += evt.text;
        textEl.innerHTML = renderMarkdown(text);
      } else if (evt.type === 'tool_request') {
        hideSpinner();
        const pendingEl = createPendingToolCard(evt.name);
        const result = await executeTool(evt.name, evt.input || {}, pendingEl, getDividerContext);
        // A 404 means the call already settled (timed out, or the turn ended).
        // Nothing to retry against, so surface it rather than looping.
        const landed = await answerTermdTool(evt.token, result?.error ? { error: result.error } : { content: result });
        if (!landed) appendMessage('error', `termd stopped waiting for ${evt.name}.`);
        showSpinner();
      } else if (evt.type === 'result' && evt.isError) {
        appendMessage('error', evt.text || 'termd turn failed.');
      } else if (evt.type === 'error') {
        appendMessage('error', evt.error || 'termd error.');
      } else if (evt.type === 'done') {
        break;
      }
    }
  } catch (err) {
    hideSpinner();
    if (err.name !== 'AbortError') appendMessage('error', 'Stream interrupted: ' + err.message);
    return;
  }
  hideSpinner();
  onComplete?.();
}

export async function runConversation(messages, opts) {
  const provider = getProvider();
  if (provider === 'github') {
    return runConversationOpenAIShape(messages, opts,
      (args) => streamGitHubModelsAPI({ ...args, token: getGitHubAuth()?.token }));
  }
  if (provider === 'termd') return runConversationTermd(messages, opts);
  if (provider === 'openai') {
    return runConversationOpenAIShape(messages, opts,
      (args) => streamOpenAIAPI({ ...args, apiKey: getOpenAIKey() }));
  }
  return runConversationClaude(messages, opts);
}
