# Stage 4: Genetic algorithm for optimal factor subset selection
#
# Chromosome encoding: 6 gene positions, each gene ∈ [-1, M-1]
#   -1 means "unused" → actual subset size is 2-6 factors
#
# Multi-objective fitness (4-dimensional):
#   1. composite_IC   — weighted IC of the selected factor subset
#   2. anti_redundancy — 1 - mean(|pairwise correlation|)
#   3. diversity       — log(1 + n_active) / log(1 + max_genes)
#   4. stability       — fraction of days where all factors agree on direction
#
# Uses DEAP for NSGA-II (non-dominated sorting genetic algorithm).
# The output Pareto front represents the optimal trade-off between
# predictive power and factor independence.

import json
import random
import numpy as np
from itertools import combinations


def _validate_deap():
    try:
        from deap import base, creator, tools, algorithms
        return True
    except ImportError:
        return False


def make_fitness_evaluator(ic_matrix, corr_matrix=None):
    """Build a fitness function closure for the GA.

    Args:
      ic_matrix: (M, N_dates) IC time series for M candidate factors
      corr_matrix: (M, M) pre-computed correlation matrix (optional)

    Returns:
      evaluate(individual) → (composite_ic, anti_redundancy, diversity, stability)
    """
    M = ic_matrix.shape[0]

    # Pre-compute mean IC per factor
    ic_means = np.nanmean(ic_matrix, axis=1)
    ic_means = np.nan_to_num(ic_means, nan=0.0)

    # Pre-compute correlation matrix if not provided
    if corr_matrix is None:
        corr = np.eye(M)
        valid_mask = ~np.isnan(ic_matrix)
        for i in range(M):
            for j in range(i + 1, M):
                mask = valid_mask[i] & valid_mask[j]
                if mask.sum() < 20:
                    continue
                c = np.corrcoef(ic_matrix[i, mask], ic_matrix[j, mask])[0, 1]
                corr[i, j] = corr[j, i] = 0.0 if np.isnan(c) else c
    else:
        corr = corr_matrix

    # Pre-compute sign agreement matrix for stability
    valid_mask = ~np.isnan(ic_matrix)
    n_dates = ic_matrix.shape[1]

    def evaluate(individual):
        # Decode chromosome: filter out -1 (unused) genes
        active = [g for g in individual if g >= 0 and g < M]
        active = list(set(active))  # deduplicate

        if len(active) < 2:
            return (-999.0, 0.0, 0.0, 0.0)

        n_active = len(active)

        # 1. Composite IC: sum of |IC| weighted by independence
        ic_values = [abs(ic_means[i]) for i in active]
        composite_ic = float(np.sum(ic_values))

        # 2. Anti-redundancy: 1 - mean pairwise |correlation|
        if n_active > 1:
            pair_corrs = [abs(corr[i, j]) for i, j in combinations(active, 2)]
            mean_corr = np.mean(pair_corrs)
        else:
            mean_corr = 0.0
        anti_redundancy = float(1.0 - mean_corr)

        # 3. Diversity: log-scale bonus for more factors (diminishing returns)
        diversity = float(np.log(1 + n_active) / np.log(7))  # max 6 active → log(7)/log(7)=1

        # 4. Stability: fraction of dates where sign consensus > threshold
        agreement_days = 0
        total_days = 0
        for t in range(n_dates):
            signs = []
            all_valid = True
            for i in active:
                if valid_mask[i, t]:
                    signs.append(np.sign(ic_matrix[i, t]))
                else:
                    all_valid = False
                    break
            if all_valid and len(signs) >= 2:
                total_days += 1
                pos = sum(1 for s in signs if s > 0)
                neg = len(signs) - pos
                if max(pos, neg) >= len(signs) * 0.6:  # 60% consensus
                    agreement_days += 1
        stability = float(agreement_days / total_days) if total_days > 0 else 0.0

        return (composite_ic, anti_redundancy, diversity, stability)

    return evaluate


