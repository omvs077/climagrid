# ClimaGrid — Security & Data Handbook

This supersedes the earlier vulnerability review for the original (login-based, crowd-sensor) design. Removing accounts and public writes eliminated most of that list outright; what's below is what's actually left, mapped against this simplified architecture.

## 1. What Was Eliminated By Design (not "fixed" — removed)

| Original risk category | Status |
|---|---|
| Auth/session/JWT compromise | N/A — no accounts exist |
| RBAC bypass / IDOR | N/A — no user-owned resources exist |
| Sensor spoofing / data poisoning / replay attacks | N/A — no public write endpoint exists |
| PII / geo-privacy exposure of crowd sensor owners | N/A — no crowd sensor data collected |
| Client-trusted business logic (simulator) | N/A by relocation — simulator runs client-side and is explicitly labeled illustrative, not authoritative; there's no server value to spoof |
| Secrets exposed to browser via direct third-party calls | Addressed structurally — all third-party API calls happen only inside `/pipeline`, which the browser never talks to |

This is the main takeaway: **the biggest security win here was scope reduction, not add-on controls.** Fewer moving parts that touch the public internet.

## 2. Remaining Attack Surface: the Public Read API

Even a read-only API can be abused. Controls:

| Risk | Mitigation |
|---|---|
| Scraping / flooding `/api/v1/*` to run up DB or hosting costs | IP-based rate limiting (Upstash Redis or Vercel's built-in) on every route; aggressive HTTP caching so repeat requests rarely hit the DB at all |
| Oversized `bbox` query pulling excessive data in one request | Server-side max-area cap on `bbox`, reject with `400` if exceeded |
| Malformed/malicious query params | Zod (or equivalent) schema validation on every route handler's input before it touches a query |
| SQL injection via query params | Parameterized queries / query builder only (Drizzle or `pg` with `$1` params) — never string-concatenate a query param into SQL |
| Response size abuse (someone requesting the whole city at max detail repeatedly) | Pagination or feature-count cap per response; cache headers make repeated requests cheap regardless |
| Basic volumetric DoS | Vercel's platform-level protections + rate limiting; if this ever gets serious, Cloudflare in front is the next lever, not needed at launch |

## 3. Data Pipeline (highest-trust component — protect the keys, not the network)

The pipeline is never internet-facing, but it does reach *out* to third parties and it writes to the shared DB, so:

| Risk | Mitigation |
|---|---|
| Third-party API keys (GEE, Overpass, Open-Meteo) leaking | Stored only as environment secrets in the CI/cron runner (GitHub Actions secrets or Fly.io secrets) — never in the repo, never shipped to `/web`, never logged |
| Malformed/hostile data from a third-party source (bad geometry, absurd values, huge payload) | Validate every field against expected ranges before writing (temp bounds, `ST_IsValid` on geometry, max payload size); reject and log rather than write on failure |
| Injection via the pipeline's own DB writes | GeoPandas/psycopg with parameterized inserts, never raw string SQL, even though the pipeline is "trusted" — defense in depth costs nothing here |
| Partial-write corruption if a pipeline run fails halfway | Wrap the full write in a single transaction per `pipeline_run_id`; public API only ever reads a fully-committed run |
| Third-party outage taking down the pipeline (not the public site) | Pipeline degrades gracefully — if a source fails, keep last-known-good data and mark the run `partial` in `pipeline_runs`; the public site is unaffected either way since it only reads the last committed state |
| Secrets/dependency drift | `pip-audit` in CI on every pipeline change; Dependabot on both `/web` and `/pipeline` |

## 4. Infrastructure Baseline (cheap, do these regardless of scope)

- HTTPS enforced (default on Vercel/Neon — verify no HTTP fallback)
- Security headers on `/web`: CSP scoped to your own origin + map tile provider, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (no reason this needs to be embeddable in an iframe)
- CORS: **no need to open it up** — the API is only ever called by your own frontend, so default same-origin is correct; don't add `Access-Control-Allow-Origin: *` unless a real external-consumer use case shows up
- Dependency/secret scanning in CI (`gitleaks`, Dependabot) on both `/web` and `/pipeline`
- Sentry on both components for error visibility

## 5. Privacy Posture

- No accounts, no cookies beyond what privacy-respecting analytics needs (Plausible: none; Vercel Analytics: none by default)
- No PII collected anywhere in the system — there is no user-generated content path at all
- Ward-level (not finer) granularity on vulnerability data by policy, not just because there's no PII to leak — keeps the visualization meaningful and avoids ever drifting toward block-level profiling if the schema is extended later
- Publish a one-paragraph "What data we collect: none" note in the footer/Learn page — cheap trust signal, costs nothing to be accurate about

## 6. Incident Response (lightweight, appropriate for this scale)

- Sentry alerts on pipeline failures and API 5xx spikes
- If a third-party API key is ever exposed (e.g. committed by accident): rotate immediately at the provider, force-push history scrub, treat as routine not catastrophic since no user data is at risk
- If rate limiting is bypassed and costs spike: Vercel/Neon usage alerts as a backstop; both platforms have hard spending caps available on free/low tiers

## 7. What to Revisit If Scope Grows

If a future version adds *any* of: user accounts, public writes, crowd sensors, or multi-city on-demand pipeline runs — pull the original ClimaGrid security review (the earlier, fuller document) back out. Most of that document's content is exactly what becomes relevant again at that point.
