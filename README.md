# WebMCP

Proof-of-concept demonstrating [WebMCP](https://webmachinelearning.github.io/webmcp/) — a proposed browser API that lets web pages expose tools to AI models through `navigator.modelContext`.

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen?style=flat-square)](https://neevs.io/webmcp/)
[![GitHub Pages](https://img.shields.io/github/deployments/jonasneves/webmcp/github-pages?label=deploy&style=flat-square)](https://neevs.io/webmcp/)
[![No dependencies](https://img.shields.io/badge/dependencies-none-blue?style=flat-square)]()
[![Vanilla JS](https://img.shields.io/badge/built%20with-vanilla%20JS-f7df1e?style=flat-square&logo=javascript&logoColor=black)]()

Three interactive demos show an AI model navigating real data, calling tools, and updating the live UI — running entirely in the browser with no backend.

## Demos

| Demo | Data source | Description |
|------|-------------|-------------|
| [Hospital Risk Explorer](https://neevs.io/webmcp/hospital-risk-explorer/) | Local JSON | 15 California hospitals — filter, compare, flag, and analyze financial and risk metrics |
| [World Countries](https://neevs.io/webmcp/countries/) | [REST Countries API](https://restcountries.com) | Every country — filter by region, compare metrics, explore profiles |
| [Earthquake Monitor](https://neevs.io/webmcp/earthquakes/) | [USGS live feed](https://earthquake.usgs.gov) | Last 30 days of global seismic activity — magnitude, depth, significance, tsunami warnings |

## How It Works

The [WebMCP spec](https://webmachinelearning.github.io/webmcp/) defines `navigator.modelContext` — a proposed browser API for registering tools that AI models can discover and call. A minimal polyfill (~10 lines) fills in the spec until browsers implement it natively.

Each demo implements a runtime on top of that:

**1. Agentic tool loop**
SSE stream → parse `tool_use` blocks → execute against local handlers → inject `tool_result` → continue. A full agent loop running entirely in the browser.

**2. Reactive tool surface**
The available tool set is a function of app state, not a static declaration. Tools materialize and disappear as state changes. Schema enums rewrite themselves from live UI data — the model literally can't hallucinate options that aren't currently on screen.

**3. Annotation-driven trust policy**
`readOnlyHint`, `destructiveHint`, and `idempotentHint` aren't cosmetic metadata — they're a runtime execution policy. Read-only tools run immediately. Destructive tools pause and require human confirmation before proceeding.

## What This Demonstrates

- **Tool registration** — Pages declare tools with typed schemas; models discover and call them via `navigator.modelContext`
- **Annotations** — `readOnlyHint`, `idempotentHint`, `destructiveHint` communicate tool semantics and drive UI (confirmation dialogs, badge display)
- **Dynamic tool registration** — Tools appear/disappear based on app state; e.g. flagging a record materializes `review_flags` and `clear_all_flags`, removing the flag removes them
- **Reactive schemas** — Input enums rewrite from live UI data; filtering the table changes what values the model can reference
- **Page context** — Live context bar shows the model's view of current page state; updates in real-time as the user navigates
- **Read & write tools** — Filter, compare, summarize (read-only); flag/unflag records with undo (write)
- **Non-rendering tools** — Some tools return data for model reasoning without updating the visible UI
- **Multi-step orchestration** — A single prompt chains 4+ tool calls in sequence
- **Bidirectional context** — UI interactions inject context into the conversation; tool calls update the UI
- **Streaming** — SSE for real-time response rendering with abort support
- **Artifact generation** — Tools can produce downloadable outputs (e.g. CSV export)

## Running Locally

```bash
npx serve .
```

Open [http://localhost:3000](http://localhost:3000), pick a demo, and select a provider in the settings panel.

All three demos support the same set of AI providers:

| Provider | Models | Auth |
|----------|--------|------|
| Anthropic | Claude Haiku 4.5, Claude Sonnet 4.6 | API key |
| GitHub Models | GPT-4.1, GPT-4.1 mini, GPT-5, GPT-5 mini | GitHub OAuth (free) |
| Local proxy | Claude via OAuth | `node local-proxy.js` |

The local proxy (`local-proxy.js`) forwards requests to Claude using `CLAUDE_CODE_OAUTH_TOKEN` — useful for development without an API key.

## Architecture

Single-page apps — no build step, no external dependencies.

```
index.html                       # Landing page linking to all three demos
hospital-risk-explorer/
  index.html                     # Hospital demo — 9–11 dynamic tools, all views
  hospitals.json                 # 15 California hospitals (local JSON dataset)
countries/
  index.html                     # Countries demo — fetches restcountries.com at load
earthquakes/
  index.html                     # Earthquake demo — fetches USGS live feed at load
local-proxy.js                   # Local Claude proxy (port 7337, uses CLAUDE_CODE_OAUTH_TOKEN)
chat.css                         # Shared chat panel styles
docs/
  VISION.md                      # What this is building toward
  ROADMAP.md                     # Phased extraction plan
```

## Further Reading

- [VISION.md](docs/VISION.md) — the bigger picture: a standalone browser-side AI agent runtime, zero dependencies, ships as an npm package
- [ROADMAP.md](docs/ROADMAP.md) — phased plan from this PoC to an extractable, publishable runtime
- [WebMCP spec](https://webmachinelearning.github.io/webmcp/) — the W3C proposal this implements
