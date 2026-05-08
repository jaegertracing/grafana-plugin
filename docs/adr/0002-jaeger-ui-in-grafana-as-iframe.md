# ADR 0002: Iframe-Based Jaeger UI Integration — Implementation Plan

* **Status**: In progress (Phase 4 next)
* **Last Updated**: 2026-05-08

---

## TL;DR

Implements the iframe rendering approach decided in ADR 0001. A panel plugin renders `<iframe src={jaegerUrl}>` and a datasource plugin provides Explore integration and Jaeger API access. A Go backend binary supports a proxy mode for routing API calls through the Grafana server. The Jaeger SPA itself must always be served from a browser-reachable origin; Grafana's proxy infrastructure cannot serve executable JavaScript due to a universal `Content-Security-Policy: sandbox` header.

---

## Repository

The plugin lives in its own dedicated repository (`github.com/jaegertracing/grafana-plugin`). This keeps the plugin versioning, releases, CI, and Grafana plugin catalog submission independent of the Jaeger core release cycle. It also avoids introducing Node.js/webpack toolchain into the main Jaeger Go repo, and sidesteps CNCF license compliance concerns around Grafana's AGPLv3 dependencies (`@grafana/ui`, `@grafana/data`, `@grafana/runtime`) which are not approved for inclusion in Apache-2.0 CNCF projects.

The Go backend binary (Phase 3), if it needs to import Jaeger internals, will do so as a regular Go module dependency (`github.com/jaegertracing/jaeger`).

**Jaeger UI changes** (`uiEmbed` flag additions in Phase 4, `uiLinkPatterns` in Phase 5) are PRs to the jaeger-ui repo, released independently and consumed here via npm.

**Repository layout:**

```
grafana-plugin/
├── packages/
│   ├── panel/                # Panel plugin (jaegertracing-jaeger-panel)
│   │   ├── src/
│   │   │   ├── components/   # JaegerPanel React component
│   │   │   ├── types.ts
│   │   │   ├── module.ts
│   │   │   └── plugin.json
│   │   ├── tests/            # Playwright e2e tests
│   │   ├── provisioning/     # Grafana provisioning for dev
│   │   └── package.json
│   └── datasource/           # Datasource plugin (jaegertracing-jaeger-datasource)
│       ├── src/
│       │   ├── components/   # QueryEditor
│       │   ├── datasource/   # DataSource class
│       │   ├── types.ts
│       │   ├── module.ts
│       │   └── plugin.json
│       ├── pkg/              # Go backend binary
│       └── package.json
├── provisioning/             # Combined provisioning for root docker-compose
├── docker-compose.yaml       # Grafana + Jaeger + HotROD for local dev
├── docs/
│   └── adr/
├── package.json              # npm workspaces root
└── Makefile
```

---

## Backend Binary: When It Is Needed

Grafana plugins can be frontend-only (`"backend": false`) or full-stack (`"backend": true`, Go binary required). The binary is only needed for server-side logic. For the iframe approach:

- The **panel plugin** is always frontend-only — it renders `<iframe>`.
- The **datasource plugin** is frontend-only in direct mode (no HTTP calls to Jaeger from the plugin itself; the iframe makes its own calls from the browser).
- A **Go backend binary** is required only in proxy mode, where the Grafana server must proxy Jaeger API calls server-side. The iframe itself always loads from a browser-reachable origin (see Proxy Mode section below).

The plugin is designed to support both modes via a configuration toggle. The Go binary is present in the final artifact but is only activated when proxy mode is selected — direct mode users do not need it.

---

## Phased Roadmap

The phases are ordered to reduce project risk as early as possible. The first two phases are deliberately minimal — manual verification only — to validate the core hypotheses (the iframe approach works; two plugins can cooperate) before investing in automation, polish, or the datasource plugin.

---

### Phase 0 — Proof of concept (half a day)

**Goal:** Validate the core hypothesis: a Jaeger trace renders correctly inside a Grafana panel iframe, and `uiEmbed=v0` produces an acceptable embedded UX. If this does not work, the entire approach is invalidated before any real investment.

**Tasks:**
1. Start Grafana locally via Docker with a plugin directory mounted:
   ```bash
   mkdir -p /tmp/jaeger-panel/dist
   # write a minimal plugin.json and module.js by hand or copy from any scaffold
   docker run --rm -p 3000:3000 \
     -v /tmp/jaeger-panel:/var/lib/grafana/plugins/jaegertracing-jaeger-panel \
     -e GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=jaegertracing-jaeger-panel \
     grafana/grafana:latest
   ```
