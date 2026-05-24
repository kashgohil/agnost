# REASONING

Sentiment engine for conversational AI agents. Conversations come in (OpenTelemetry-shaped), get classified per-turn, deduped into intents, then clustered and turned into typed, actionable insights for PMs and engineers. This document defends the substantive technical decisions.

Its **insights, not metrics** — *"20% of users requesting refunds due to X"*, *"hidden feature request Y"*. The system has to produce that shape, not a query result in prose form.

---

## Pipeline

```mermaid
flowchart TB
    A["POST /v1/traces<br/><i>Elysia</i>"]
    A --> Convos[("conversations · turns · tool_calls")]

    Convos --> SigLLM(["LLM · per-conversation signal extraction<br/><i>intent · sentiment · markers · is_repeat</i>"])
    SigLLM --> Sigs[("turn_signals")]

    Sigs --> Sync["Sync distinct intents into the intents table"]
    Sync --> EmbLLM(["LLM · embed each intent<br/><i>text-embedding-3-small</i>"])
    EmbLLM --> HDB["HDBSCAN clustering<br/><i>Python subprocess · ~40 LoC</i>"]
    HDB --> LabLLM(["LLM · name each cluster"])
    LabLLM --> Ints[("intents · clusters<br/><i>cluster_id · embedding · label</i>")]

    Ints --> Agg["Aggregate metrics + classify tags<br/><i>deterministic</i>"]
    Agg --> ConLLM(["LLM · insight content<br/><i>headline · recommendation · observation</i>"])
    ConLLM --> Ins[("insights")]

    Ins --> API["GET /v1/insights<br/><i>paginated · tag-filterable · with eval-set</i>"]
    API --> UI["Next.js UI<br/><i>list · detail · clusters scatter · eval-set drawer</i>"]

    classDef store fill:#f4f4f5,stroke:#a1a1aa,color:#18181b
    classDef compute fill:#fff,stroke:#27272a,color:#18181b
    classDef llm fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef io fill:#18181b,stroke:#18181b,color:#fafafa
    class Convos,Sigs,Ints,Ins store
    class Sync,HDB,Agg compute
    class SigLLM,EmbLLM,LabLLM,ConLLM llm
    class A,API,UI io
```

---

## Key decisions

### 1. Classify-then-cluster, not embed-then-cluster

**Chose:** an LLM extracts a canonical intent string per user turn (`refund_old_order`, snake_case verb-noun, 2-4 words). Those normalized strings get embedded and clustered, not the raw messages.

**Why:**
- Same goal -> same string -> one cluster by construction. No fragmentation when users phrase things differently.
- Clusters are interpretable for free - the intent strings themselves are the label.
- Stable across embedding-model versions (the strings are the input; embeddings are just a layer of math on top).

**Alternative:**
- Pure embedding clustering of raw messages - noisier, drifts with model versions, needs a second labeling pass anyway.

**Two consequences we caught and fixed:**

**1. Singleton noise.** The clustering step doesn't operate on user messages directly - it operates on the *deduplicated set of intent strings* the LLM has extracted across the corpus. So if 314 different user messages all get classified with the same canonical intent (e.g., `export_order_history`), the clustering layer sees that as **one row**, not 314. HDBSCAN requires a minimum number of distinct neighbours to form a cluster (`min_cluster_size`), so anything sitting as a lone row gets labelled noise, even when it represents a huge fraction of the user base in reality.

The result: the strongest patterns can quietly disappear from the output, *because* classification worked well, a little too well.

> **Fix:** post-HDBSCAN noise promotion. Any noise intent representing >=15 user messages gets promoted to its own single-intent cluster.

**2. Filler intents surfacing as insights.** Rule #1 also promotes conversational glue - `provide_order_id`, `acknowledge`, `escalation_request`. These aren't actionable topics, they are just part of the talk that show up everywhere, nothing insightful in them.

> **Fix:** `shouldSurfaceCluster` - a two-gate filter applied before insight generation.
> - **Gate A (denylist):** regex match against non-topic intent patterns.
> - **Gate B (signal check):** the cluster must show at least one real signal. It can be negative sentiment, drop-off, escalation, attributed tool failure or a capability gap.
>
> These suppressed clusters still live in the DB and appear on the `/clusters` scatter, they just don't produce insights.

**What's left on the table**: per-message embedding precision. Intents that genuinely have multiple meanings (right now, we collapse them). the filler denylist is regex-based and would miss novel filler patterns.

### 2. HDBSCAN via Python, everything else TypeScript

**Chose:** TS for everything (ingest · signals · embed · persistence · API · UI). One 40-line Python file does the actual clustering, called as a JSON-in/JSON-out subprocess.

