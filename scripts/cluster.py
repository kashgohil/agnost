# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "hdbscan>=0.8.38",
#     "numpy>=1.26.0",
# ]
# ///
"""HDBSCAN clustering — the entire Python footprint of this project.

JSON in via stdin, JSON out via stdout. No business logic, no DB access; this
script is pure algorithm. Invoked by src/clustering/cluster-driver.ts.

Dependencies are declared via PEP 723 inline script metadata above — `uv run`
auto-syncs them into a script-local cache on first invocation. No venv to
manage, no requirements.txt.

Contract:
    stdin:  {"vectors": float[][], "min_cluster_size": int, "min_samples": int}
    stdout: {"labels": int[], "probabilities": float[]}

Labels: cluster ID >= 0 for cluster members, -1 for noise points.
Probabilities: soft membership score in [0, 1]; 0 for noise.
"""

import json
import sys

import hdbscan
import numpy as np


def main() -> None:
    req = json.load(sys.stdin)
    vectors = np.array(req["vectors"], dtype=np.float32)

    # L2-normalize so euclidean distance on these vectors is monotonic with
    # cosine distance. HDBSCAN's BallTree-based implementation doesn't support
    # cosine directly, so this is the standard workaround when clustering
    # text embeddings.
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    vectors = vectors / np.clip(norms, 1e-12, None)

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=int(req.get("min_cluster_size", 5)),
        min_samples=int(req.get("min_samples", 5)),
        metric="euclidean",
        cluster_selection_method="eom",
    )
    clusterer.fit(vectors)

    json.dump(
        {
            "labels": clusterer.labels_.tolist(),
            "probabilities": clusterer.probabilities_.tolist(),
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
