#!/usr/bin/env python3
# Factor Research Bridge — Python side of the Node.js ↔ Python pipeline
#
# Usage:
#   # From Node.js (reads JSON file, runs pipeline, writes results)
#   python bridge.py --input data/factor_research/factor_ic.json
#
#   # JSON-lines mode (Node passes JSON over stdin, results to stdout)
#   python bridge.py --stdin
#
# The bridge is designed to be called as a subprocess from Node.js.
# All diagnostic output goes to stderr; only JSON results go to stdout.

import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from factor_research import factor_loader
from factor_research import cluster
from factor_research import independence
from factor_research import similarity
from factor_research import genetic


def run_pipeline(ic_json_path, output_dir=None, **kwargs):
    """Run full 4-stage pipeline on real factor IC data exported from Node.js.

    Args:
      ic_json_path: path to factor_ic.json exported by scripts/export-factor-ic.js
      output_dir: where to save results (default: same dir as input file)
      **kwargs: pipeline overrides (pop_size, n_gen, etc.)

    Returns:
      dict: summary suitable for returning to Node.js
    """
    if output_dir is None:
        output_dir = os.path.dirname(ic_json_path) or "."
    os.makedirs(output_dir, exist_ok=True)

    seed = kwargs.get("seed", 42)
    rng = np.random.default_rng(seed)

    print(f"[bridge] Loading IC data from {ic_json_path}", file=sys.stderr)
    ic_matrix, factor_names, factor_meta, dates = factor_loader.load_ic_from_json(
        ic_json_path
    )

    n_factors = ic_matrix.shape[0]
    n_dates = ic_matrix.shape[1]
    print(f"[bridge] {n_factors} factors × {n_dates} dates", file=sys.stderr)

    # Stage 1: Cluster
    print("[bridge] Stage 1: Clustering...", file=sys.stderr)
    resolutions = kwargs.get("resolutions", [0.5, 1.0, 2.0])
    cluster_result = cluster.cluster_factors(
        ic_matrix, factor_names,
        resolutions=resolutions,
        k_neighbors=kwargs.get("k_neighbors", 5),
        algorithm=kwargs.get("algorithm", "leiden"),
        seed=seed,
    )
    cluster_path = os.path.join(output_dir, "factor_clusters.json")
    cluster.save_clusters(cluster_result, cluster_path)

    # Stage 2: Independence
    print("[bridge] Stage 2: Independence selection...", file=sys.stderr)
    sel_result = independence.run_independence_selection(
        cluster_result, ic_matrix, factor_names,
        resolution=kwargs.get("resolution", 1.0),
        epsilon=kwargs.get("epsilon", 0.1),
    )
    sel_path = os.path.join(output_dir, "independence_selection.json")
    independence.save_selection(sel_result, sel_path)

    # Stage 3: Similarity
    print("[bridge] Stage 3: Similarity filtering...", file=sys.stderr)
    sim_result = similarity.run_similarity_filter(
        sel_result, ic_matrix, factor_names,
        n_top_pairs=kwargs.get("top_pairs", 20),
    )
    sim_path = os.path.join(output_dir, "similarity_filter.json")
    similarity.save_similarity_result(sim_result, sim_path)

    # Stage 4: Genetic
    print("[bridge] Stage 4: Genetic algorithm...", file=sys.stderr)
    genetic_result = genetic.run_genetic_algorithm(
        sim_result["candidate_pool"], ic_matrix, factor_names,
        pop_size=kwargs.get("pop_size", 100),
        n_gen=kwargs.get("n_gen", 50),
        mut_rate=kwargs.get("mut_rate", 0.1),
        seed=seed,
    )
    genetic_path = os.path.join(output_dir, "genetic_result.json")
    genetic.save_genetic_result(genetic_result, genetic_path)

    # Build summary
    n_candidates = len(sim_result["candidate_pool"])
    n_dropped = sim_result["stats"]["n_dropped"]
    n_pareto = len(genetic_result["pareto_front"])

    top_combos = []
    for sol in genetic_result["pareto_front"][:5]:
        top_combos.append({
            "factors": sol["active_factors"],
            "n_active": sol["n_active"],
            "fitness": sol["fitness"],
        })

    summary = {
        "stages": {
            "cluster": {
                "n_clusters": {
                    f"res_{r}": cluster_result["stats"][f"n_clusters_{r}"]
                    for r in resolutions
                },
            },
            "independence": {
                "n_representatives": sel_result["stats"]["n_total"],
            },
            "similarity": {
                "n_candidates": n_candidates,
                "n_dropped": n_dropped,
            },
            "genetic": {
                "n_pareto_solutions": n_pareto,
            },
        },
        "top_combinations": top_combos,
        "factor_performance": factor_meta,
        "output_dir": output_dir,
    }

    return summary


def main():
    parser = argparse.ArgumentParser(description="Factor Research Bridge")
    parser.add_argument("--input", "-i", help="Path to factor_ic.json")
    parser.add_argument("--stdin", action="store_true",
                        help="Read JSON config from stdin")
    parser.add_argument("--output-dir", "-o", help="Output directory")
    parser.add_argument("--pop-size", type=int, default=100)
    parser.add_argument("--n-gen", type=int, default=50)
    parser.add_argument("--mut-rate", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if args.stdin:
        config = json.load(sys.stdin)
        input_path = config.get("input")
        output_dir = config.get("output_dir")
    else:
        input_path = args.input
        output_dir = args.output_dir

    if not input_path:
        print(json.dumps({"error": "No input file specified"}))
        sys.exit(1)

    kwargs = {
        "pop_size": args.pop_size,
        "n_gen": args.n_gen,
        "mut_rate": args.mut_rate,
        "seed": args.seed,
    }

    summary = run_pipeline(input_path, output_dir=output_dir, **kwargs)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