def run_genetic_algorithm(candidate_pool, ic_matrix, factor_names,
                          pop_size=100, n_gen=50, mut_rate=0.1,
                          crossover_rate=0.7, seed=42):
    """Run NSGA-II to find optimal factor subsets.

    Args:
      candidate_pool: list[dict] from Stage 3 with factor indices and ICs
      ic_matrix: (M_total, N_dates) IC time series
      factor_names: list[str]
      pop_size: population size
      n_gen: number of generations
      mut_rate: mutation probability
      crossover_rate: crossover probability
      seed: random seed

    Returns:
      dict with keys: pareto_front, all_generations, stats
    """
    if not _validate_deap():
        print("[genetic] DEAP not installed, using fallback random search")
        return _fallback_random_search(
            candidate_pool, ic_matrix, factor_names, n_iter=pop_size * n_gen, seed=seed
        )

    from deap import base, creator, tools, algorithms

    pool_indices = [f["factor_index"] for f in candidate_pool]
    M = len(pool_indices)
    max_genes = 6

    print(f"[genetic] Pool size: {M}, pop={pop_size}, gen={n_gen}")

    # Build IC sub-matrix for candidate pool factors
    ic_sub = np.array([ic_matrix[i] for i in pool_indices])

    # Map candidate pool index → original factor index
    pool_to_global = {k: v for k, v in enumerate(pool_indices)}

    evaluate = make_fitness_evaluator(ic_sub)

    # DEAP setup
    creator.create("FitnessMulti", base.Fitness, weights=(1.0, 1.0, 1.0, 1.0))
    creator.create("Individual", list, fitness=creator.FitnessMulti)

    toolbox = base.Toolbox()

    def init_gene():
        """Initialize a single gene: -1 (inactive) or a candidate index."""
        if random.random() < 0.2:
            return -1
        return random.randint(0, M - 1)

    def init_individual():
        ind = [init_gene() for _ in range(max_genes)]
        # Ensure at least 2 active genes
        active = [g for g in ind if g >= 0]
        if len(active) < 2:
            ind[0] = random.randint(0, M - 1)
            ind[1] = random.randint(0, M - 1)
        return creator.Individual(ind)

    toolbox.register("individual", init_individual)
    toolbox.register("population", tools.initRepeat, list, toolbox.individual)
    toolbox.register("evaluate", evaluate)
    toolbox.register("mate", tools.cxTwoPoint)
    toolbox.register("mutate", _mutate_chromosome, M=M, mut_rate=mut_rate)
    toolbox.register("select", tools.selNSGA2)

    random.seed(seed)
    np.random.seed(seed)

    pop = toolbox.population(n=pop_size)

    # Evaluate initial population
    invalid_ind = [ind for ind in pop if not ind.fitness.valid]
    fitnesses = [toolbox.evaluate(ind) for ind in invalid_ind]
    for ind, fit in zip(invalid_ind, fitnesses):
        ind.fitness.values = fit

    hof = tools.ParetoFront()
    stats = tools.Statistics(lambda ind: ind.fitness.values)
    stats.register("avg", np.mean, axis=0)
    stats.register("std", np.std, axis=0)
    stats.register("min", np.min, axis=0)
    stats.register("max", np.max, axis=0)

    logbook = tools.Logbook()
    logbook.header = "gen", "evals", "avg", "std", "min", "max"

    # Main loop
    for gen in range(n_gen):
        offspring = toolbox.select(pop, len(pop))
        offspring = [toolbox.clone(ind) for ind in offspring]

        for child1, child2 in zip(offspring[::2], offspring[1::2]):
            if random.random() < crossover_rate:
                toolbox.mate(child1, child2)
                del child1.fitness.values
                del child2.fitness.values

        for mutant in offspring:
            if random.random() < mut_rate:
                toolbox.mutate(mutant)
                del mutant.fitness.values

        invalid_ind = [ind for ind in offspring if not ind.fitness.valid]
        fitnesses = [toolbox.evaluate(ind) for ind in invalid_ind]
        for ind, fit in zip(invalid_ind, fitnesses):
            ind.fitness.values = fit

        pop[:] = offspring
        hof.update(pop)

        record = stats.compile(pop)
        logbook.record(gen=gen, evals=len(invalid_ind), **record)

        if gen % 10 == 0 or gen == n_gen - 1:
            print(f"[genetic] gen {gen:3d}: "
                  f"avg_fitness=({record['avg'][0]:.3f}, {record['avg'][1]:.3f}, "
                  f"{record['avg'][2]:.3f}, {record['avg'][3]:.3f}) "
                  f"pareto_size={len(hof)}")

    # Decode Pareto front
    pareto_front = []
    for ind in hof:
        active = [g for g in ind if g >= 0 and g < M]
        active = list(set(active))
        if len(active) < 2:
            continue

        factor_indices = [pool_to_global[g] for g in active]
        pareto_front.append({
            "genes": list(ind),
            "active_indices": factor_indices,
            "active_factors": [factor_names[i] for i in factor_indices],
            "n_active": len(active),
            "fitness": {
                "composite_IC": round(float(ind.fitness.values[0]), 4),
                "anti_redundancy": round(float(ind.fitness.values[1]), 4),
                "diversity": round(float(ind.fitness.values[2]), 4),
                "stability": round(float(ind.fitness.values[3]), 4),
            },
        })

    # Deduplicate by sorted active factor set
    seen = set()
    unique_front = []
    for sol in pareto_front:
        key = tuple(sorted(sol["active_factors"]))
        if key not in seen:
            seen.add(key)
            unique_front.append(sol)
    pareto_front = unique_front
    pareto_front.sort(key=lambda x: x["fitness"]["composite_IC"], reverse=True)

    all_generations = []
    for entry in logbook:
        all_generations.append({
            "gen": entry["gen"],
            "evals": entry["evals"],
            "avg": [round(float(v), 4) for v in entry["avg"]],
            "std": [round(float(v), 4) for v in entry["std"]],
            "min": [round(float(v), 4) for v in entry["min"]],
            "max": [round(float(v), 4) for v in entry["max"]],
        })

    stats_out = {
        "pop_size": pop_size,
        "n_generations": n_gen,
        "mut_rate": mut_rate,
        "crossover_rate": crossover_rate,
        "max_genes": max_genes,
        "pareto_size": len(pareto_front),
    }

    print(f"[genetic] Pareto front: {len(pareto_front)} non-dominated solutions")

    return {
        "pareto_front": pareto_front,
        "all_generations": all_generations,
        "stats": stats_out,
    }


