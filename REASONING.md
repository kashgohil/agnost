# REASONING

Sentiment engine for conversational AI agents. Conversations come in (OpenTelemetry-shaped), get classified per-turn, deduped into intents, clustered into topics, partitioned by outcome, and turned into typed actionable insights for PMs and engineers.

---

## Pipeline

```mermaid
flowchart TB
    POST["POST /v1/traces"]
    POST --> Convos[("conversations")]
    Convos --> L1(["LLM · signal extract"])
    L1 --> Sigs[("turn_signals")]
    Sigs --> L2(["LLM · embed intents"])
    L2 --> HDB["HDBSCAN · Python"]
    HDB --> L3(["LLM · label cluster"])
    L3 --> Ints[("intents + clusters")]
    Ints --> Part["Partition by outcome<br/>+ aggregate + classify"]
    Part --> L4(["LLM · insight content"])
    L4 --> Ins[("insights<br/>(cluster × partition)")]
    Ins --> GET["GET /v1/insights"]
    GET --> UI["Next.js UI"]

    classDef store fill:#f4f4f5,stroke:#a1a1aa,color:#18181b
    classDef compute fill:#fff,stroke:#27272a,color:#18181b
    classDef llm fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef io fill:#18181b,stroke:#18181b,color:#fafafa
    class Convos,Sigs,Ints,Ins store
    class HDB,Part compute
    class L1,L2,L3,L4 llm
    class POST,GET,UI io
```

---

## Key decisions

### 1. Classify-then-cluster, not embed-then-cluster

**Chose:** an LLM extracts a canonical intent string per user turn (`refund_old_order`, snake_case verb-noun, 2-4 words). Those strings get embedded and clustered. The raw messages don't.

**Why:** users phrase the same goal five different ways. If you cluster the raw messages, you get five neighbours instead of one cluster, and the result drifts whenever you swap the embedding model. Clustering canonical intent strings means same goal becomes the same string becomes one row becomes one cluster. The strings double as the cluster label, so you skip a labeling pass entirely.

**Alternative:** cluster raw message embeddings directly. Noisier output, drift across model versions, and you end up needing a labeling pass anyway.

**Two consequences we caught and fixed:**

*Singleton noise.* Clustering runs on the deduplicated set of intent strings, not on the raw messages. So if 314 messages all resolve to one canonical intent (`export_order_history`), HDBSCAN sees a single row. Its `min_cluster_size` rule labels that row as noise. The strongest pattern in the dataset can disappear from the output, ironically because classification worked too well. Fixed it by promoting any noise intent representing 15+ user messages to its own single-intent cluster after HDBSCAN.

*Filler intents surfacing as insights.* The promotion rule above also surfaces conversational glue like `provide_order_id` and `acknowledge`. Those aren't actionable topics. Fixed it by two gate filter - `shouldSurfacePartition`. Gate A is a regex denylist of filler-shaped intents. Gate B requires the cluster to show at least one real signal: negative sentiment, drop-off, escalation, an attributed tool failure, or a capability gap.

### 2. Insight = (cluster, outcome partition), not cluster

**Chose:** clusters are topics. Outcomes are deterministic categorizations (`succeeded`, `failed_at_tool`, `dropped_off`, `escalated`, `agent_gave_up`, `unresolved`). Insights are generated per (cluster, partition) pair with enough volume.

**Why:** a topic plays out differently for different users. Refund conversations succeed when the order is within policy, fail at the tool when it isn't, and a handful of users drop off mid-flow. Collapsing all of that into one "refund insight" gives mixed-population averages that don't describe any single user reality. A PM reading "183 conversations, sentiment -0.38, attributed to `process_refund`" gets a sentence that's directionally right but doesn't tell them what to do.

After partitioning, the refund cluster splits into four insights:

| Partition | Conversations | Sentiment |
|---|---|---|
| `failed_at_tool` | 84 | -0.51 |
| `succeeded` | 43 | +0.55 |
| `dropped_off` | 30 | -0.75 |
| `escalated` | 20 | -0.83 |

