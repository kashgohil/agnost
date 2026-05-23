# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "hdbscan>=0.8.38",
#     "numpy>=1.26.0",
#     "umap-learn>=0.5.6",
# ]
# ///
"""HDBSCAN clustering + UMAP 2D projection.

JSON in via stdin, JSON out via stdout. No business logic, no DB access; pure
algorithm. Invoked by src/clustering/cluster-driver.ts.

Two algorithms run together because they share the same input embeddings and
the projection is only useful in the context of the clustering result.

Contract:
    stdin:  {"vectors": float[][], "min_cluster_size": int, "min_samples": int}
    stdout: {
      "labels": int[],
      "probabilities": float[],
      "positions": [[x, y], ...]
    }

Labels: cluster ID >= 0 for cluster members, -1 for noise points.
Probabilities: soft membership score in [0, 1]; 0 for noise.
Positions: 2D UMAP projection, one [x, y] per input vector. Seeded so the
projection is stable across re-clusters.
"""

import json
import sys

import hdbscan
import numpy as np
import umap


UMAP_SEED = 42


def main() -> None:
    req = json.load(sys.stdin)
    vectors = np.array(req["vectors"], dtype=np.float32)

    # L2-normalize so euclidean distance is monotonic with cosine — standard
    # workaround for HDBSCAN's BallTree on text embeddings.
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    vectors = vectors / np.clip(norms, 1e-12, None)

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=int(req.get("min_cluster_size", 5)),
        min_samples=int(req.get("min_samples", 5)),
        metric="euclidean",
        cluster_selection_method="eom",
    )
    clusterer.fit(vectors)

    # UMAP 2D projection. Same normalized embeddings; cosine metric directly
    # since UMAP supports it. Seeded → stable across runs (otherwise the scatter
    # would jump every re-cluster, which is disorienting).
    n = len(vectors)
    n_neighbors = max(2, min(15, n - 1))
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=0.1,
        metric="cosine",
        random_state=UMAP_SEED,
    )
    positions = reducer.fit_transform(vectors).tolist()

    json.dump(
        {
            "labels": clusterer.labels_.tolist(),
            "probabilities": clusterer.probabilities_.tolist(),
            "positions": positions,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