def _mutate_chromosome(individual, M, mut_rate):
    """Custom mutation: replace a random gene with a new value."""
    max_genes = len(individual)
    for i in range(max_genes):
        if random.random() < mut_rate / max_genes:
            if random.random() < 0.15:
                individual[i] = -1
            else:
                individual[i] = random.randint(0, M - 1)


def _fallback_random_search(candidate_pool, ic_matrix, factor_names,
                            n_iter=5000, seed=42):
    """Fallback: random search when DEAP is unavailable.

    Generates random subsets and keeps the non-dominated ones.
    """
    rng = np.random.default_rng(seed)
    pool_indices = [f["factor_index"] for f in candidate_pool]
    M = len(pool_indices)
    max_genes = 6

    ic_sub = np.array([ic_matrix[i] for i in pool_indices])
    pool_to_global = {k: v for k, v in enumerate(pool_indices)}
    evaluate = make_fitness_evaluator(ic_sub)

    all_solutions = []
    for _ in range(n_iter):
        n_active = rng.integers(2, max_genes + 1)
        genes = [-1] * max_genes
        chosen = rng.choice(M, size=n_active, replace=False)
        for j in range(n_active):
            genes[j] = int(chosen[j])
        rng.shuffle(genes)

        fit = evaluate(genes)
        all_solutions.append((genes, fit))

    # Non-dominated sort (simple O(N^2) for fallback)
    n = len(all_solutions)
    dominated = [False] * n
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            fi = all_solutions[i][1]
            fj = all_solutions[j][1]
            if all(fj[k] >= fi[k] for k in range(4)) and any(fj[k] > fi[k] for k in range(4)):
                dominated[i] = True
                break

    pareto_front = []
    for i, (genes, fit) in enumerate(all_solutions):
        if not dominated[i]:
            active = [g for g in genes if g >= 0 and g < M]
            active = list(set(active))
            if len(active) < 2:
                continue
            factor_indices = [pool_to_global[g] for g in active]
            pareto_front.append({
                "genes": genes,
                "active_indices": factor_indices,
                "active_factors": [factor_names[i] for i in factor_indices],
                "n_active": len(active),
                "fitness": {
                    "composite_IC": round(float(fit[0]), 4),
                    "anti_redundancy": round(float(fit[1]), 4),
                    "diversity": round(float(fit[2]), 4),
                    "stability": round(float(fit[3]), 4),
                },
            })

    # Deduplicate
    seen = set()
    unique_front = []
    for sol in pareto_front:
        key = tuple(sorted(sol["active_factors"]))
        if key not in seen:
            seen.add(key)
            unique_front.append(sol)
    pareto_front = unique_front
    pareto_front.sort(key=lambda x: x["fitness"]["composite_IC"], reverse=True)
    print(f"[genetic] Fallback random search: {len(pareto_front)} non-dominated "
          f"from {n_iter} iterations")

    return {
        "pareto_front": pareto_front,
        "all_generations": [],
        "stats": {"n_iterations": n_iter, "pareto_size": len(pareto_front),
                   "method": "random_search_fallback"},
    }


def save_genetic_result(result, path):
    with open(path, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"[genetic] Saved to {path}")
