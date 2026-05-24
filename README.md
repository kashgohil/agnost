# Sentiment Analytics Engine

The system ingests conversations, extracts normalized user intent and sentiment signals, clusters emerging topics, attributes clusters to tool failures when possible, and exposes PM/engineer-facing insights through APIs and a small Next.js UI.

For design rationale, tradeoffs, rejected alternatives, and one-month extensions, see [REASONING.md](./REASONING.md).

## What It Does

- Ingests OpenInference-flavored conversation traces through `POST /v1/traces`.
- Stores conversations, turns, tool calls, extracted signals, intent embeddings, clusters, and insights in Postgres.
- Extracts per-user-turn signals with an LLM:
  - canonical intent
  - sentiment
  - frustration markers
  - repeat-intent flag
- Embeds distinct intent strings and clusters them with HDBSCAN.
- Partitions each cluster's conversations by outcome (`succeeded`, `failed_at_tool`, `dropped_off`, `escalated`, `agent_gave_up`, `unresolved`). One cluster can produce multiple insights, one per partition.
- Generates each insight as:
  - headline (the pattern)
  - recommendation (what to do)
  - optional key observation (specific finding)
  - tags across three axes: problem / trajectory / severity
  - supporting metrics: volume %, sentiment, weekly trend, attributed tool-failure cause, marker + end-reason distributions
  - example conversations and a paginated eval-set endpoint
- Provides a UI for insight review, cluster inspection (with a 2D UMAP scatter), and eval-set browsing.

See [REASONING.md](./REASONING.md) for why the insight unit is `(cluster, partition)` rather than `cluster`, and how proximity-based tool attribution works.

## Stack

- Runtime/API: Bun + Elysia
- Database: Postgres 16 + pgvector
- ORM: Drizzle
- Validation: Zod
- LLM access: OpenRouter with OpenAI-compatible SDK
- Clustering: Python `hdbscan` + `umap-learn` via a narrow JSON subprocess
- Frontend: Next.js 15 + Tailwind CSS

## Prerequisites

- Bun
- Docker
- Python runner `uv` available on PATH for the clustering script
- OpenRouter API key

The Python clustering script uses PEP 723 inline dependency metadata, so `uv run scripts/cluster.py` installs/caches the Python dependencies automatically.

## Environment

Create `.env` in the repo root:

```bash
DATABASE_URL=postgres://agnost:agnost@localhost:5433/agnost
PORT=3000
OPENROUTER_API_KEY=sk-or-v1-...
```

Optional model overrides:

```bash
SIGNAL_EXTRACTION_MODEL=openai/gpt-4o-mini
EMBEDDING_MODEL=openai/text-embedding-3-small
CLUSTER_LABELING_MODEL=openai/gpt-4o-mini
INSIGHT_HEADLINE_MODEL=openai/gpt-4o-mini
CLUSTER_RUNNER="uv run"
```

## Quickstart

Install dependencies:

```bash
bun install
cd web
bun install
cd ..
```

Start Postgres:

```bash
docker compose up -d
```

Run migrations:

```bash
bun db:migrate
```

Generate a small smoke-test dataset:

```bash
bun generate -- --scenario data/scenarios/shopco.yaml --out data/conversations/shopco --limit 25 --concurrency 5
```

Start the API server in one terminal:

```bash
bun dev
```

Ingest the generated dataset in another terminal:

```bash
bun ingest -- --dir data/conversations/shopco
```

Run the analytics pipeline:

```bash
bun extract-signals
bun cluster
bun generate-insights
```

Start the UI:

```bash
cd web
bun dev
```

Open:

- API health: `http://localhost:3000/health`
- Insights API: `http://localhost:3000/v1/insights`
- UI: `http://localhost:3001`
- Clusters UI: `http://localhost:3001/clusters`

## Full Dataset

The full synthetic dataset is intentionally not committed. It is generated from the committed scenario source of truth at [data/scenarios/shopco.yaml](./data/scenarios/shopco.yaml).

Generate all 500 conversations:

```bash
bun generate -- --scenario data/scenarios/shopco.yaml --out data/conversations/shopco --concurrency 10
```

This makes LLM calls and can take several minutes. The generator also writes:

```text
data/conversations/shopco/_ground_truth.json
```

That ground-truth file records the seeded failure mode for each generated conversation. The current pipeline does not consume it during inference; it exists to inspect and evaluate whether surfaced insights match the synthetic scenario design.

## API

### `POST /v1/traces`

Ingests one conversation trace. Re-posting the same `conversation_id` is idempotent.

```bash
curl -X POST http://localhost:3000/v1/traces \
  -H "Content-Type: application/json" \
  --data @data/conversations/shopco/conv_0000_1311187a0e.json
```

### `GET /v1/insights`

Lists generated insights.

```bash
curl "http://localhost:3000/v1/insights?sort=volume_desc&limit=10"
```

Supported query params:

- `tag`: repeatable, AND semantics, for example `?tag=tool_failure&tag=high`
- `min_volume_pct`: number between `0` and `1`
- `min_conversation_count`: integer
- `sort`: `volume_desc`, `volume_asc`, `sentiment_asc`, `recent`
- `include_uncategorized`: boolean
- `limit`: `1` to `200`
- `offset`: integer

### `GET /v1/insights/:id`

Fetches one insight. IDs are composite (`insight_NNNN_<partition>`).

```bash
curl http://localhost:3000/v1/insights/insight_0003_failed_at_tool
```

### `GET /v1/insights/:id/eval-set`

Returns paginated full conversations that contributed to the insight, filtered to its partition.

```bash
curl "http://localhost:3000/v1/insights/insight_0003_failed_at_tool/eval-set?limit=5&offset=0"
```

### `GET /v1/clusters`

Returns cluster metadata and 2D intent positions for the cluster scatter view.

```bash
curl http://localhost:3000/v1/clusters
```

## Useful Scripts

```bash
bun generate            # generate synthetic conversations
bun ingest              # bulk-ingest generated conversations into the API
bun extract-signals     # run LLM signal extraction
bun cluster             # embed intents, run HDBSCAN/UMAP, label clusters
bun generate-insights   # aggregate clusters and generate insight content
bun db:migrate          # apply Drizzle migrations
bun dev                 # run API server
```

Frontend:

```bash
cd web
bun dev
bun run build
bun run lint
```

## Verification

Typecheck backend:

```bash
bunx tsc --noEmit
```

Typecheck frontend:

```bash
bunx tsc --noEmit -p web/tsconfig.json
```

Build frontend:

```bash
cd web
bun run build
```

Lint frontend:

```bash
cd web
bun run lint
```

## Notes And Constraints

- `data/conversations/**` is generated output and should stay out of git.
- `REASONING.md` is the main architecture document requested by the assignment.
- The default setup assumes a fresh local Postgres volume. If migrating an existing non-empty database, review the migrations first.
- The pipeline is batch-oriented for the take-home. A production version would move signal extraction to an async worker and run clustering on a schedule.
