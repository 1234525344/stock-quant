# Stage 2: Independence-based factor selection within clusters
#
# For each cluster, compute independence score for every factor, then
# select the top-1 most independent factor as the cluster representative.
#
# Independence Score = (1 - mean_abs_correlation_within_cluster)
#                     + epsilon * |mean_IC|
#
# The first term rewards factors that are uncorrelated with cluster-mates.
# The second term prevents selecting an independent-but-useless factor
# (e.g. pure noise that happens to be uncorrelated).

import json
import numpy as np


def compute_independence_scores(corr_matrix, labels, ic_means, epsilon=0.1):
    """Compute independence score for each factor.

    Args:
      corr_matrix: (N, N) factor correlation matrix (from IC series)
      labels: list[int] of length N, cluster assignment per factor
      ic_means: (N,) array of mean IC per factor
      epsilon: weight on predictive power term (default 0.1).
               Higher → favors factors with track record over pure independence.

    Returns:
      scores: (N,) array of independence scores (higher = better)
      details: list[dict] with per-factor breakdown
    """
    n = len(labels)
    unique_labels = sorted(set(labels))
    scores = np.zeros(n)
    details = []

    for i in range(n):
        cluster = labels[i]
        cluster_mates = [j for j in range(n) if labels[j] == cluster and j != i]

        if not cluster_mates:
            mean_abs_corr = 0.0
        else:
            abs_corrs = [abs(corr_matrix[i, j]) for j in cluster_mates]
            mean_abs_corr = np.mean(abs_corrs)

        ic_component = abs(ic_means[i]) if not np.isnan(ic_means[i]) else 0.0
        score = (1.0 - mean_abs_corr) + epsilon * ic_component
        scores[i] = score

        details.append({
            "factor_index": i,
            "cluster": cluster,
            "mean_abs_corr_within": round(mean_abs_corr, 4),
            "mean_IC": round(float(ic_means[i]), 4) if not np.isnan(ic_means[i]) else None,
            "independence_score": round(score, 4),
        })

    return scores, details


def select_representatives(factor_names, scores, labels, ic_means,
                           redundancy_groups=None, resolution=1.0):
    """Select one representative factor per cluster.

    Within each cluster, pick the factor with the highest independence score.
    If redundancy_groups is provided (dict: group_id → [factor_indices]),
    replace the representative with the highest-IC factor in the same group
    (this prevents discarding a strong factor just because a weak variant
    scored slightly higher on independence).

    Args:
      factor_names: list[str]
      scores: (N,) independence scores
      labels: list[int] cluster labels
      ic_means: (N,) mean IC values
      redundancy_groups: optional dict or None
      resolution: the resolution parameter used (for output metadata)

    Returns:
      dict with keys: representatives, stats
    """
    unique_clusters = sorted(set(labels))
    representatives = []
    selected_indices = set()

    for cluster in unique_clusters:
        cluster_indices = [i for i, lbl in enumerate(labels) if lbl == cluster]

        # Find candidate: highest independence score in cluster
        best_idx = max(cluster_indices, key=lambda i: scores[i])

        # Apply redundancy group replacement if configured
        if redundancy_groups:
            for group_id, group_indices in redundancy_groups.items():
                if best_idx in group_indices:
                    # Replace with highest-IC factor in the same group
                    best_in_group = max(group_indices, key=lambda i: (
                        ic_means[i] if not np.isnan(ic_means[i]) else -999
                    ))
                    best_idx = best_in_group
                    break

        selected_indices.add(best_idx)
        representatives.append({
            "factor": factor_names[best_idx],
            "factor_index": best_idx,
            "cluster": cluster,
            "resolution": resolution,
            "independence_score": round(float(scores[best_idx]), 4),
            "mean_IC": round(float(ic_means[best_idx]), 4)
            if not np.isnan(ic_means[best_idx]) else None,
        })

    representatives.sort(key=lambda r: r["independence_score"], reverse=True)

    stats = {
        "n_total": len(representatives),
        "n_clusters": len(unique_clusters),
        "n_singleton_clusters": sum(
            1 for c in unique_clusters
            if sum(1 for lbl in labels if lbl == c) == 1
        ),
    }

    return {"representatives": representatives, "stats": stats}


def run_independence_selection(cluster_result, ic_matrix, factor_names,
                               redundancy_groups=None, resolution=1.0,
                               epsilon=0.1):
    """Full Stage 2 pipeline.

    Args:
      cluster_result: output from cluster.py (dict with "factors" key)
      ic_matrix: (N, N_dates) IC time series
      factor_names: list[str]
      redundancy_groups: optional dict {group_id: [idx, ...]}
      resolution: which clustering resolution to use
      epsilon: IC weight in independence score

    Returns:
      selection dict with representatives and stats
    """
    n = len(factor_names)
    cluster_key = f"cluster_{resolution}"

    # Extract labels from cluster result
    labels = [f[cluster_key] for f in cluster_result["factors"]]

    # Build correlation matrix from IC series
    corr = np.eye(n)
    valid_mask = ~np.isnan(ic_matrix)
    for i in range(n):
        for j in range(i + 1, n):
            mask = valid_mask[i] & valid_mask[j]
            if mask.sum() < 20:
                continue
            c = np.corrcoef(ic_matrix[i, mask], ic_matrix[j, mask])[0, 1]
            corr[i, j] = corr[j, i] = 0.0 if np.isnan(c) else c

    # Mean IC per factor
    ic_means = np.nanmean(ic_matrix, axis=1)

    # Compute independence scores
    scores, details = compute_independence_scores(corr, labels, ic_means, epsilon)

    # Select representatives
    result = select_representatives(
        factor_names, scores, labels, ic_means,
        redundancy_groups=redundancy_groups, resolution=resolution,
    )
    result["details"] = details
    result["params"] = {"resolution": resolution, "epsilon": epsilon}

    n_reps = len(result["representatives"])
    print(f"[independence] Selected {n_reps} representatives "
          f"from {len(set(labels))} clusters (resolution={resolution})")

    return result


def save_selection(result, path):
    with open(path, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"[independence] Saved to {path}")
