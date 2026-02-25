# WebMCP

Proof-of-concept demonstrating [WebMCP](https://webmachinelearning.github.io/webmcp/) — a protocol that lets web pages expose tools to AI models through `navigator.modelContext`.

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen?style=flat-square)](https://jonasneves.github.io/webmcp-poc/)
[![GitHub Pages](https://img.shields.io/github/deployments/jonasneves/webmcp/github-pages?label=deploy&style=flat-square)](https://jonasneves.github.io/webmcp-poc/)
[![No dependencies](https://img.shields.io/badge/dependencies-none-blue?style=flat-square)]()
[![Vanilla JS](https://img.shields.io/badge/built%20with-vanilla%20JS-f7df1e?style=flat-square&logo=javascript&logoColor=black)]()

## What This Demonstrates

- **Tool registration** — Pages declare tools with typed schemas; models discover and call them
- **Annotations** — `readOnlyHint`, `idempotentHint`, `destructiveHint`, `openWorldHint` communicate tool semantics and drive UI (confirmation dialogs, badge display)
- **Dynamic tool registration** — Tools appear/disappear based on app state; flagging a hospital materializes `review_flags` and `clear_all_flags`, unflagging removes them
- **Reactive schemas** — `compare_hospitals` input enum adapts to show only currently visible hospitals; filtering the table changes what the model can compare
- **Page context** — Live context bar shows the model's view of page state (current view, filters, flagged count); updates in real-time as the user navigates
- **Read & write tools** — Filter, chart, compare, summarize (read); flag hospitals with undo (write)
- **Non-rendering tools** — `summarize_data` returns stats for model reasoning without visual output
- **Multi-step orchestration** — "Run triage analysis" chains 4+ tool calls in a single turn
- **Bidirectional context** — UI interactions inject context into conversation; tool calls update the UI
- **Streaming** — SSE for real-time response rendering
- **Artifact generation** — `export_flagged` produces a CSV download

## Running Locally

```bash
npx serve .
```

Enter an Anthropic API key in the chat panel. A minimal [WebMCP spec](https://webmachinelearning.github.io/webmcp/) polyfill is inlined — no external dependencies.

## Architecture

Single-page apps with inline JS — no build step, no external dependencies.

| File | Purpose |
|------|---------|
| `index.html` | Hospital explorer — 9-11 dynamic tools, chat panel, all views |
| `hospitals.json` | 15 California hospitals with financial/risk metrics |
