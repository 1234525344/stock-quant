# Stage 3: Pairwise similarity filtering
#
# After Stage 2 selects ~50 cluster representatives, this stage:
# 1. Computes pairwise Pearson correlation on IC time series (C(50,2) pairs)
# 2. Finds the top-20 most correlated pairs (suspected redundancies)
# 3. Computes 3 judgment metrics per pair:
#    - prod:  IC_A * IC_B        (both strong → high score)
#    - diff:  |IC_A - IC_B|       (large gap → weaker factor is risky)
#    - Cmean: conditional mean — when both > 0, take min; else take max
# 4. Labels each pair: keep_both / drop_weaker / manual_review
# 5. Outputs ~60 high-frequency factors, total candidate pool ~110

import json
import numpy as np
from itertools import combinations


def compute_pair_metrics(ic_a, ic_b):
    """Compute prod, diff, Cmean for a factor pair.

    Args:
      ic_a: float — mean IC of factor A
      ic_b: float — mean IC of factor B

    Returns:
      dict with prod, diff, cmean
    """
    prod = ic_a * ic_b
    diff = abs(ic_a - ic_b)

    if ic_a > 0 and ic_b > 0:
        cmean = min(ic_a, ic_b)
    else:
        cmean = min(ic_a, ic_b)

    return {"prod": round(prod, 6), "diff": round(diff, 6), "cmean": round(cmean, 6)}


def classify_pair(prod, diff, cmean, corr,
                  prod_threshold=0.0005, diff_threshold=0.02,
                  corr_threshold=0.80):
    """Classify a factor pair into keep_both / drop_weaker / manual_review.

    Decision logic:
    - keep_both:     both factors are strong AND different enough → useful together
    - drop_weaker:   one clearly dominates OR they're nearly identical
    - manual_review: borderline cases

    Args:
      prod: IC_A * IC_B
      diff: |IC_A - IC_B|
      cmean: conditional mean
      corr: Pearson correlation between the two factors' IC series
      prod_threshold: minimum product to consider "both useful"
      diff_threshold: maximum difference to consider "interchangeable"
      corr_threshold: correlation above which factors are considered near-duplicates

    Returns:
      str: one of "keep_both", "drop_weaker", "manual_review"
    """
    if prod > prod_threshold and diff > diff_threshold:
        return "keep_both"
    elif corr > corr_threshold and diff < diff_threshold:
        return "drop_weaker"
    else:
        return "manual_review"


def run_similarity_filter(selection_result, ic_matrix, factor_names,
                          n_top_pairs=20, prod_threshold=0.0005,
                          diff_threshold=0.02, corr_threshold=0.80):
    """Full Stage 3 pipeline.

    Args:
      selection_result: output from independence.py (dict with "representatives")
      ic_matrix: (N_total, N_dates) IC time series for ALL factors
      factor_names: list[str] of ALL factor names
      n_top_pairs: number of most-correlated pairs to examine
      prod_threshold, diff_threshold, corr_threshold: classifier thresholds

    Returns:
      dict with keys: pairs, decisions, candidate_pool, stats
    """
    reps = selection_result["representatives"]
    rep_indices = [r["factor_index"] for r in reps]
    n_reps = len(rep_indices)
    n_pairs = n_reps * (n_reps - 1) // 2

    print(f"[similarity] Computing {n_pairs} pairwise correlations for {n_reps} reps")

    # Compute pairwise correlations on IC series
    valid_mask = ~np.isnan(ic_matrix)
    pairs_data = []

    for a_idx, b_idx in combinations(range(n_reps), 2):
        i = rep_indices[a_idx]
        j = rep_indices[b_idx]

        mask = valid_mask[i] & valid_mask[j]
        if mask.sum() < 20:
            pairs_data.append({
                "factor_a": reps[a_idx]["factor"],
                "factor_b": reps[b_idx]["factor"],
                "idx_a": i, "idx_b": j,
                "correlation": 0.0,
                "abs_corr": 0.0,
                "ic_a": reps[a_idx]["mean_IC"] or 0.0,
                "ic_b": reps[b_idx]["mean_IC"] or 0.0,
                "metrics": None,
                "decision": "manual_review",
                "note": "insufficient_data",
            })
            continue

        c = np.corrcoef(ic_matrix[i, mask], ic_matrix[j, mask])[0, 1]
        c = 0.0 if np.isnan(c) else float(c)

        ic_a = reps[a_idx]["mean_IC"] or 0.0
        ic_b = reps[b_idx]["mean_IC"] or 0.0
        metrics = compute_pair_metrics(ic_a, ic_b)
        decision = classify_pair(
            metrics["prod"], metrics["diff"], metrics["cmean"], c,
            prod_threshold, diff_threshold, corr_threshold,
        )

        pairs_data.append({
            "factor_a": reps[a_idx]["factor"],
            "factor_b": reps[b_idx]["factor"],
            "idx_a": i, "idx_b": j,
            "correlation": round(c, 4),
            "abs_corr": round(abs(c), 4),
            "ic_a": round(ic_a, 4),
            "ic_b": round(ic_b, 4),
            "metrics": metrics,
            "decision": decision,
            "note": "",
        })

    # Sort by absolute correlation, take top N
    pairs_data.sort(key=lambda p: p["abs_corr"], reverse=True)
    top_pairs = pairs_data[:n_top_pairs]

    # Build candidate pool: start with all reps, then add/remove based on decisions
    drop_set = set()
    for p in top_pairs:
        if p["decision"] == "drop_weaker":
            # Drop the one with lower |IC|
            if abs(p["ic_a"]) >= abs(p["ic_b"]):
                drop_set.add(p["idx_b"])
            else:
                drop_set.add(p["idx_a"])

    candidate_pool = [r for r in reps if r["factor_index"] not in drop_set]

    # Count decisions
    decisions_count = {"keep_both": 0, "drop_weaker": 0, "manual_review": 0}
    for p in top_pairs:
        decisions_count[p["decision"]] += 1

    stats = {
        "n_reps_input": n_reps,
        "n_pairs_total": n_pairs,
        "n_top_pairs_examined": len(top_pairs),
        "n_candidates_output": len(candidate_pool),
        "decisions": decisions_count,
        "n_dropped": len(drop_set),
        "thresholds": {
            "prod_threshold": prod_threshold,
            "diff_threshold": diff_threshold,
            "corr_threshold": corr_threshold,
        },
    }

    print(f"[similarity] Top {n_top_pairs} pairs: "
          f"keep_both={decisions_count['keep_both']}, "
          f"drop_weaker={decisions_count['drop_weaker']}, "
          f"manual_review={decisions_count['manual_review']}")
    print(f"[similarity] Candidate pool: {len(candidate_pool)} factors "
          f"(from {n_reps} → dropped {len(drop_set)})")

    return {
        "top_pairs": top_pairs,
        "all_pairs": pairs_data,
        "candidate_pool": candidate_pool,
        "stats": stats,
    }


def save_similarity_result(result, path):
    with open(path, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"[similarity] Saved to {path}")