Four stories, four different recommendations. The seeded truth has 110 refund-failure conversations; the failed_at_tool count is lower because seeded refund conversations also touch other clusters via incidental turns, and the proximity rule (below) splits their tool-call evidence honestly.

**Alternative:** push outcomes into the clustering features themselves. Two problems. Outcomes belong to conversations, but HDBSCAN clusters intents. Conflating them together may make clustering less effective.

So the two layers stay separate. HDBSCAN does unsupervised topic discovery on intent embeddings. `partitionConversation` does deterministic categorization on conversation attributes. They compose at the insight layer.

**Refinement we caught and fixed.** The first version of partition assignment used "did any tool fail in this conversation" to decide `failed_at_tool`. That bled across clusters. A refund conversation that incidentally hit a `check_inventory` error got the refund cluster tagged as a tool failure, and the lookup cluster inflated to 93 conversations against a seeded truth of 60. Fixed it by introducing proximity-based tool attribution. Each tool call is attributed to the user turn that triggered it. The most recent user turn before it in the same conversation. That user turn's intent's cluster is the cluster the tool call counts against. A failing `process_refund` call only counts against the refund cluster if the user turn that triggered it has a refund intent.

### 3. HDBSCAN via Python, everything else TypeScript

**Chose:** TypeScript for everything (ingestion, signal extraction, embeddings, persistence, API, UI). One 40-line Python file does the clustering. It runs as a JSON-in/JSON-out subprocess. PEP 723 inline metadata plus `uv run` means no venv, no `requirements.txt`. The script declares its own dependencies.

**Why:** HDBSCAN's reference implementation is Python and the TS ports are visibly weaker. The rest of the system is more comfortable in TS, especially the API and UI. Clustering is batch work, not on a hot path, so the subprocess hop doesn't matter.

**Alternative:** all-Python or All-TS. not bad options. just splitting things to what they are best for made more sense.

UMAP runs in the same subprocess on the same embeddings. It only powers the 2D scatter on the `/clusters` page. Not part of insight generation.

### 4. Postgres + pgvector, not a dedicated vector DB

**Chose:** Postgres 16 with pgvector. HNSW index using `vector_cosine_ops` on the intent embeddings.

**Why:** the whole pipeline is joins. Cluster -> intents -> signals -> turns -> tool_calls -> conversations. One SQL statement. One operational surface.

**Alternative:** Qdrant, Chroma, Pinecone. But they would need a relational store for joins. So you're running two systems and keeping them consistent.