**Why:**
- HDBSCAN's canonical implementation is Python; TS ports are weaker.
- TS is the most ergonomic stack for the API + UI, and the one I have most experience in.
- The Python boundary is small enough to be irrelevant — PEP 723 inline metadata + `uv run` means no venv, no `requirements.txt`, replaceable by editing one file.
- Clustering is batch work, not a hot path. Subprocess overhead doesn't matter.

**Alternative:**
- Pure-Python project - would have hurt API + UI ergonomics for no gain.
- Pure-TS clustering - would have meant DBSCAN's global-`eps` weakness (no varying-density support) or one of the less battle-tested hdbscan ports.

**Tangent on DBSCAN:** in general, varying-density support matters a lot. Here, less - intent strings are normalized so they cluster at fairly uniform density anyway. The bigger HDBSCAN win for us is `min_cluster_size`-only tuning; no `eps` to fight.

The same Python script also runs UMAP on the embeddings to produce a 2D projection used by the `/clusters` scatter. Purely visualization, not part of insight generation.

### 3. Postgres + pgvector, not a dedicated vector DB

**Chose:** Postgres 16 with the pgvector extension. HNSW index (`vector_cosine_ops`) on `intents.embedding`.

**Why:**
- The pipeline is *joins*. Cluster -> intents -> signals -> turns -> tool_calls -> conversations, in one SQL statement.
- One operational surface, not two systems to keep in sync.

**Alternative:**
- Qdrant / Chroma / Pinecone - would still need a relational store for the joins. Two systems to operate, two to keep consistent.

**Why this matters concretely** - failure attribution (the "due to X" clause from the brief) is literally:

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

A vector DB can't do that without exporting back to a relational store anyway. The `DISTINCT` CTE is the star here. Without it, N user messages from one conversation multiply tool-call counts by N. I got that issue and fixed it, thats how I came to understand it.

### 4. OpenRouter for all chat + embeddings, not direct OpenAI

**Chose:** OpenRouter as the gateway for every LLM and embedding call.

**Why:**
- I had ~$100 in credits there.
- Provider flexibility for free - same OpenAI-compatible SDK, swap `baseURL` and the model slug to change provider.

**Alternative:**
- Direct OpenAI - locks in one provider. Future swap to Claude / Gemini / Qwen would mean an SDK migration, not a config change.

**Model per stage** (all configurable via env, sane defaults):
- Dataset generator: `openai/gpt-4.1-mini`. Tried `gpt-4o-mini` first. It failed on multi-tool-call constraint satisfaction.
- Signal extraction, cluster labeling, insight content: `openai/gpt-4o-mini`. Single-pass classification is well within range and cheap.
- Embeddings: `openai/text-embedding-3-small`.

### 5. Three-axis tag typology, fixed vocab

**Chose:** every insight carries tags from three orthogonal axes, each with a fixed vocabulary:
- **Problem** — `capability_gap`, `tool_failure`, `agent_reasoning_gap`, `friction`, `drop_off`, `latency`, `success_pattern`, `uncategorized`
- **Trajectory** — `emerging`, `chronic`, `declining`, `stable`
- **Severity** — `high`, `medium`, `low`

**Why:**
- Multi-axis lets PMs slice independently. A `tool_failure` can be either `chronic` or `emerging`. They call for different responses.
- Fixed vocab makes filtering and trend aggregation possible. `WHERE 'emerging' = ANY(tags)` is stable across runs.
- Closed structured layer, open content layer. Domain-specific richness lives in the LLM-generated `cluster_label`, `headline`, and `recommendation`. Tags are for filtering and prose is for meaning.

**Alternative:**
- Single exclusive type - collapses two independent dimensions into one. Loses the ability to express "this is bad and rising fast" vs "this is bad and chronic."
- Dynamic LLM-generated tags - breaks aggregation the moment the model picks "rising" once and "trending_up" the next. Can't trend that.

Another detail is that`uncategorized` is a first-class tag, not a silent fallback. When the rate climbs above ~10%, the taxonomy is going stale. `TAXONOMY_VERSION` is stamped on every insight so trend data stays consistent across vocab changes.

### 6. Insights, not metrics: headline + recommendation + observation

**Chose:** every insight has a headline (pattern), a recommendation (what to do) and optionally a key observation (specific finding) and metrics as supporting evidence below them.

**Why:**
- A number is data; an insight is *pattern + what to do*. *"X% of users did Y"* reads like a query result.
- Splits the work: deterministic logic computes the metrics and assigns the tags. The LLM only writes the prose.
- Metrics still appear (volume %, sentiment, sparkline, attribution, distributions). They are the ones who help us identify insights. But they *support* the insight rather than *being* it.

