# ClimaGrid — Product Requirements Document

**Status:** v1.0 (fresh init, post-security-review)
**Owner:** Solo dev / small team
**Demo city:** Pune, India (configurable, single-city launch)

## 1. Problem

Urban heat islands and climate-vulnerability data exist (satellite LST, NDVI, OSM infrastructure, open weather data) but are scattered across specialist tools that require GIS expertise. There's no simple, public, no-friction way for a citizen, student, or local planner to *see* where a city is hottest, why, and what greening/shading interventions would plausibly help.

## 2. Product Vision

A public, read-only, map-first website where anyone — no account, no signup — can:
- View a city's heat/vegetation/built-up-density layers on an interactive map
- Understand *why* an area runs hot (low vegetation, high built-up density, low tree cover)
- Sketch a hypothetical intervention (e.g. "add a park here") and see an instant, client-side estimate of its cooling effect
- Learn — this is explicitly an educational/awareness tool, not a policy-of-record system

## 3. Explicit Non-Goals (locked in from the security review)

- **No user accounts, no login, no auth system.**
- **No public write endpoints.** Nothing a visitor does is saved to the server.
- **No crowd-sourced sensor ingestion.** All data comes from satellite/open-data sources pulled by a scheduled backend pipeline — this removes the entire "public write API" attack surface from the original design.
- **No PII collected**, ever. No accounts means nothing to leak.
- Not a decision-of-record tool for real municipal policy — it's an educational visualization. (Say so in the UI footer.)

## 4. Core Features (v1)

### 4.1 Heat & Climate Map
- Base map (MapLibre GL via `mapcn` components)
- Toggleable layers: Land Surface Temperature (LST), NDVI (vegetation), built-up density, road/traffic density (from OSM)
- Grid-cell click → popup with the underlying values for that cell
- Legend + layer opacity controls

### 4.2 Vulnerability View
- Ward/neighborhood-level heat-vulnerability index (HVI), computed server-side by the pipeline, served read-only
- Choropleth overlay, ward-level granularity only (no finer — avoids any re-introduction of privacy concerns even though there's no PII to begin with; keeps the data meaningful rather than noisy)

### 4.3 Mitigation Simulator (client-side only)
- User draws a polygon (park, tree cover, cool-roof zone) directly on the map
- Cooling-impact estimate computed **entirely in the browser** using a simplified, documented formula against the already-loaded grid data (see `ARCHITECTURE.md §4`)
- Nothing is sent to or stored on the server — refresh the page, it's gone. This is a deliberate simplicity/security trade-off, stated in the UI ("this is a local sketch, not saved").
- Optional: "Share this view" via a URL that encodes the polygon in the query string (no server storage — the browser round-trips the state)

### 4.4 Learn / Explainers
- Static educational content: what is an urban heat island, how NDVI/LST work, why this matters — supports the "improve his knowledge" goal directly without needing any backend at all

## 5. Target Users

- Curious residents of the demo city
- Students / educators (environmental science, urban planning)
- Journalists / researchers wanting a quick visual reference
- Not: certified urban planners making binding decisions (out of scope, stated explicitly)

## 6. Success Metrics (informal, no accounts to instrument deeply)

- Page loads / unique visitors (via privacy-respecting analytics — see `SECURITY.md`)
- Layer-toggle engagement (are people exploring more than one layer?)
- Time spent in simulator (proxy for "did they play with it")
- No PII-based metrics, by design

## 7. Out-of-Scope for v1 (future consideration only)

- Multi-city support (architecture should not preclude it, but v1 ships one city)
- Any server-persisted user content
- Real-time sensor networks
- Mobile app (responsive web is sufficient)

## 8. Open Questions for Later Phases

- If multi-city is added later: does city selection stay static (a dropdown of pre-pipelined cities) or become dynamic (user types any city, triggers on-demand pipeline run)? The latter reopens abuse-surface questions — defer deliberately.
