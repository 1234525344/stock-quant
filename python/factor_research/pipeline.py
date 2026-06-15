# Factor Research Pipeline — end-to-end orchestration
#
# Usage:
#   from factor_research.pipeline import FactorResearchPipeline
#   pipeline = FactorResearchPipeline()
#   result = pipeline.run_full()
#
# Or via CLI:
#   python -m factor_research.cli run --universe csi300

import json
import os
import time
from pathlib import Path

import numpy as np

from . import factor_loader
from . import cluster
from . import independence
from . import similarity
from . import genetic


class FactorResearchPipeline:
    """Orchestrates the 4-stage factor selection pipeline."""

    def __init__(self, output_dir=None, seed=42):
        self.output_dir = output_dir or os.path.join(
            os.path.dirname(__file__), "..", "..", "data", "factor_research"
        )
        self.seed = seed
        self.results = {}
        os.makedirs(self.output_dir, exist_ok=True)

    def run_full(self, start_date="2020-01-01", end_date="2024-12-31",
                 universe="csi300", resolutions=None, k_neighbors=5,
                 algorithm="leiden", epsilon=0.1, n_top_pairs=20,
                 pop_size=100, n_gen=50, mut_rate=0.1):
        """Run all 4 stages end-to-end.

        Returns:
          dict with keys: stage_0..stage_4, each containing results and output paths
        """
        if resolutions is None:
            resolutions = [0.5, 1.0, 2.0]

        print("=" * 60)
        print("Factor Research Pipeline")
        print("=" * 60)

        # ── Stage 0: Load data ──────────────────────────────────
        print("\n── Stage 0: Loading factor data ──")
        t0 = time.time()

        try:
            exposures, factor_names, dates = factor_loader.load_from_qlib(
                start_date=start_date, end_date=end_date, universe=universe
            )
            # Generate synthetic forward returns for IC computation
            forward_returns = np.random.default_rng(self.seed).normal(
                0.0005, 0.02, (exposures.shape[0], exposures.shape[2])
            )
        except Exception as e:
            print(f"  Qlib unavailable ({e}), using synthetic data")
            n_factors = 50
            exposures, factor_names, dates = factor_loader._generate_synthetic(
                n_factors=n_factors, seed=self.seed
            )
            forward_returns = np.random.default_rng(self.seed).normal(
                0.0005, 0.02, (exposures.shape[0], exposures.shape[2])
            )

        ic_matrix = factor_loader.compute_ic_series(exposures, forward_returns)
        n_factors = len(factor_names)
        print(f"  Loaded {n_factors} factors, {ic_matrix.shape[1]} dates")
        print(f"  Time: {time.time() - t0:.1f}s")

        self.results["stage_0"] = {
            "n_factors": n_factors,
            "n_dates": ic_matrix.shape[1],
            "factor_names": factor_names,
        }

        # ── Stage 1: Clustering ─────────────────────────────────
        print("\n── Stage 1: Factor clustering ──")
        t1 = time.time()

        cluster_result = cluster.cluster_factors(
            ic_matrix, factor_names,
            resolutions=resolutions, k_neighbors=k_neighbors,
            algorithm=algorithm, seed=self.seed,
        )
        cluster_path = os.path.join(self.output_dir, "factor_clusters.json")
        cluster.save_clusters(cluster_result, cluster_path)
        print(f"  Time: {time.time() - t1:.1f}s")

        self.results["stage_1"] = {
            "path": cluster_path,
            "n_clusters": {
                f"res_{r}": cluster_result["stats"][f"n_clusters_{r}"]
                for r in resolutions
            },
        }

        # ── Stage 2: Independence selection ─────────────────────
        print("\n── Stage 2: Independence selection ──")
        t2 = time.time()

        # Use resolution=1.0 as the primary clustering
        sel_result = independence.run_independence_selection(
            cluster_result, ic_matrix, factor_names,
            resolution=1.0, epsilon=epsilon,
        )
        sel_path = os.path.join(self.output_dir, "independence_selection.json")
        independence.save_selection(sel_result, sel_path)
        print(f"  Time: {time.time() - t2:.1f}s")

        self.results["stage_2"] = {
            "path": sel_path,
            "n_representatives": sel_result["stats"]["n_total"],
            "n_clusters": sel_result["stats"]["n_clusters"],
        }

        # ── Stage 3: Similarity filtering ───────────────────────
        print("\n── Stage 3: Similarity filtering ──")
        t3 = time.time()

        sim_result = similarity.run_similarity_filter(
            sel_result, ic_matrix, factor_names,
            n_top_pairs=n_top_pairs,
        )
        sim_path = os.path.join(self.output_dir, "similarity_filter.json")
        similarity.save_similarity_result(sim_result, sim_path)
        print(f"  Time: {time.time() - t3:.1f}s")

        self.results["stage_3"] = {
            "path": sim_path,
            "n_candidates": sim_result["stats"]["n_candidates_output"],
            "n_dropped": sim_result["stats"]["n_dropped"],
        }

        # ── Stage 4: Genetic algorithm ──────────────────────────
        print("\n── Stage 4: Genetic algorithm ──")
        t4 = time.time()

        genetic_result = genetic.run_genetic_algorithm(
            sim_result["candidate_pool"], ic_matrix, factor_names,
            pop_size=pop_size, n_gen=n_gen, mut_rate=mut_rate,
            seed=self.seed,
        )
        genetic_path = os.path.join(self.output_dir, "genetic_result.json")
        genetic.save_genetic_result(genetic_result, genetic_path)
        print(f"  Time: {time.time() - t4:.1f}s")

        self.results["stage_4"] = {
            "path": genetic_path,
            "pareto_size": genetic_result["stats"]["pareto_size"],
        }

        # ── Summary ─────────────────────────────────────────────
        print("\n" + "=" * 60)
        print("Pipeline Complete")
        print(f"  Stage 1: {self.results['stage_1']['n_clusters']}")
        print(f"  Stage 2: {self.results['stage_2']['n_representatives']} reps")
        print(f"  Stage 3: {self.results['stage_3']['n_candidates']} candidates "
              f"(dropped {self.results['stage_3']['n_dropped']})")
        print(f"  Stage 4: {self.results['stage_4']['pareto_size']} Pareto solutions")
        print(f"  Output: {self.output_dir}")
        print("=" * 60)

        return self.results

    def summarize(self):
        """Print a human-readable summary of results."""
        if not self.results:
            print("No results yet. Run run_full() first.")
            return

        genetic_path = self.results.get("stage_4", {}).get("path")
        if genetic_path and os.path.exists(genetic_path):
            with open(genetic_path) as f:
                gr = json.load(f)

            print("\nTop 5 factor combinations (by composite IC):")
            print("-" * 50)
            for i, sol in enumerate(gr["pareto_front"][:5]):
                factors = ", ".join(sol["active_factors"])
                fit = sol["fitness"]
                print(f"  #{i+1} [{sol['n_active']} factors] {factors}")
                print(f"       IC={fit['composite_IC']:.3f}  "
                      f"anti_redund={fit['anti_redundancy']:.3f}  "
                      f"diversity={fit['diversity']:.3f}  "
                      f"stability={fit['stability']:.3f}")