**Alternative:**
- Metric-shaped output ("23% of users did Y") - easy to generate but doesn't tell a PM what to do. It doesn't convey the *why* behind the insight.
- LLM-classified everything - loses the consistency of the structured layer that powers filtering and trends.

**The four fields:**
- **Headline** - the pattern in one sentence. ("Refund policy is rejecting users with otherwise legitimate cases.")
- **Recommendation** - concrete action + rough impact. ("Extend the refund window to 60 days; ~183 conversations would resolve.") Speculative by nature. Can be improved with further iteration.
- **Key observation** - optional. Only when the data reveals something the aggregates don't. ("Most failures hit orders 31–60 days old - within reach of the policy line.")
- **Metrics** - volume %, sentiment, weekly sparkline, attribution, marker distribution, end-reason distribution.

The content-generation prompt receives the cluster's metrics, top-N dominant intent strings with message counts and 8 sample user messages, with two hard rules:
- don't mention a tool unless attribution explicitly names one
- don't describe a positive-sentiment cluster as a problem

### 7. Eval-set is the engineer's loop-closer

**Chose:** every insight exposes the conversations it was derived from, both as a quick preview and as a paginated full set.

**Why:**
- A PM gets the insight but its the engineer that they hand it to who needs *examples*. It helps them to implement a fix for the issue.
- The same conversations double as a test data set. Ship a fix, re-run them, measure resolution rate. Recommendations become verifiable, not just readable.

**Alternative:**
- Insight without examples - readable but not actionable.
- Inlining all conversations in the insight payload - eval sets can be 50+ conversations. It would bloat the list endpoint for no gain.

---

## What I'd do with a month

A mix of known limitations to harden and bigger extensions on top.

1. **Cross-conversation canonicalization.** Each conversation is scored independently today, so `refund_old_order` and `request_refund` from different conversations don't merge until embedding-time. Hybrid open-vocab pre-pass would tighten this: extract free intent, then map to the nearest existing intent above a similarity threshold, otherwise add to the vocabulary.
2. **Calibrate `min_cluster_size` and other thresholds.** Right now they're guesses. The synthetic dataset generator already emits ground-truth labels per conversation. Wire those into an evaluation harness and pick threshold values that best recover those seeded ground truth labels.
3. **Multi-intent extraction per turn.** Users sometimes say two things in one message ("I want a refund AND can you also redirect the package"). Today we collapse to one intent per turn and lose signal. Multi-label extraction would help.
4. **Replace the regex denylist with a learned filter.** `shouldSurfaceCluster` uses a fixed regex set (`acknowledge`, `provide_*`, `escalation_request`...). Works for known filler patterns but it would miss novel ones. A small classifier ("does this intent express a goal?") would scale better as the dataset grows.
5. **Eval-set as a runnable harness, then patch suggestions on top.** Today the eval-set is conversations a human reads. The next step is to make it executable — point the harness at a new agent build (Docker image, API endpoint), replay each conversation's user messages, capture the new tool calls, re-run signal extraction, and report *resolution rate on the cluster's conversations* and *regression rate on a baseline set*. The hard part isn't the harness itself but making replay deterministic when the agent under test hits real APIs (needs a tool-call sandbox or a "replay mode" the target agent opts into). Once that exists, an LLM-generated patch for a `tool_failure` insight can be pushed as a PR with the harness numbers attached — fixes get measured, not just shipped. The patch generation is speculative; the harness is the foundation that makes everything downstream of it verifiable.
6. **Real OTEL collector ingestion.** Today the inbound shape is OpenInference-flavored conversation documents. A better version accepts raw OTLP spans from any OpenTelemetry-instrumented agent (LangSmith, AgentOps, OpenInference, custom) via a collector adapter.
7. **Drift detection as an insight type.** Week-over-week intent distribution comparison. New tag axis: `regressing` — something that was stable started going wrong.
8. **Taxonomy maintenance loop.** When `uncategorized_rate` crosses threshold, an LLM proposes candidate tags from the uncategorized clusters' samples. Human approves into code. Bumps `TAXONOMY_VERSION`. Background job re-tags historical insights.
9. **Push heavy aggregations back into Postgres.** `aggregate.ts` currently runs the per-cluster aggregations in Node memory via Drizzle's `selectDistinct`. Fine at current scale; at ~50K+ conversations I'd move the heavy `GROUP BY` back to the DB via CTEs and accept the type cast at the boundary.
10. **Cost & quality observability.** Per-stage LLM spend, retry rates, validation failure rates, embedding cache hits. Treat this analytics pipeline the same way it treats its target agents.