2. Write the simplest possible panel: a React component that hardcodes an `<iframe src="http://localhost:16686/trace/SOME_ID?uiEmbed=v0" />` with a known trace ID from a locally running Jaeger.
3. Add the panel to a Grafana dashboard and visually inspect:
   - Does the Jaeger trace timeline render inside the panel?
   - Does `uiEmbed=v0` hide the nav bar correctly?
   - Does the standalone pop-out link appear?
   - Is the layout (height, scrolling) acceptable?
4. Repeat with a diff URL (`/trace/A...B?uiEmbed=v0`) to confirm trace diff also renders.
5. Repeat with the search page (`/search?service=frontend&uiEmbed=v0`) to confirm search embeds usably.

**No CI at this phase.** This is a manual spike. The output is a go/no-go decision and a list of `uiEmbed` gaps to address in Jaeger UI.

**Exit criterion:** Developer has visually confirmed the iframe approach works and documented any UX issues with the current `uiEmbed` flags.

**Status: ✅ COMPLETE (2026-05-06)**
- Plugin scaffolded with `@grafana/create-plugin`, lives at `integrations/grafana-plugin/` in the jaeger main repo.
- Panel plugin implemented: `src/types.ts`, `src/module.ts`, `src/components/SimplePanel.tsx`.
- Plugin built with webpack and loaded into Grafana via Docker (`GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS`).
- Jaeger + HotROD started via `examples/hotrod/docker-compose.yml`.
- **Confirmed**: single trace (`/trace/{id}?uiEmbed=v0`) renders correctly inside the Grafana panel iframe.
- **uiEmbed gap identified**: search page (`/search?uiEmbed=v0`) auto-submits a traces query on load before the user picks a service, producing "HTTP Error: parameter 'service' is required". Fix needed in jaeger-ui: suppress the auto-query when `uiEmbed` is set and no service is pre-selected. Workaround: pass `service=<name>` in the URL — confirmed working. The panel's search mode should accept an optional service param from panel options or a dashboard variable. This is an input for Phase 2.
- **Confirmed**: diff mode (`/trace/A...B?uiEmbed=v0`) renders correctly.
- **uiEmbed gap — zoom isolation**: browser zoom applies to Grafana chrome only; the iframe renders at its own zoom level. This is a fundamental iframe constraint. No fix available at the panel level; users must zoom inside the iframe separately (or use the standalone pop-out link).
- **uiEmbed gap — diff graph resize**: the TraceDiff graph does not reflow when the Grafana panel is resized. The timeline view is unaffected. The diff graph likely uses a fixed or one-time-computed SVG layout. Fix needed in jaeger-ui: listen for window resize (or a `postMessage` resize signal) and re-layout the graph. This is an input for Phase 4.
- **uiEmbed gap — timeline column resize handle missing**: in the standalone Jaeger UI the timeline columns (span name / duration bar) are individually resizable by dragging the column boundary. Inside the Grafana iframe the drag handle does not appear on mouseover at all. Root cause unknown — likely a CSS pointer-events or z-index conflict introduced by the iframe stacking context, or a `mousemove` event that does not fire correctly when the cursor is at the iframe boundary. Needs investigation in jaeger-ui; filed for Phase 4.

---

### Phase 1 — Panel plugin MVP (2–3 days)

**Exit criterion:** A developer can add the panel to a Grafana dashboard, type a trace ID into panel options, and see the Jaeger trace timeline render inside the panel.

**Status: ✅ COMPLETE (2026-05-06)**
- Plugin moved to standalone repo `github.com/jaegertracing/grafana-plugin`.
- `src/components/JaegerPanel.tsx` implements the iframe panel with `replaceVariables()` applied to all text fields (trace IDs, service, base URL), enabling Grafana dashboard variable interpolation (e.g. `${traceId}`).
- Options editor covers: mode (trace/diff/search), Jaeger base URL, trace ID(s), service (search mode), and three embed-flag toggles (hide minimap, hide trace summary, collapse trace header).
- Search mode requires a service to be set before rendering the iframe; shows a hint otherwise. Workaround for the Phase 0 auto-query bug until Phase 2 fixes it in jaeger-ui.
- Provisioned dashboard (`provisioning/dashboards/dashboard.json`) with 5 panels covering all three modes and a `$traceId` textbox variable.
- 5 Playwright e2e tests (`tests/panel.spec.ts`) covering hint states and iframe URL correctness; all passing.
- `docker-compose.yaml` runs Grafana only; Jaeger+HotROD run as a separate stack.
- `Makefile` with `build`, `dev`, `test`, `lint`, `server`, `e2e` targets.

