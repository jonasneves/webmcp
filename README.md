# WebMCP

The [WebMCP spec](https://webmachinelearning.github.io/webmcp/) proposes `document.modelContext` — a browser API letting a page expose its own UI as typed tools a model can call. The spec covers **registration**. This repo is the **runtime** it leaves out: a tool surface that changes with app state, kept live in the browser's own registry, plus a tools panel that shows a visitor what the page can do. Client-side, no backend, no build step. No embedded chat — whatever WebMCP-aware agent shares the tab drives these tools directly.

**[Live demos →](https://jonasneves.com/webmcp/)**

## A page declares a tool

```js
{
  name: 'plot_development_scatter',
  title: 'Plot Development Scatter',
  description: 'GDP per capita against life expectancy, log x, bubbles by population.',
  readOnlyHint: true, idempotentHint: true, destructiveHint: false,
  schema: {
    type: 'object',
    properties: {
      region: { type: 'string', enum: REGIONS },        // ← live values, not a guess
      income: { type: 'string', enum: INCOME_LEVELS },
    },
  },
  exec: async ({ region, income }) => {
    renderScatter(filterData({ region, income }));       // ← mutates the page you're looking at
    return { displayed: true, plotted: 214 };            // ← and answers the model
  },
}
```

Hand a list of those to `mount()` and the page is agent-operable:

```js
import { mount } from '../runtime/index.js';
mount({ tools: TOOL_DEFS });
```

`mount()` translates each tool into the spec's shape (`inputSchema`, `execute`, `annotations: { readOnlyHint }`) and calls `document.modelContext.registerTool()` — the richer flat hints above (`idempotentHint`, `destructiveHint`) are this page's own trust metadata, read by the tools panel, not by the spec.

## Two ideas in the runtime

**1. Registration is a live mirror, not a one-shot.** `document.modelContext.registerTool()` throws if you call it twice for the same name, and the only way to replace a tool is to abort the `AbortSignal` you registered it with — there's no public update method. `runtime/tools.js` tracks one controller per tool name and re-registers on demand, so a demo's `adjustTool`/`getDynamicTools` hooks can rewrite a schema's enum or add/remove a tool as page state changes, and the live registry — the one an agent actually queries — changes with it. A shape-diff cache skips re-registering tools that didn't actually change, so the ~10 static tools on a page don't churn every time one dynamic tool does.

**2. The tool surface is a function of state** — tools appear and vanish as the app changes, and schema enums are rewritten from live data. A model cannot select a region that isn't in the dataset, because the enum *is* the dataset. (`runtime/tools.js`, plus each demo's `adjustTool` / `getDynamicTools`, wired through `runtime.refresh()`)

There is no runtime-enforced trust policy — the spec's `ToolAnnotations` only defines `readOnlyHint`; there's no gate to hang a `destructiveHint` confirmation on from outside. Each demo's own destructive tool (`clear_all_flags`) shows its own confirm dialog as the first line of its `exec`, unconditionally, on every call — human-in-the-loop lives in the tool, not the runtime.

## Demos

| Demo | Data | What it exercises |
|---|---|---|
| [World Development](https://jonasneves.com/webmcp/countries/) | [World Bank](https://data.worldbank.org) · 217 countries | Ranking, log-scale scatter, and time series fetched **beyond** the loaded snapshot — back to 1960 |
| [Earthquake Monitor](https://jonasneves.com/webmcp/earthquakes/) | [USGS live feed](https://earthquake.usgs.gov) | 30 days of global seismic activity against data that changes under you |
| [US Hospital Capacity](https://jonasneves.com/webmcp/hospital-risk-explorer/) | [HealthData.gov](https://healthdata.gov) · 1,265 facilities | Suppressed values and partial reporting handled in the open; flagging, CSV export, a tool-owned destructive confirm |

Each demo's `index.html` is data plus tool definitions. The runtime and both stylesheets are shared.

## Run it

```bash
npx serve docs
```

Open a page and the tools panel populates — that part needs no agent. Driving the tools depends entirely on what shares the tab, and as of 2026 that's narrow and asymmetric:

- **ChatGPT's desktop app** (Codex folded in) supports this natively in its built-in browser, under the name "Site tools" — on by default (Settings → Browser → Permissions). Open a demo inside it and ask a question; no setup here.
- **Claude** has no shipped surface that calls `document.modelContext` — not claude.ai, not Claude Desktop, not the official Claude in Chrome extension, which drives pages by DOM reads and simulated clicks instead. The gap closes with [termd](https://jonasneves.com/termd/) (a daemon that drives your own `claude` binary and subscription locally) paired with a browser extension that polyfills `document.modelContext` and gives any page a floating chat panel — that extension is mine and still unpublished, so this path isn't available to try yet.
- **Native Chrome** ships `document.modelContext` behind an origin trial (milestones 149–156 as of this writing; check `chrome://flags` → "WebMCP for testing" or the [origin trial](https://developer.chrome.com/blog/ai-webmcp-origin-trial)) — not stable yet, so it's not the path most visitors are on.

There is no API key anywhere in this repo, and nothing here talks to a model directly — that's now entirely the agent's problem, wherever it lives.

## Layout

```
docs/
  index.html          landing page
  app.css             page shell — tokens, header, controls, data table
  ui.css              settings popover, toast, dialogs, tools-toggle caret
  runtime/            ← the product; every demo mounts this
    index.js            mount() entry — registers tools, wires refresh()
    tools.js            document.modelContext mirror + registry + tool panel
    source.js           data provenance — the source bar
    ui.js theme.js
  countries/ earthquakes/ hospital-risk-explorer/
```

## Constraints worth knowing

Every demo reads live public data — nothing here is invented. Demos may only use APIs that send `access-control-allow-origin` — there is no backend to proxy through. That rules out otherwise-obvious sources: OpenSky echoes its own origin, and REST Countries now redirects to a CDN with no CORS headers, which is why the countries demo moved to the World Bank.

Nothing here is load-bearing on a remote module. `echarts` comes from a CDN; the runtime itself is dependency-free. Deploys are gated on that URL still resolving, because a moved dependency is otherwise invisible until a user opens the page.
