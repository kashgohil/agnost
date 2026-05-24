# REASONING

Track A: a sentiment & insights engine for conversational AI agents. Conversations come in (OpenTelemetry-shaped), get classified per-turn, dedup'd into intents, clustered, and turned into typed, actionable insights for PMs and engineers. This document defends the substantive technical decisions and rejects the obvious alternatives.

The brief asks for **insights, not metrics** — *"20% of users requesting refunds due to X"*, *"hidden feature request Y"*. The system has to produce that shape, not a query result in prose form.

---

## Pipeline

```mermaid
flowchart TD
    A["POST /v1/traces<br/><i>Bun + Elysia</i>"] --> B[("conversations<br/>turns<br/>tool_calls<br/><i>Postgres</i>")]
    B --> C["Per-conversation signal extraction<br/><i>LLM · classify-then-cluster</i>"]
    C --> D[("turn_signals<br/>intent · sentiment<br/>frustration_markers · is_repeat")]
    D --> E["Sync distinct intents → embed<br/><i>OpenRouter + pgvector</i>"]
    E --> F["HDBSCAN + UMAP<br/><i>Python subprocess · ~40 LoC</i>"]
    F --> G[("intents<br/>cluster_id · position_x,y")]
    G --> H["Aggregate per cluster → classify<br/><i>deterministic rules</i>"]
    H --> I[/"tags<br/>problem · trajectory · severity"/]
    I --> J["Generate insight content<br/><i>LLM</i>"]
    J --> K[("insights<br/>headline · recommendation<br/>key_observation · metrics")]
    K --> L["GET /v1/insights<br/><i>paginated · tag-filterable · with eval-set</i>"]
    L --> M["Next.js UI<br/><i>list · detail · clusters scatter · eval-set drawer</i>"]

    classDef store fill:#f4f4f5,stroke:#a1a1aa,color:#18181b
    classDef compute fill:#fff,stroke:#27272a,color:#18181b
    classDef io fill:#18181b,stroke:#18181b,color:#fafafa
    class B,D,G,K store
    class C,E,F,H,J compute
    class A,L,M io
```

---

## Key decisions

### 1. Classify-then-cluster, not embed-then-cluster

**The central architectural opinion.** Most "agent analytics" systems embed raw user messages and cluster the vectors directly. That fragments easily — same goal phrased five ways becomes five neighbours, not one cluster — and clusters drift across embedding-model versions.

Instead: an LLM extracts a **canonical intent string** per user turn (`refund_old_order`, `export_order_history`, snake_case verb-noun, 2-4 words). Those normalized strings get embedded and clustered. Same goal → same string → one cluster by construction.

**Rejected**: pure embedding clustering of raw messages. Noisier, harder to label, drifts across model versions.
**Two consequences we caught and fixed**:
1. *Singleton noise.* When canonicalization is *too* consistent, a dominant concept (e.g., 314 turns all labeled `export_order_history`) becomes one point in clustering space, and HDBSCAN drops singletons as noise. Fix: post-HDBSCAN noise promotion — any noise intent representing ≥15 user turns gets promoted to its own single-intent cluster.
2. *Filler intents surfacing as "insights".* Conversational glue like `provide_order_id`, `acknowledge`, `escalation_request` get promoted by rule #1 but aren't PM-actionable topics. Fix: `shouldSurfaceCluster` filter — a regex denylist of non-topic intent patterns plus a "must have some signal" check (negative sentiment OR drop-off OR escalation OR attributed cause OR capability gap). Suppressed clusters still exist in the DB and appear on the `/clusters` scatter; they just don't produce insights.

**What's left on the table**: per-message embedding precision; intents that genuinely have multiple meanings (we collapse them); the filler denylist is regex-based and would miss novel filler patterns.

### 2. HDBSCAN + UMAP via Python, everything else TypeScript

HDBSCAN's canonical implementation is Python. TS ports (`hdbscan-ts`, `density-clustering`'s DBSCAN) are weaker or less battle-tested. Clustering is occasional batch work, not a hot path.

**Choice**: TS for ingestion, signals, embeddings, persistence, API, UI. A 40-line Python script for the actual algorithm. Communicates via JSON-in/JSON-out subprocess. PEP 723 inline metadata + `uv run` means the entire Python footprint is one self-contained file with its own dependency list. No venv. No `requirements.txt`. Replaceable by editing one file.

**Rejected**: pure-Python project (TS preferred for API + UI ergonomics); pure-TS clustering (would have meant accepting DBSCAN's global-`eps` weakness vs. HDBSCAN's varying-density support).
**Why DBSCAN's weakness matters less here than in general**: intent strings, being normalized, cluster at fairly uniform density anyway. But HDBSCAN gives a better cluster-stability signal and tuning ergonomics (`min_cluster_size` only; no `eps` to fight).

UMAP gets a free ride in the same subprocess: same embeddings, seeded with `random_state=42` so projections are stable across re-clusters. Powers the Clusters scatter view.

