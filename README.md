# WebMCP

The [WebMCP spec](https://webmachinelearning.github.io/webmcp/) proposes `navigator.modelContext` — a browser API letting a page expose its own UI as typed tools a model can call. The spec covers **registration**. This repo is the **runtime** it leaves out: the agent loop, a tool surface that changes with app state, and a trust policy driven by tool annotations. Client-side, no backend, no build step.

**[Live demos →](https://jonasneves.com/webmcp/)**

## A page declares a tool

```js
{
  name: 'plot_development_scatter',
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
mount({ tools: TOOL_DEFS, getSystemPrompt, quickActions });
```

## Three ideas in the runtime

**1. The loop runs in the browser** — SSE stream → parse `tool_use` → execute against local handlers → inject `tool_result` → continue, until the model stops calling tools. No server in the path. (`runtime/loop.js`)

**2. The tool surface is a function of state** — tools appear and vanish as the app changes, and schema enums are rewritten from live data. A model cannot select a region that isn't in the dataset, because the enum *is* the dataset. (`runtime/tools.js`, plus each demo's `adjustTool` / `getDynamicTools`)

**3. Annotations are execution policy, not metadata** — `readOnlyHint` runs immediately; `destructiveHint` stops for human confirmation. The annotation is the gate between model capability and human authority.

## Demos

| Demo | Data | What it exercises |
|---|---|---|
| [World Development](https://jonasneves.com/webmcp/countries/) | [World Bank](https://data.worldbank.org) · 217 countries | Ranking, log-scale scatter, and time series fetched **beyond** the loaded snapshot — back to 1960 |
| [Earthquake Monitor](https://jonasneves.com/webmcp/earthquakes/) | [USGS live feed](https://earthquake.usgs.gov) | 30 days of global seismic activity against data that changes under you |
| [Hospital Risk Explorer](https://jonasneves.com/webmcp/hospital-risk-explorer/) | Local JSON (sample data) | Flagging, CSV export, and `destructiveHint` confirmation gating |

Each demo's `index.html` is data plus tool definitions. The runtime and both stylesheets are shared.

## Run it

```bash
npx serve docs
```

| Provider | Auth | Notes |
|---|---|---|
| Anthropic | Your API key | Direct browser fetch |
| OpenAI | Your API key | Direct browser fetch — `api.openai.com` permits it |
| GitHub Models | GitHub OAuth | Free tier, GPT-4.1 / GPT-5 |
| Local proxy | none | Anthropic-shaped endpoint on `:7337`; an HTTPS page can't reach `http://127.0.0.1`, so this is localhost-only unless a browser extension bridges it |
| termd | none | The agent loop runs on your machine and calls the page's tools back over HTTP. Same-origin only — see below |

Keys are held in `localStorage` per provider and sent straight to that provider. There is no server in this repo to send them to.

## Layout

```
docs/
  index.html          landing page
  app.css             page shell — tokens, header, controls, data table
  chat.css            chat surface + the two-column grid
  runtime/            ← the product; every demo mounts this
    index.js            mount() entry
    loop.js             agent loop (SSE, tool_use → tool_result)
    tools.js            modelContext polyfill + registry + tool panel
    providers.js        Anthropic · GitHub Models · ai-bridge adapters
    auth.js chat.js ui.js theme.js
  countries/ earthquakes/ hospital-risk-explorer/
```

## Constraints worth knowing

Demos may only use APIs that send `access-control-allow-origin` — there is no backend to proxy through. That rules out otherwise-obvious sources: OpenSky echoes its own origin, and REST Countries now redirects to a CDN with no CORS headers, which is why the countries demo moved to the World Bank.

The termd provider is the inverse of the others: instead of the browser running
the agent loop and calling out to a model, termd
runs the loop locally and calls back into the page for every tool. It only works
when these pages are served by the daemon itself — termd ships no CORS headers on
purpose, because it has no authentication and anything that reaches its port gets
a shell. The option stays hidden anywhere else, which is every deploy of this repo.

Nothing here is load-bearing on a remote module. `marked`, `dompurify` and `echarts` come from a CDN; the runtime itself is dependency-free. Deploys are gated on every one of those URLs still resolving, because a moved dependency is otherwise invisible until a user opens the page.
