#!/usr/bin/env python3
# CLI entry point for Factor Research Pipeline
#
# Usage:
#   python -m factor_research.cli run                          # full pipeline
#   python -m factor_research.cli run --stage 1                # cluster only
#   python -m factor_research.cli run --stage 4 --pool-size 200
#   python -m factor_research.cli info                         # system check

import argparse
import os
import sys

# Ensure the parent directory is on sys.path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from factor_research import factor_loader
from factor_research import cluster
from factor_research import independence
from factor_research import similarity
from factor_research import genetic
from factor_research.pipeline import FactorResearchPipeline


def cmd_run(args):
    """Run the full pipeline or a specific stage."""
    output_dir = args.output or os.path.join(
        os.path.dirname(__file__), "..", "..", "data", "factor_research"
    )
    os.makedirs(output_dir, exist_ok=True)

    seed = args.seed
    np = __import__("numpy")

    # Stage 0: Load
    print("── Stage 0: Loading data ──")
    try:
        exposures, factor_names, dates = factor_loader.load_from_qlib(
            start_date=args.start, end_date=args.end, universe=args.universe
        )
        forward_returns = np.random.default_rng(seed).normal(
            0.0005, 0.02, (exposures.shape[0], exposures.shape[2])
        )
        ic_matrix = factor_loader.compute_ic_series(exposures, forward_returns)
    except Exception as e:
        print(f"  Qlib unavailable ({e}), using synthetic data")
        exposures, factor_names, dates = factor_loader._generate_synthetic(
            n_factors=args.n_factors, seed=seed
        )
        forward_returns = np.random.default_rng(seed).normal(
            0.0005, 0.02, (exposures.shape[0], exposures.shape[2])
        )
        ic_matrix = factor_loader.compute_ic_series(exposures, forward_returns)

    n_factors = len(factor_names)
    print(f"  {n_factors} factors, {ic_matrix.shape[1]} dates")

    if args.stage == 0:
        return

    # Stage 1: Cluster
    if args.stage <= 1:
        print("\n── Stage 1: Clustering ──")
        resolutions = [float(r) for r in args.resolutions.split(",")]
        cluster_result = cluster.cluster_factors(
            ic_matrix, factor_names,
            resolutions=resolutions, k_neighbors=args.k_neighbors,
            algorithm=args.algorithm, seed=seed,
        )
        cluster.save_clusters(
            cluster_result, os.path.join(output_dir, "factor_clusters.json")
        )
        if args.stage == 1:
            _print_stage1_summary(cluster_result)
            return

    # Stage 2: Independence
    if args.stage <= 2:
        print("\n── Stage 2: Independence selection ──")
        cluster_path = os.path.join(output_dir, "factor_clusters.json")
        cluster_result = cluster.load_clusters(cluster_path)

        sel_result = independence.run_independence_selection(
            cluster_result, ic_matrix, factor_names,
            resolution=args.resolution, epsilon=args.epsilon,
        )
        independence.save_selection(
            sel_result, os.path.join(output_dir, "independence_selection.json")
        )
        if args.stage == 2:
            _print_stage2_summary(sel_result)
            return

    # Stage 3: Similarity
    if args.stage <= 3:
        print("\n── Stage 3: Similarity filtering ──")
        sel_path = os.path.join(output_dir, "independence_selection.json")
        with open(sel_path) as f:
            sel_result = __import__("json").load(f)

        sim_result = similarity.run_similarity_filter(
            sel_result, ic_matrix, factor_names,
            n_top_pairs=args.top_pairs,
        )
        similarity.save_similarity_result(
            sim_result, os.path.join(output_dir, "similarity_filter.json")
        )
        if args.stage == 3:
            _print_stage3_summary(sim_result)
            return

    # Stage 4: Genetic
    if args.stage <= 4:
        print("\n── Stage 4: Genetic algorithm ──")
        sim_path = os.path.join(output_dir, "similarity_filter.json")
        with open(sim_path) as f:
            sim_result = __import__("json").load(f)

        genetic_result = genetic.run_genetic_algorithm(
            sim_result["candidate_pool"], ic_matrix, factor_names,
            pop_size=args.pop_size, n_gen=args.n_gen,
            mut_rate=args.mut_rate, seed=seed,
        )
        genetic.save_genetic_result(
            genetic_result, os.path.join(output_dir, "genetic_result.json")
        )
        _print_stage4_summary(genetic_result)