---

### Phase 2 — Datasource plugin + CI (1–2 weeks) — ✅ COMPLETE (2026-05-07)

**Goal:** A working datasource plugin connected to the panel plugin so Explore and dashboards are usable end-to-end, plus CI that prevents regressions.

**What was built:**
- Datasource plugin (`JaegerDataSource`) with `testDatasource()`, `getServices()`, `getOperations()`, and `query()`.
- Search results DataFrame: `traceID` (with "Open in Explore" data link), `traceName` (service: operation of root span), `spanCount`, `duration` (µs).
- Trace lookup DataFrame: single-row `traceID` frame with `preferredVisualisationPluginId` routing to the Jaeger panel.
- `QueryEditor` with search/trace modes, service/operation selects (populated live from Jaeger), tags, duration, limit fields. Service field accepts Grafana variable syntax (e.g. `${service}`).
- Grafana template variable interpolation via `getTemplateSrv().replace()` for all query string fields.
- Panel DataFrame-driven rendering path: single-row `traceID` frame → iframe; multi-row or no data → falls through to panel-options path.
- Panel minimum iframe height (600px) so the trace is usable in Explore's split pane.
- Provisioned two-panel dashboard: narrow search results table (w=6) + wide trace detail panel (w=18), connected via `$traceId` variable. Clicking "Open in dashboard" sets the variable and rerenders inline.
- CI pipeline: build, lint, unit tests, Playwright e2e tests.
- Provisioned datasource with stable `uid: jaeger` for reliable dashboard references.

**Validated (2026-05-07):**
- Service discovery and trace search flow through the Grafana backend proxy; no browser-to-Jaeger API traffic.
- Search results table shows `traceName`, `spanCount`, `duration`, with two context-menu links per row: "Open in dashboard" (sets `$traceId` variable, stays on page) and "Open in Explore" (`splitOpen()`, second pane renders trace iframe).
- `preferredVisualisationPluginId` routes trace-ID lookup results to the Jaeger panel automatically in Explore.
- Iframe base URL falls back to `http://localhost:16686` (panel default) in Explore's second pane, which works for local dev. Production deployments require Phase 3.

**Constraints carried forward to Phase 3:**
- Iframe base URL must still be configured manually in panel options (`jaegerBaseUrl`). The Grafana backend proxy path is not usable for iframe navigation; Phase 3's Go binary resolves this by serving the Jaeger UI from the Grafana origin.
- `splitOpen()` in Explore opens a cramped half-width second pane (same behaviour as the built-in Jaeger datasource). The two-panel dashboard pattern is the recommended UX for trace viewing.

**Exit criterion met:** Grafana Explore with the Jaeger datasource shows a search results table with trace IDs. Clicking a trace ID either opens it inline on the dashboard or in a second Explore pane. CI passes.

---

### Phase 3 — Go backend binary: proxy mode — ✅ COMPLETE (2026-05-08)

**Goal:** Route datasource API calls through the Grafana server to reach Jaeger deployments not directly accessible from the browser. The iframe itself is unaffected — it always loads from `jaegerPublicURL`.

**Authentication context:**

When Grafana and Jaeger are deployed in the same private network (not individually SSO-protected), all browser-to-Jaeger requests are blocked because Jaeger has no public address. The Go binary solves the API-call side of this: `/api/traces`, `/api/services`, `/api/operations` are forwarded server-side, so the search results table and health check work. The iframe still requires a browser-reachable Jaeger origin for the SPA (see Proxy Mode Limitations below).

Additionally, Jaeger supports `--query.bearer-token-propagation`: when enabled, Jaeger forwards the incoming `Authorization` header to the trace storage backend for per-user access control. The Go binary extracts the user's bearer token from the incoming Grafana request and injects it into all outgoing Jaeger requests.

**What was built:**

