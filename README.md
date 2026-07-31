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
| [US Hospital Capacity](https://jonasneves.com/webmcp/hospital-risk-explorer/) | [HealthData.gov](https://healthdata.gov) · 1,265 facilities | Suppressed values and partial reporting handled in the open; flagging, CSV export, `destructiveHint` gating |

Each demo's `index.html` is data plus tool definitions. The runtime and both stylesheets are shared.

## Run it

```bash
npx serve docs
```

The model runs on your machine. These demos drive it through **termd** — a
daemon that runs a coding agent locally and lends it out over HTTP, so the agent
uses your own machine and your own subscription. Install it and its bridge
extension — [jonasneves.com/termd](https://jonasneves.com/termd/) — then reload;
the demos detect it and the model picker offers whatever it can run.

There is no API key anywhere in this repo. No key is typed into a page, none is
stored, and no page holds a credential — the daemon owns whatever auth the model
needs, on your machine. Hosted providers were dropped for that reason: what is
worth showing is not that a browser can call a model API, it's that an agent
running locally can drive a page it does not own.

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
    providers.js        termd transport — bridge extension or same-origin
    auth.js chat.js ui.js theme.js
  countries/ earthquakes/ hospital-risk-explorer/
```

## Constraints worth knowing

Every demo reads live public data — nothing here is invented. Demos may only use APIs that send `access-control-allow-origin` — there is no backend to proxy through. That rules out otherwise-obvious sources: OpenSky echoes its own origin, and REST Countries now redirects to a CDN with no CORS headers, which is why the countries demo moved to the World Bank.

The loop is inverted from the usual shape. Rather than the browser driving a
model and calling out for tools, termd runs the agent loop on your machine and
calls *back* into the page for every tool — so the page is the tool provider,
not the client.

termd ships no CORS headers on purpose: it has no authentication, and anything
that reaches its port gets a shell, so the same-origin policy is the only gate
in front of it. A page therefore cannot call it directly. Two ways through:
serve these pages from the daemon itself, or install the two-file bridge
extension, which runs on its own origin — where `host_permissions` exempt it
from CORS and mixed content — and relays the stream. Its
`externally_connectable` allowlist is the access control. Without either, the
probe fails and the page says so instead of offering a dead Send button.

Nothing here is load-bearing on a remote module. `marked`, `dompurify` and `echarts` come from a CDN; the runtime itself is dependency-free. Deploys are gated on every one of those URLs still resolving, because a moved dependency is otherwise invisible until a user opens the page.
