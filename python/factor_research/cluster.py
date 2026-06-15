# Stage 1: Factor clustering via Leiden/Louvain community detection
#
# Pipeline:
#   Factor IC time series → Pearson correlation matrix → distance matrix
#   → KNN adjacency graph → Leiden (multiple resolutions) → cluster labels
#
# Uses igraph for performance (10-50x faster than networkx on dense graphs).

import json
import numpy as np
import pandas as pd
from scipy.spatial.distance import squareform
from scipy.cluster.hierarchy import linkage, fcluster


def build_correlation_matrix(ic_matrix):
    """Build factor-factor correlation matrix from IC time series.

    Args:
      ic_matrix: (N_factors, N_dates) — IC values over time.
                 Each row is one factor's IC time series.

    Returns:
      corr: (N_factors, N_factors) Pearson correlation matrix of IC series.
      pval: (N_factors, N_factors) p-values (mostly unused, for reference).
    """
    n_factors = ic_matrix.shape[0]
    corr = np.eye(n_factors)
    pval = np.zeros((n_factors, n_factors))

    valid_mask = ~np.isnan(ic_matrix)
    valid_counts = valid_mask.sum(axis=1)

    for i in range(n_factors):
        for j in range(i + 1, n_factors):
            mask = valid_mask[i] & valid_mask[j]
            if mask.sum() < 20:
                corr[i, j] = corr[j, i] = 0.0
                continue
            xi = ic_matrix[i, mask]
            xj = ic_matrix[j, mask]
            c = np.corrcoef(xi, xj)[0, 1]
            c = 0.0 if np.isnan(c) else c
            corr[i, j] = corr[j, i] = c

    return corr


def _corr_to_adjacency(corr, k=5):
    """Convert correlation matrix to sparse KNN adjacency matrix.

    Uses mutual-reachability: edge exists only if i is in j's KNN AND j is in i's KNN.
    This produces a cleaner graph for community detection than simple thresholding.

    Args:
      corr: (N, N) correlation matrix
      k: number of nearest neighbors

    Returns:
      adjacency: set of (i, j, weight) tuples
      n_edges: number of edges in the graph
    """
    n = corr.shape[0]
    distance = 1.0 - np.abs(corr)  # 0 = identical, 2 = opposite
    np.fill_diagonal(distance, np.inf)

    adjacency = set()
    for i in range(n):
        knn_i = set(np.argpartition(distance[i], k)[:k])
        for j in knn_i:
            knn_j = set(np.argpartition(distance[j], k)[:k])
            if i in knn_j:  # mutual reachability
                w = float(1.0 - distance[i, j])
                if i < j:
                    adjacency.add((i, j, w))
                else:
                    adjacency.add((j, i, w))

    return adjacency


def run_leiden(adjacency, n_vertices, resolution=1.0, seed=42):
    """Run Leiden community detection on KNN graph.

    Args:
      adjacency: set of (i, j, weight) tuples
      n_vertices: number of vertices
      resolution: modularity resolution parameter.
                  >1 = more, smaller clusters; <1 = fewer, larger clusters.
      seed: random seed for reproducibility

    Returns:
      labels: list[int] of length n_vertices, cluster assignment per factor
      modularity: float, final modularity score
    """
    import igraph as ig
    import leidenalg

    g = ig.Graph(n=n_vertices)
    edges, weights = [], []
    for i, j, w in adjacency:
        edges.extend([(i, j)])
        weights.append(w)
    g.add_edges(edges)
    g.es["weight"] = weights

    partition = leidenalg.find_partition(
        g,
        leidenalg.RBConfigurationVertexPartition,
        resolution_parameter=resolution,
        weights="weight",
        seed=seed,
    )
    labels = [partition.membership[i] for i in range(n_vertices)]
    return labels, partition.quality()


def run_louvain(adjacency, n_vertices, resolution=1.0, seed=42):
    """Run Louvain (for comparison with Leiden).

    Same interface as run_leiden, uses louvain package.
    """
    import igraph as ig

    g = ig.Graph(n=n_vertices)
    edges, weights = [], []
    for i, j, w in adjacency:
        edges.extend([(i, j)])
        weights.append(w)

    g.add_edges(edges)
    g.es["weight"] = weights

    partition = g.community_multilevel(
        weights="weight", return_levels=False
    )
    labels = [partition.membership[i] for i in range(n_vertices)]
    return labels, partition.quality()


def hierarchical_cluster(corr, max_clusters=50):
    """Fallback: hierarchical (Ward) clustering when igraph is unavailable.

    Returns cluster labels for max_clusters groups.
    """
    distance = 1.0 - np.abs(corr)
    condensed = squareform(distance, checks=False)
    Z = linkage(condensed, method="ward")
    labels = fcluster(Z, max_clusters, criterion="maxclust") - 1
    return labels.tolist()


def cluster_factors(ic_matrix, factor_names, resolutions=None,
                    k_neighbors=5, algorithm="leiden", seed=42):
    """Main clustering pipeline.

    Args:
      ic_matrix: (N_factors, N_dates) IC time series
      factor_names: list[str] of factor names
      resolutions: list[float] resolution parameters (default [0.5, 1.0, 2.0])
      k_neighbors: K for KNN graph construction
      algorithm: "leiden", "louvain", or "hierarchical"
      seed: random seed

    Returns:
      dict with keys: factors, params, stats
    """
    if resolutions is None:
        resolutions = [0.5, 1.0, 2.0]

    n_factors = len(factor_names)
    print(f"[cluster] Building correlation matrix for {n_factors} factors")
    corr = build_correlation_matrix(ic_matrix)

    adjacency = _corr_to_adjacency(corr, k=k_neighbors)
    n_edges = len(adjacency)
    print(f"[cluster] KNN graph: {n_factors} vertices, {n_edges} edges (k={k_neighbors})")

    output = {
        "factors": [{"name": name} for name in factor_names],
        "params": {
            "resolutions": resolutions,
            "k_neighbors": k_neighbors,
            "algorithm": algorithm,
            "n_factors": n_factors,
        },
        "stats": {
            "n_edges": n_edges,
            "edge_density": n_edges / (n_factors * (n_factors - 1) / 2),
        },
    }

    for res in resolutions:
        key = f"cluster_{res}"

        if algorithm == "leiden":
            labels, mod = run_leiden(adjacency, n_factors, resolution=res, seed=seed)
        elif algorithm == "louvain":
            labels, mod = run_louvain(adjacency, n_factors, resolution=res, seed=seed)
        elif algorithm == "hierarchical":
            labels = hierarchical_cluster(corr, max_clusters=max(10, int(n_factors * res)))
            mod = 0.0
        else:
            raise ValueError(f"Unknown algorithm: {algorithm}")

        n_clusters = len(set(labels))
        output["stats"][f"n_clusters_{res}"] = n_clusters
        output["stats"][f"modularity_{res}"] = mod

        for i, label in enumerate(labels):
            output["factors"][i][key] = int(label)

        print(f"[cluster] resolution={res}: {n_clusters} clusters, modularity={mod:.4f}")

    return output


def save_clusters(result, path):
    """Save clustering result to JSON."""
    with open(path, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"[cluster] Saved to {path}")


def load_clusters(path):
    """Load clustering result from JSON."""
    with open(path, "r") as f:
        return json.load(f)