Failure attribution (the brief's *"due to X"*) is computed from the join graph, then scoped per (cluster, partition). The DISTINCT CTE in the underlying query matters - without it, N user turns in one conversation multiply the tool-call counts by N. We hit that bug.

```sql
WITH cluster_tool_calls AS (
  SELECT DISTINCT i.cluster_id, tc.id, tc.tool_name, tc.status
  FROM intents i JOIN turn_signals s ON s.intent = i.intent
  JOIN turns t ON t.id = s.turn_id
  JOIN turns t2 ON t2.conversation_id = t.conversation_id
  JOIN tool_calls tc ON tc.turn_id = t2.id
  WHERE i.cluster_id IS NOT NULL
)
SELECT cluster_id, tool_name,
       count(*) FILTER (WHERE status IN ('error','empty_result'))::float / count(*) AS failure_rate
FROM cluster_tool_calls GROUP BY cluster_id, tool_name;
```

### 5. OpenRouter for chat and embeddings

**Chose:** No particular reason other than I had credits in OpenRouter.

**Per stage** (each configurable via env):
- Dataset generator: `openai/gpt-4.1-mini`. I tried `gpt-4o-mini` first; it kept failing on the multi-tool-call constraint.
- Signal extraction, cluster labeling, insight content: `openai/gpt-4o-mini`. Cheap, well within range.
- Embeddings: `openai/text-embedding-3-small`.

### 6. Three-axis tag typology, fixed vocab

**Chose:** every insight carries tags from three orthogonal axes, each with a fixed vocabulary:
- **Problem**: `capability_gap`, `tool_failure`, `agent_reasoning_gap`, `friction`, `drop_off`, `latency`, `success_pattern`, `uncategorized`
- **Trajectory**: `emerging`, `chronic`, `declining`, `stable`
- **Severity**: `high`, `medium`, `low`

**Why:** PMs slice on these independently. A tool failure can be emerging or chronic and the response differs in each case. Fixed vocab makes filtering and trend aggregation work - `WHERE 'emerging' = ANY(tags)` is a query that holds across runs. The structured layer is closed. The prose layer (headlines, recommendations, cluster labels) stays open. Mixing them is the thing that goes wrong in most "AI tagging" systems.

**Alternative:** a single exclusive type (collapses two real dimensions into one) or dynamic LLM-generated tags (filtering breaks as soon as the model picks "rising" once and "trending_up" the next).

`uncategorized` is a real tag, not a silent fallback. When its rate climbs above ~10%, the taxonomy is going stale. `TAXONOMY_VERSION` is stamped on every insight so historical trend data stays comparable across vocab changes.

### 7. Eval-set as the engineer's loop-closer

**Chose:** every insight exposes the conversations it came from. Three previews inline on the insight row, plus a paginated full set at `GET /v1/insights/:id/eval-set`, filtered to the insight's partition.

**Why:** a PM reads an insight. The engineer who has to fix it needs examples. The same conversations also double as a test set - ship the fix, replay them, measure the resolution rate. The recommendation becomes verifiable instead of just readable.

---

## What I'd do with a month

1. **Cross-conversation canonicalization.** Each conversation is scored independently today, so `refund_old_order` and `request_refund` from different conversations only merge at the embedding-clustering layer. A two-pass approach would tighten this - extract a free intent first, then either match it to an existing intent above a similarity threshold or add it to the vocabulary.
2. **Calibrate `min_cluster_size` and other thresholds.** They're guesses right now. The synthetic dataset already produces ground-truth labels per conversation. Wire those into an evaluation harness and pick threshold values that maximize recovery against the labels.
3. **Multi-intent extraction per turn.** Users sometimes pack two things into one message ("I want a refund AND can you redirect the package"). Today we collapse to one intent per turn and lose the second.
4. **Replace the filler-intent regex denylist with a learned filter.** `shouldSurfacePartition`'s Gate A is a fixed regex set. Works for known filler patterns but would miss novel ones. A small classifier ("does this intent express a user goal?") would scale better as the dataset grows.
5. **Eval-set as a runnable harness.** Make the eval-set executable. Point the harness at a new agent build, replay each conversation's user messages, capture the new tool calls, report a resolution rate on the partition and a regression rate on a baseline set. The hard part isn't the harness - it's making replay deterministic when the agent under test hits real APIs (needs a tool-call sandbox or a "replay mode" the agent opts into). Once that exists, LLM-generated patches for `tool_failure` insights can be auto-PR'd with the harness numbers attached. Fixes start being measured instead of just shipped.
6. **Real OTEL collector ingestion.** The inbound shape today is OpenInference-flavored conversation documents. A better version takes raw OTLP spans from any OpenTelemetry-instrumented agent through a collector adapter.
7. **Drift detection as an insight type.** Week-over-week intent distribution comparison. New tag axis: `regressing`, for something that used to be stable and started going wrong.
8. **Taxonomy maintenance loop.** When `uncategorized_rate` crosses a threshold, an LLM proposes candidate tags from the samples. A human approves them into code. That bumps `TAXONOMY_VERSION`. A background job re-tags historical insights against the new vocabulary.
9. **Push heavy aggregations back into Postgres.** `aggregate.ts` runs the (cluster, partition) aggregations in Node memory. Fine at current scale; at ~50K+ conversations I'd move the heavy `GROUP BY` operations back to the database via CTEs and accept the type-cast at the boundary.
10. **Cost and quality observability.** Per-stage LLM spend, retry rates, validation failure rates, embedding cache hits. Treat this analytics pipeline the same way it treats its target agents.