def _print_stage1_summary(result):
    stats = result["stats"]
    print(f"\nClusters: {stats}")

def _print_stage2_summary(result):
    print(f"\nRepresentatives: {result['stats']['n_total']} "
          f"from {result['stats']['n_clusters']} clusters")

def _print_stage3_summary(result):
    s = result["stats"]
    print(f"\nCandidates: {s['n_candidates_output']} "
          f"(dropped {s['n_dropped']})")

def _print_stage4_summary(result):
    print(f"\nPareto front: {len(result['pareto_front'])} solutions")
    for i, sol in enumerate(result["pareto_front"][:5]):
        print(f"  #{i+1}: {sol['active_factors']}")


def cmd_info(args):
    """Print system info: available libraries, data paths."""
    print("Factor Research Pipeline — System Info")
    print("=" * 50)

    # Qlib
    try:
        import qlib
        print(f"qlib:       {qlib.__version__}")
    except ImportError:
        print("qlib:       NOT INSTALLED")

    # igraph + leidenalg
    try:
        import igraph
        print(f"igraph:     {igraph.__version__}")
    except ImportError:
        print("igraph:     NOT INSTALLED")

    try:
        import leidenalg
        print(f"leidenalg:  {leidenalg.__version__}")
    except ImportError:
        print("leidenalg:  NOT INSTALLED")

    # DEAP
    try:
        import deap
        print(f"deap:       {deap.__version__}")
    except ImportError:
        print("deap:       NOT INSTALLED")

    # Data
    qlib_data = os.path.expanduser("~/.qlib/qlib_data/cn_data")
    print(f"\nQlib data:  {'EXISTS' if os.path.isdir(qlib_data) else 'NOT FOUND'}")
    print(f"  path:     {qlib_data}")


def main():
    parser = argparse.ArgumentParser(
        description="Factor Research Pipeline — multi-stage factor selection"
    )
    sub = parser.add_subparsers(dest="command")

    # run
    run_p = sub.add_parser("run", help="Run pipeline stages")
    run_p.add_argument("--stage", type=int, default=4,
                       help="Run up to this stage (1-4, default: 4 = full)")
    run_p.add_argument("--universe", default="csi300")
    run_p.add_argument("--start", default="2020-01-01")
    run_p.add_argument("--end", default="2024-12-31")
    run_p.add_argument("--n-factors", type=int, default=50,
                       help="Number of synthetic factors (fallback)")
    run_p.add_argument("--resolutions", default="0.5,1.0,2.0")
    run_p.add_argument("--k-neighbors", type=int, default=5)
    run_p.add_argument("--algorithm", default="leiden",
                       choices=["leiden", "louvain", "hierarchical"])
    run_p.add_argument("--resolution", type=float, default=1.0,
                       help="Resolution for independence selection")
    run_p.add_argument("--epsilon", type=float, default=0.1)
    run_p.add_argument("--top-pairs", type=int, default=20)
    run_p.add_argument("--pop-size", type=int, default=100)
    run_p.add_argument("--n-gen", type=int, default=50)
    run_p.add_argument("--mut-rate", type=float, default=0.1)
    run_p.add_argument("--seed", type=int, default=42)
    run_p.add_argument("--output")

    # info
    sub.add_parser("info", help="Print system information")

    args = parser.parse_args()

    if args.command == "run":
        cmd_run(args)
    elif args.command == "info":
        cmd_info(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