- `packages/datasource/pkg/main.go`: entry point using `datasource.Manage` from `grafana-plugin-sdk-go`.
- `packages/datasource/pkg/plugin.go`: `JaegerDatasource` struct; `CheckHealth` (verifies `/api/services` reachability); `CallResource` (routes all requests through the proxy when proxy mode is on).
- `packages/datasource/pkg/proxy.go`: `proxyToJaeger` forwards the full request (method, path, query string, body, safe headers) to the configured internal Jaeger URL; propagates `Authorization` header for bearer token pass-through.
- `packages/datasource/Magefile.go` + `go.mod` (`tool github.com/magefile/mage`): Go binary built via `go tool mage build:linuxARM64 build:linux` without requiring a globally installed `mage`.
- `packages/datasource/src/components/ConfigEditor.tsx`: "Proxy mode" toggle, "Jaeger UI URL" field (direct mode), and "Jaeger internal URL" field (proxy mode).
- `packages/datasource/src/types.ts`: `jaegerPublicURL` (browser-accessible Jaeger URL, used by the panel iframe in both modes); `jaegerInternalURL` (server-accessible URL, used by Go proxy in proxy mode).
- `packages/datasource/src/datasource/datasource.ts`: routes all API calls through `/api/datasources/uid/<uid>/resources/...` when `proxyMode=true`, so service discovery, trace search, and health check all flow through the Go proxy.
- `packages/panel/src/components/JaegerPanel.tsx`: reads `jaegerPublicURL` from the datasource's `jsonData` via `getDataSourceSrv().getInstanceSettings(uid)`, using it as the iframe base in all modes. `datasourceUid` panel option added; `DataSourcePicker` custom editor replaces the old text-field `jaegerBaseUrl`.
- Provisioned `Jaeger (proxied)` datasource (`uid: jaeger-proxied`) for testing alongside the direct-mode datasource; provisioned `Jaeger Traces (proxied)` dashboard.

**Validated (2026-05-08):**
- Health check: "Connected to Jaeger at http://jaeger:16686" when proxy mode is enabled with a reachable Jaeger.
- Search results table populates via `/api/datasources/uid/jaeger-proxied/resources/api/traces?...` (visible in DevTools Network tab).
- Two-panel dashboard works identically with the proxied datasource for API calls.
- Bearer token forwarding: code is in place (`Authorization` header is propagated) but **not tested** end-to-end — requires a Jaeger deployment with `--query.bearer-token-propagation` enabled and a real SSO-issued token. This remains an open validation item.

**Proxy Mode Limitations: CSP Sandbox**

Proxy mode provides server-side proxying of Jaeger's JSON API calls. It does **not** proxy the Jaeger SPA (HTML + JavaScript) to the iframe.

Grafana unconditionally adds `Content-Security-Policy: sandbox` to every response that passes through its proxy infrastructure, regardless of plugin type or proxy mechanism:

- **CallResource** (`/api/datasources/uid/<uid>/resources/*`): `pkg/plugins/manager/client/client.go:SetCSPHeader` — applied unconditionally to all plugin types.
- **DataProxy** (`/api/datasources/proxy/uid/<uid>/*`): `pkg/util/proxyutil/reverse_proxy.go:modifyResponse` → `client.SetCSPHeader` — same sandbox on every proxied response.
- **App Plugin frontend routes** (`/a/<plugin-id>/*`): serve `hs.Index` (the Grafana shell), not a raw HTTP proxy — cannot proxy Jaeger HTML/JS.

The `sandbox` CSP directive prohibits script execution. The Jaeger UI is a React SPA that requires JavaScript to run. Therefore the iframe `src` must always point to a browser-reachable Jaeger origin; it cannot go through any Grafana proxy path.

What this means in practice:
- **API proxy works**: datasource TypeScript routes `/api/traces`, `/api/services` etc. through `CallResource` — JSON responses, no script execution, sandbox does not affect them.
- **SPA proxy does not work**: the iframe `src` cannot be set to any Grafana proxy path.

**Path forward for full SSO iframe proxy: external sidecar**

In SSO deployments where Jaeger is not browser-accessible, the iframe will fail regardless of proxy mode. The only solution is a proxy that lives outside Grafana's request pipeline:

1. **SSO gateway in front of Jaeger** (e.g. oauth2-proxy): a browser-accessible reverse proxy that authenticates the user and forwards requests to the internal Jaeger. The panel iframes directly to this gateway's URL via `jaegerPublicURL`. No plugin changes needed — operators configure `jaegerPublicURL` to point at the gateway. This is the lowest-effort path for deployments with an existing SSO infrastructure.

2. **Dedicated sidecar proxy**: a small HTTP reverse proxy deployed alongside Grafana, accessible from the browser at a distinct port or hostname, forwarding to the internal Jaeger URL and handling SSO token validation. The datasource would gain a `jaegerProxyURL` field pointing at this sidecar.

Both options are deployment-side solutions. The plugin's role is to expose a configurable `jaegerPublicURL` that operators point at whichever browser-accessible Jaeger endpoint they have.