### 3. Postgres + pgvector, not a dedicated vector DB

**Rejected**: Qdrant, Chroma, Pinecone, Weaviate.
**Choice**: Postgres 16 with the pgvector extension. HNSW index (`vector_cosine_ops`) on `intents.embedding`.

**Why**: the entire pipeline is *joins*. Cluster → intents → signals → turns → tool_calls → conversations, in one SQL statement. Failure attribution (the "due to X" clause from the brief) is literally:

```sql
WITH cluster_tool_calls AS (
  SELECT DISTINCT i.cluster_id, tc.id, tc.tool_name, tc.status
  FROM intents i JOIN turn_signals s ON s.intent = i.intent
  JOIN turns t ON t.id = s.turn_id JOIN turns t2 ON t2.conversation_id = t.conversation_id
  JOIN tool_calls tc ON tc.turn_id = t2.id
  WHERE i.cluster_id IS NOT NULL
)
SELECT cluster_id, tool_name, count(*) FILTER (WHERE status IN ('error','empty_result'))::float / count(*) AS failure_rate
FROM cluster_tool_calls GROUP BY cluster_id, tool_name;
```

A vector DB can't do that without exporting back to a relational store anyway. The `DISTINCT` CTE is load-bearing — without it, N user turns from one conversation multiply tool-call counts by N. We hit this bug and fixed it.

**Switch point**: 10M+ vectors with embedding-dominated workload. We're not close.

### 4. OpenRouter for all chat + embeddings, not direct OpenAI

**Why**: provider flexibility costs nothing and saves a lot. Same OpenAI-compatible SDK call, swap the `baseURL` and the model slug:

- Dataset generator: `openai/gpt-4.1-mini` (we tried `gpt-4o-mini` first; it failed on multi-tool-call constraint satisfaction; one-line change to upgrade)
- Signal extraction, cluster labeling, insight content: `openai/gpt-4o-mini` (single-pass classification is well within its range)
- Embeddings: `openai/text-embedding-3-small`

Single billing surface, one rate-limit dashboard, future swap to Claude/Gemini/Qwen is a model-slug change rather than an SDK migration. Each stage's model is environment-configurable (`SIGNAL_EXTRACTION_MODEL`, etc.) with sane defaults.

### 5. Three-axis tag typology, fixed vocab, evolved deliberately

Each insight carries tags from **three orthogonal axes**:

- **Problem** — `capability_gap`, `tool_failure`, `agent_reasoning_gap`, `friction`, `drop_off`, `latency`, `success_pattern`, `uncategorized`
- **Trajectory** — `emerging`, `chronic`, `declining`, `stable`
- **Severity** — `high`, `medium`, `low`

