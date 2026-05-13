// Agent loop: stream model → parse tool_use → gate on trust → execute →
// inject result → continue. One implementation, two providers via adapter.

import {
  streamClaudeAPI, streamGitHubModelsAPI,
  parseSSEStream, parseOpenAIStream,
} from './providers.js';
import {
  appendMessage, appendDivider, appendToolMsg,
  createPendingToolCard, resolveToolCard,
  hideSpinner, showSpinner,
} from './chat.js';
import { showConfirmDialog, scrollDisplayIntoView, renderMarkdown } from './ui.js';
import { toAnthropicTools, toOpenAITools, listTools } from './tools.js';
import { getProvider, getGitHubAuth, getApiKey, getSelectedModelName } from './auth.js';

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

async function runConversationGitHub(messages, { signal, getSystemPrompt, getDividerContext, onComplete }) {
  const token = getGitHubAuth()?.token;
  const model = getSelectedModelName();

  while (true) {
    let body;
    try {
      body = await streamGitHubModelsAPI({
        token, model, signal,
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

export async function runConversation(messages, opts) {
  return getProvider() === 'github'
    ? runConversationGitHub(messages, opts)
    : runConversationClaude(messages, opts);
}
