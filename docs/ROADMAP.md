# Roadmap

## Current state

Working PoC in a single 2,500-line HTML file. The runtime (~400 lines between `syncTools()` and `runConversation()`) is proven but not extracted. Hospital dataset is sample data demonstrating the pattern.

---

## Phase 1: Extract the runtime

**Goal:** Standalone ES module package, zero build step required.

Extract from `index.html`:

| Module | What to extract |
|---|---|
| `runtime/loop.js` | SSE streaming, `tool_use` block parsing, execute → inject result → continue cycle, abort handling |
| `runtime/tools.js` | Tool registration, deregistration, reactive schema updates, tool diffing, state-driven materialization |
| `runtime/trust.js` | Annotation-based execution policy — read-only passthrough, destructive confirmation gating, idempotent retry safety |

**Validation:** Refactor the existing hospital PoC to consume the extracted runtime. Same behavior, runtime imported instead of inline.

**Ship as:** ES modules on npm. Zero dependencies. Ships a minimal WebMCP spec polyfill that drops away when browsers implement `navigator.modelContext` natively.

**Provider support:** Anthropic first (already working). Abstract the SSE parsing so OpenAI and other providers slot in without changing the tool loop.

---

## Phase 2: Prove it's horizontal

**Goal:** Show the runtime works in unrelated domains.

Build 2 minimal demos using the extracted runtime:

1. **E-commerce admin** — `filter_orders`, `refund_order` (destructive), `customer_detail`. Transactional app with write operations and confirmation flows.
2. **Ops dashboard** — `list_services`, `show_logs`, `restart_service` (destructive). Infrastructure tooling with real consequences.

Alternatively: integrate into an existing open-source web app (admin panel, TodoMVC) to show adoption requires ~20 lines.

These become `/examples` in the repo.

---

## Phase 3: Open-source launch

**Goal:** Public repo, initial adoption.

- GitHub repo, MIT license
- README: 30-second integration example
- `/examples` with PoC + Phase 2 demos
- Types as documentation (no docs site yet)
- Post to HN, Twitter/X, MCP community channels

**Success signal:** Issues and PRs (usage), not just stars (interest).

---

## Phase 4: Validate

**Goal:** Confirm demand, learn what's missing.

**Duration:** 4-6 weeks post-launch.

Run 2-3 paid consulting engagements ($15-30k) integrating the runtime into real company apps. This provides:
- Revenue to fund continued development
- Real-world API feedback
- Case studies for credibility
- Understanding of what enterprises actually need

**Watch for:**
- Requests for React/Vue adapters → core API is working
- Requests for auth/proxy → monetization opening confirmed
- Struggles with tool design → need better docs/patterns

---

## Phase 5: Monetize

**Model:** Open-core.

| Free (open-source) | Paid (hosted service) |
|---|---|
| Agentic tool loop | API proxy/gateway (solves client-side API key exposure) |
| Reactive tool surface | Usage analytics (tool call frequency, success rates, patterns) |
| Trust policy layer | Audit log (who approved what destructive action, when, result) |
| Provider adapters | Team management (shared tool configs, role-based tool access) |
| UI components | Priority support + SLA |

**The API proxy is the primary monetization lever.** The runtime intentionally runs client-side with no backend — but production apps can't expose API keys in the browser. A hosted proxy with auth, rate limiting, and usage tracking solves a real problem that every production user hits.

**Pricing:**
- **Free:** Self-hosted, open-source runtime
- **Pro ($99-299/mo):** Hosted proxy, analytics dashboard, audit log
- **Enterprise (custom):** SSO, role-based tool access, on-prem deployment, SLA

---

## Decision points

| Decision | When | Options |
|---|---|---|
| Package name | Phase 1 start | Needs to communicate "browser AI runtime", not "chat widget" |
| Provider abstraction depth | Phase 1 | Thin adapter (just SSE parsing) vs. full provider SDK |
| UI components scope | Phase 2-3 | Ship headless runtime only vs. include optional chat UI |
| Framework adapters | Phase 4, if requested | React/Vue/Svelte wrappers vs. vanilla-only |
| Proxy architecture | Phase 5 | Cloudflare Workers, edge functions, or traditional server |
