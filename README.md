# WebMCP

A browser-side AI agent runtime built on [WebMCP](https://webmachinelearning.github.io/webmcp/) — the proposed `navigator.modelContext` API that lets a web page expose its UI as typed tools an AI model can discover and call. The spec covers tool *registration*; this repo is the *runtime* the spec leaves out: the agentic loop, a reactive tool surface, and an annotation-driven trust policy — all client-side, no backend.

[Live demos →](https://neevs.io/webmcp/)

## Demos

| Demo | Data source | What it shows |
|------|-------------|---------------|
| [Hospital Risk Explorer](https://neevs.io/webmcp/hospital-risk-explorer/) | Local JSON | 15 California hospitals — filter, compare, flag, analyze financial/risk metrics |
| [World Countries](https://neevs.io/webmcp/countries/) | [REST Countries API](https://restcountries.com) | Every country — filter by region, compare metrics, explore profiles |
| [Earthquake Monitor](https://neevs.io/webmcp/earthquakes/) | [USGS live feed](https://earthquake.usgs.gov) | 30 days of global seismic activity — magnitude, depth, significance, tsunami flags |

All three import the same runtime; the per-demo `index.html` is just data + tool definitions.

## The runtime

`docs/runtime/` is the actual product — a shared ES module the demos `mount()`. The spec's `navigator.modelContext` (registration only) is filled by a tiny polyfill (`tools.js`) until browsers ship it natively. On top of registration:

**1. Agentic tool loop** — SSE stream → parse `tool_use` blocks → execute against local handlers → inject `tool_result` → continue. A full agent loop in the browser (`loop.js`).

**2. Reactive tool surface** — The tool set is a function of app state, not a static declaration. Tools materialize and vanish as state changes; schema enums rewrite from live UI data, so the model can't reference an option that isn't on screen (`tools.js`, demo `getDynamicTools`/`adjustTool` hooks).

**3. Annotation-driven trust policy** — `readOnlyHint` / `destructiveHint` / `idempotentHint` are runtime execution policy, not metadata. Read-only tools run immediately; destructive tools pause for human confirmation.

Also demonstrated: non-rendering tools (data for reasoning, no UI change), multi-step orchestration (one prompt → 4+ chained calls), bidirectional context (UI interactions inject into the conversation), streaming with abort, and tool-generated artifacts (CSV export).

## Run locally

```bash
npx serve docs
```

Open the printed URL, pick a demo, choose a provider in settings.

| Provider | Models | Auth |
|----------|--------|------|
| Anthropic | Claude Haiku 4.5, Claude Sonnet 4.6 | API key (direct browser fetch) |
| GitHub Models | GPT-4.1, GPT-4.1 mini, GPT-5, GPT-5 mini | GitHub OAuth (free) |
| Local proxy | Claude via OAuth | [ai-bridge](https://github.com/jonasneves/ai-bridge) — localhost `:7337`, or Chrome extension on hosted pages |

## Dependencies

No framework, no build step. Demos load `marked`, `dompurify`, and `echarts` from CDN; the runtime itself is dependency-free vanilla JS.

## Layout

```
docs/
  index.html                 # Landing page → the three demos
  runtime/                   # The runtime (shared by every demo)
    index.js                 #   mount() entry + re-exports
    loop.js                  #   agentic tool loop (SSE, tool_use/tool_result)
    tools.js                 #   modelContext polyfill + tool registry/panel
    providers.js             #   Anthropic / GitHub Models / ai-bridge adapters
    auth.js  chat.js  ui.js  theme.js
  hospital-risk-explorer/    # demo: data (hospitals.json) + tool defs
  countries/                 # demo: fetches restcountries.com at load
  earthquakes/               # demo: fetches USGS live feed at load
  chat.css                   # shared chat-panel styles
```

`VISION.md` — what this builds toward (target API, OSS strategy). `ROADMAP.md` — phased extraction plan.
