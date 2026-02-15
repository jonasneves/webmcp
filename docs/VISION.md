# Vision

## What this is

A browser-side AI agent runtime. Web apps declare tools with typed schemas and annotations. The runtime handles the agentic loop — streaming model responses, detecting tool calls, executing them against the live UI, injecting results back, and continuing the conversation. No backend required.

The WebMCP polyfill (`@mcp-b/global`) provides one primitive: `navigator.modelContext.provideContext({ tools })`. Everything else — the execution loop, reactive tool surface, trust policy, bidirectional context — is this runtime.

## Core components

**1. Agentic tool loop**
SSE stream → parse `tool_use` blocks → execute against local tool definitions → inject `tool_result` → continue. A full agent loop running entirely in the browser.

**2. Reactive tool surface**
The available tool set is a function of app state, not a static declaration. Tools materialize and disappear based on state changes. Schema enums rewrite themselves from live UI data — the model literally cannot hallucinate options that don't exist on screen.

**3. Annotation-driven trust policy**
`readOnlyHint`, `destructiveHint`, `idempotentHint` aren't cosmetic metadata — they're a runtime policy system. Read-only tools execute freely. Destructive tools gate on human confirmation. This is the control layer between AI capability and human authority.

**Supporting pieces** (ship later, not core):
- Bidirectional context injection (UI state → model context)
- Cross-tab tool aggregation (multiple pages → unified tool surface)
- UI components (chat panel, tool inspector, suggestion chips)

## What this is not

- Not a chatbot widget or AI assistant UI
- Not a vertical product (the hospital dashboard is sample data)
- Not a backend framework — runs entirely client-side
- Not a replacement for MCP/mcp-b — builds on top of it

## Competitive position

Backend agent frameworks (LangChain, CrewAI, Vercel AI SDK) run server-side with synthetic tools. This runtime runs client-side where the tools are the actual UI. The human stays in the loop via the trust layer. Nobody occupies this position.

## Target API

```js
import { createRuntime } from '{package-name}';

const runtime = createRuntime({
  provider: { type: 'anthropic', apiKey },
  trustPolicy: { confirmDestructive: true },
});

// Register tools — static or derived from state
runtime.registerTools([
  {
    name: 'filter_items',
    description: 'Filter the visible items',
    schema: { type: 'object', properties: { status: { enum: ['active', 'archived'] } } },
    annotations: { readOnlyHint: true },
    execute: (args) => { /* update UI, return result */ }
  }
]);

// Reactive update — call after any state change that affects tool availability or schemas
runtime.updateTools(getActiveTools());

// Run conversation
runtime.send('Show me all active items');
```

## Open-source strategy

MIT license. The runtime is the open-source core — small, auditable, zero dependencies beyond the mcp-b polyfill. Monetization comes from infrastructure that production deployments need but the runtime intentionally doesn't include (see ROADMAP.md).
