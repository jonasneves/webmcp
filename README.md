# WebMCP PoC

Proof-of-concept demonstrating [WebMCP](https://anthropic.com/research/model-context-protocol) — a protocol that lets web pages expose tools to AI models through `navigator.modelContext`.

**[Live Demo](https://jonasneves.github.io/webmcp-poc/)**

## What This Demonstrates

- **Tool registration** — Pages declare tools with typed schemas; models discover and call them
- **Annotations** — `readOnlyHint`, `idempotentHint`, `destructiveHint`, `openWorldHint` communicate tool semantics and drive UI (confirmation dialogs, badge display)
- **Read & write tools** — Filter, chart, compare, summarize (read); flag hospitals with undo (write)
- **Non-rendering tools** — `summarize_data` returns stats for model reasoning without visual output
- **Multi-step orchestration** — "Run triage analysis" chains 4+ tool calls in a single turn
- **Cross-tab discovery** — Tools from multiple open tabs appear in a unified tool list
- **Bidirectional context** — UI interactions inject context into conversation; tool calls update the UI
- **Streaming** — SSE for real-time response rendering
- **Artifact generation** — `export_flagged` produces a CSV download

## Running Locally

```bash
npx serve .
```

Enter an Anthropic API key in the chat panel. The [WebMCP polyfill](https://www.npmjs.com/package/@mcp-b/global) loads automatically.

## Architecture

Single-page apps with inline JS — no build step, no dependencies beyond the polyfill.

| File | Purpose |
|------|---------|
| `index.html` | Hospital explorer — 7 tools, chat panel, all views |
| `trends.html` | Statewide trends — 2 tools, cross-tab context demo |
| `hospitals.json` | 15 California hospitals with financial/risk metrics |