**Rejected**: single exclusive type (loses richness — a "tool_failure" can be either chronic or newly emerging, and PMs prioritize differently across that dimension); dynamic LLM-generated tags (filtering breaks the moment the model picks "rising" once and "trending_up" the next — you can't aggregate week-over-week).

**The structured layer is closed; the content layer is open.** Domain-specific richness lives in the LLM-generated `cluster_label`, `headline`, and `recommendation`. Tags exist for filtering, sorting, and trend stability. Mixing them is the mistake most "AI analytics" tools make.

`uncategorized` is a first-class tag, not a silent fallback. The pipeline reports `uncategorized_rate` — when it climbs above ~10%, the taxonomy is going stale. `TAXONOMY_VERSION` is stamped on every insight so trend data remains apples-to-apples across vocab changes.

### 6. Insights, not metrics: headline + recommendation + observation

The complaint we had to fix: *"X% of users did Y, Z% failed"* reads like a query result, not an insight. A number is **data**; an insight is **pattern + so-what**.

Every insight carries:

- **Headline** — the pattern in one sentence. Not metric-shaped. ("Refund policy is rejecting users with otherwise legitimate cases.")
- **Recommendation** — concrete action + rough impact. ("Extend the refund window to 60 days; ~183 conversations would resolve.")
- **Key observation** — optional, only when the data actually reveals something the aggregates don't. ("Most failures hit orders 31–60 days old — within reach of the policy line.")
- **Metrics still present** — volume %, sentiment, weekly sparkline, attribution, marker distribution, end-reason distribution. They *support* the insight rather than *being* the insight.

Deterministic logic computes the metrics and assigns the tags; the LLM only writes the prose. Metrics where it matters, prose where it adds polish. The prompt is given the cluster's metrics, its top-N dominant intent strings with turn counts, and 8 sample user messages, with hard rules: don't mention a tool unless attribution explicitly names one; don't describe a positive-sentiment cluster as a problem.

### 7. Eval-set is the engineer's loop-closer

A PM gets the insight. An engineer needs *examples* to write a fix against. Two affordances on every insight:

- `example_conversation_ids` — 3 precomputed previews on the insight row itself (cheap, instant)
- `GET /v1/insights/:id/eval-set?limit=&offset=` — paginated full conversation records (turns + tool_calls) for every conversation that contributed to the cluster. Ordered `started_at DESC` for stable iteration.

These are the conversations the insight was derived from. Ship a fix → re-run them → measure resolution rate. The brief asks for actionable insights; this is what makes them actionable beyond reading.

---

## What I'd reconsider

Honest about the rough edges I'd revisit before shipping this for real:

- **Cross-conversation intent canonicalization is implicit.** Each conversation is scored independently, so `refund_old_order` and `request_refund` from different conversations don't merge until embedding-time. The classify-then-cluster bet pays out at the clustering step, but a hybrid "here are the top-N known intents, reuse them if applicable" pre-pass would tighten it further. Logged as a follow-up.
- **Aggregations live in TS, not SQL.** The per-cluster pipeline in `aggregate.ts` uses Drizzle's `selectDistinct` and aggregates in Node memory rather than pushing `GROUP BY` into Postgres. Trade: end-to-end type safety + readability vs. database efficiency. At our scale this is fine; at ~50K+ conversations I'd push the heavy GROUP BY back into the DB via CTEs and accept the type cast at the boundary.
- **`min_cluster_size = 5` is a guess.** Calibrating against ground-truth labels (which we generate during dataset synthesis but don't currently use for evaluation) would let me defend the value rather than picking it.
- **Single intent per turn** loses signal when a user does two things in one message. Multi-intent extraction would help.
- **Non-topic intent filter is a regex denylist.** `shouldSurfaceCluster` suppresses clusters whose dominant intent matches a fixed pattern set (`acknowledge`, `provide_*`, `escalation_request`, ...). Works for known filler patterns; would miss novel ones. A learned classifier or a "must have a verb+object indicating a goal" check would scale better.

---

## What I'd do with a month

Scoped to *not* a redesign — extensions to what's there.

1. **Streaming / incremental clustering.** Postgres `LISTEN`/`NOTIFY` on new traces → worker that runs the per-conversation signal extraction immediately; clustering runs hourly with incremental updates rather than batch recompute.
2. **Real OTEL collector ingestion.** Today the inbound shape is OpenInference-flavored conversation documents. A v2 would accept raw OTLP spans from any OpenTelemetry-instrumented agent (LangSmith, AgentOps, OpenInference, custom) via a collector adapter.
3. **Cross-conversation canonicalization.** The hybrid open-vocab approach I deferred above. Two-pass: extract free intent, then map to nearest existing intent above similarity threshold; otherwise add to the vocabulary.
4. **Auto-PR'd fixes.** A `recommendation` for a `tool_failure` insight generates a proposed prompt patch or tool spec PR against the agent's repo. Cluster's eval-set runs in CI on the patch; merge requires resolution rate > threshold.
5. **Eval-set automation.** Each insight gets a runnable evaluation harness — point it at a new agent build, see how many of the cluster's conversations now resolve, and how many cleanly-resolved baseline conversations regress.
6. **Drift detection as an insight type.** Week-over-week intent distribution comparison. New tag axis: `regressing` (something that was stable started going wrong).
7. **Taxonomy maintenance loop.** When `uncategorized_rate` crosses threshold, an LLM proposes candidate tags from the uncategorized clusters' samples. Human approves into code. Bumps `TAXONOMY_VERSION`. Background job re-tags historical insights.
8. **Multi-tenant isolation.** Tenant-scoped agents, intents, clusters, insights. Cross-tenant intent embeddings shared (cheaper, anonymized), per-tenant clustering.
9. **Embedding model migration.** Today, re-embedding requires re-clustering. Versioned `intents.embedding_v` + a migration job that re-clusters within a model version without invalidating historical insights.
10. **Cost & quality observability.** Per-stage LLM spend, retry rates, validation failure rates, embedding cache hits. Treat this analytics pipeline the same way it treats its target agents.

---

## Stack

| Layer | Choice | Why over alternatives |
|---|---|---|
| Runtime | Bun | Native TS, fast spawn (relevant for the Python subprocess), no build step |
| API | Elysia | Idiomatic Bun, light, doesn't impose conventions |
| DB | Postgres 16 + pgvector | Joins are the killer feature; HNSW for ANN; one ops surface |
| ORM | Drizzle | Type-safe queries; CTEs and `inArray` as first-class |
| Validation | Zod everywhere | Same schema used at ingestion, LLM structured outputs, and API responses |
| LLM | OpenRouter | Provider-swappable; OpenAI-compatible SDK; single billing |
| Clustering | `hdbscan` + `umap-learn` via subprocess | Canonical implementation; ~40 LoC of Python; PEP 723 inline deps |
| Frontend | Next.js 15 + Tailwind v4 + shadcn-style primitives | Server components for data, client only where needed; URL-state filters; no chrome over the data |

— Kashyap Gohil
