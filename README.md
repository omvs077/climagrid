# ClimaGrid

Public, read-only, no-login urban heat & climate visualization for Pune, India (demo city — configurable).

See `docs/PRD.md` for what this is and isn't, `docs/ARCHITECTURE.md` for how it's built, `docs/API_CONTRACT.md` for the API, and `docs/SECURITY.md` for the security posture.

## Repo Structure

```
climagrid/
├── web/                    # Next.js app (the only internet-facing component)
│   ├── app/
│   │   ├── page.tsx         # Map landing page
│   │   ├── learn/           # Static educational content
│   │   └── api/v1/          # Read-only route handlers
│   ├── components/          # mapcn-based map components, UI
│   └── lib/                 # DB client, validation schemas, rate limiter
├── pipeline/                # Python data pipeline (never internet-facing)
│   ├── run.py                # Entry point, scheduled by CI/cron
│   ├── sources/               # GEE, Overpass, Open-Meteo fetchers
│   ├── fusion.py               # Grid fusion + HVI computation
│   └── db.py                    # Parameterized writes to Postgres
├── docs/                    # This documentation set
└── .github/workflows/       # CI (lint/test/scan) + scheduled pipeline run
```

## Prerequisites

- Node.js 20+, pnpm (or npm)
- Python 3.12+, `uv` or `pip`
- A Postgres instance with PostGIS enabled — easiest local option: `docker compose up db`
- API keys (free tiers): Google Earth Engine service account, Open-Meteo (no key needed), OSM Overpass (no key needed)

## Local Setup

### 1. Database
```bash
docker compose up -d db          # local Postgres+PostGIS on :5432
cd pipeline && python -m alembic upgrade head   # or your migration tool of choice
```

### 2. Pipeline (run once to populate data)
```bash
cd pipeline
cp .env.example .env             # fill in GEE service account + DATABASE_URL
uv sync                          # or: pip install -r requirements.txt
python run.py --city pune
```

### 3. Web app
```bash
cd web
cp .env.example .env.local       # DATABASE_URL (read-only role recommended), rate-limit config
pnpm install
pnpm dev                         # http://localhost:3000
```

## Environment Variables

**`pipeline/.env`**
```
DATABASE_URL=postgres://...
GEE_SERVICE_ACCOUNT_JSON=...     # never commit this file/value
DEMO_CITY=pune
```

**`web/.env.local`**
```
DATABASE_URL=postgres://<readonly-role>@...   # use a read-only DB role here, not the pipeline's write role
UPSTASH_REDIS_URL=...            # for rate limiting
UPSTASH_REDIS_TOKEN=...
```

Note the **separate DB roles**: the web app connects with a Postgres role that only has `SELECT` on `spatial_grids` and `vulnerability_scores`. This means even if a bug or dependency vulnerability were exploited in `/web`, the attacker inherits a read-only DB connection — they cannot write, alter, or drop anything. Set this up as:
```sql
CREATE ROLE web_readonly LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE climagrid TO web_readonly;
GRANT SELECT ON spatial_grids, vulnerability_scores, pipeline_runs TO web_readonly;
```

## Running the Pipeline on a Schedule

`.github/workflows/pipeline.yml` runs `pipeline/run.py` weekly via GitHub Actions with secrets stored in repo settings (never in code). No inbound network exposure required — Actions runners initiate outbound calls only.

## Deployment

- **Web**: connect the repo to Vercel, set env vars in the dashboard, deploy `/web` as the root
- **DB**: Neon (free tier), enable PostGIS extension (`CREATE EXTENSION postgis;`)
- **Pipeline**: GitHub Actions scheduled workflow (simplest, free) — or Fly.io scheduled machine if you outgrow Actions' run-time limits

## CI

On every PR: lint (`eslint`, `ruff`) → tests (`vitest`/`pytest`) → `gitleaks` secret scan → `pip-audit`/`npm audit`. See `docs/SECURITY.md §4`.