**Constraints carried forward:**
- `jaegerInternalURL` is stored in `jsonData` (browser-visible). For hardened deployments this should move to `secureJsonData`. Tracked as future improvement.
- CI does not yet build the Go binary on every PR (tracked for a follow-up CI update).

**Exit criterion met (revised):** Proxy mode works for datasource API calls. The panel iframe always loads from `jaegerPublicURL`.

---

### Phase 4 — Jaeger UI `uiEmbed` improvements (jaeger-ui repo, 1–2 days)

**Goal:** Address the UX gaps identified in Phase 0 so the embedded experience is clean.

**Tasks:**
1. Audit existing `uiEmbed` flags against the embedded UX observed in Phase 0.
2. Add `uiTimelineHideViewSwitcher=1` to suppress the view-type toolbar (timeline/graph/flamegraph/statistics switcher) when only the timeline is needed.
3. Add any other flags identified in Phase 0 (e.g., hiding the search bar in the trace detail header, fixing the diff graph resize on panel resize).
4. Files: `packages/jaeger-ui/src/utils/embedded-url.ts`, `packages/jaeger-ui/src/types/embedded.ts`, `TracePageHeader/AltViewOptions.tsx`.

**Exit criterion:** The embedded trace view has no extraneous chrome; the UX is comparable to a native panel.

---

### Phase 5 — `uiLinkPatterns` (jaeger-ui repo, 3–5 days)

**Goal:** Allow the Grafana plugin to inject span-to-Grafana link patterns at embed time without requiring Jaeger server reconfiguration.

**Tasks:**
1. Extend `EmbeddedState` (`types/embedded.ts`) with `linkPatterns?: LinkPatternsConfig[]`.
2. Parse `uiLinkPatterns=<base64url-json>` in `embedded-url.ts`.
3. In `model/link-patterns.ts`, merge embedded patterns with config-file patterns (embedded takes precedence).
4. Add a "Span link patterns" section to the Grafana datasource `ConfigEditor`; base64-encode the patterns and append to every iframe URL.

**Exit criterion:** A user can configure a span-to-Grafana-Explore link in the datasource config and see it appear on span attributes in the embedded trace view.

---

## Deliverables Summary

| Deliverable                                  | Ph 0 | Ph 1 | Ph 2 | Ph 3 | Ph 4 | Ph 5 |
|----------------------------------------------|:----:|:----:|:----:|:----:|:----:|:----:|
| Manual PoC: iframe in Grafana panel          | ✅    |      |      |      |      |      |
| Plugin scaffolding (jaeger repo)             |      | ✅    |      |      |      |      |
| Panel plugin (iframe, trace + diff)          |      | ✅    |      |      |      |      |
| Datasource plugin + QueryEditor              |      |      | ✅    |      |      |      |
| `preferredVisualisationPluginId` on frames   |      |      | ✅    |      |      |      |
| Panel DataFrame-driven rendering path        |      |      | ✅    |      |      |      |
| Search results with trace-ID data links      |      |      | ✅    |      |      |      |
| Variable support                             |      |      | ✅    |      |      |      |
| CI workflow + Playwright tests               |      |      | ✅    |      |      |      |
| Go binary + Magefile + `go tool mage`        |      |      |      | ✅    |      |      |
| API proxy via CallResource                   |      |      |      | ✅    |      |      |
| `jaegerPublicURL` as single source of truth  |      |      |      | ✅    |      |      |
| `DataSourcePicker` in panel options          |      |      |      | ✅    |      |      |
| Bearer token forwarding (code; untested)     |      |      |      | ⚠️    |      |      |
| `jaegerInternalURL` in `secureJsonData`      |      |      |      |       | ✅    |      |
| Grafana plugin catalog submission + signing  |      |      |      |       |      | ✅    |
| `uiEmbed` flag additions (jaeger-ui)         |      |      |      |      | ✅    |      |
| `uiLinkPatterns` URL param (jaeger-ui)       |      |      |      |      |      | ✅    |

---

## References

- Grafana CallResource CSP: `pkg/plugins/manager/client/client.go:SetCSPHeader` (grafana/grafana)
- Grafana DataProxy CSP: `pkg/util/proxyutil/reverse_proxy.go:modifyResponse` (grafana/grafana)
- Grafana App Plugin routes: `pkg/api/api.go` lines 175–176, handler `hs.Index` (grafana/grafana)
- `grafana-plugin-sdk-go` datasource.Manage: `backend/datasource/manage.go`
- `grafana-plugin-sdk-go` app.Manage: `backend/app/manage.go`
- httpadapter for CallResource: `backend/resource/httpadapter/handler.go`
