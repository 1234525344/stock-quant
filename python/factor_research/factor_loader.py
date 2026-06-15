# Stage 0: Factor exposure matrix loader
# Sources: Qlib Alpha158 (158 factors) or JSON export from Node.js factor engine

import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd


def load_from_qlib(start_date="2020-01-01", end_date="2024-12-31",
                   universe="csi300", data_dir=None):
    """Load factor exposures from Qlib Alpha158 dataset.

    Returns (exposures, factor_names, dates) where:
      exposures: ndarray (N_stocks, N_factors, N_dates) or 2D flattened
      factor_names: list[str]
      dates: pd.DatetimeIndex
    """
    if data_dir is None:
        data_dir = os.path.expanduser("~/.qlib/qlib_data/cn_data")

    try:
        import qlib
        from qlib.data import D
        from qlib.constant import REG_CN

        qlib.init(provider_uri=data_dir, region=REG_CN)

        instruments = D.instruments(market=universe)
        fields = [f"Alpha158_{i:03d}" for i in range(1, 159)]

        df = D.features(
            instruments,
            fields,
            start_time=start_date,
            end_time=end_date,
            freq="day",
        )
        return df, fields, df.index.get_level_values("datetime").unique()

    except ImportError:
        print("[factor_loader] Qlib not installed, falling back to synthetic data")
        return _generate_synthetic(n_factors=158, n_dates=252)


def load_from_json(path):
    """Load factor exposures from a JSON file.

    Expected format: {"factors": {"name1": [...], "name2": [...]},
                       "dates": [...], "stocks": [...]}

    Returns: (exposures, factor_names, dates)
    """
    with open(path, "r") as f:
        data = json.load(f)

    factor_names = list(data["factors"].keys())
    n_stocks = len(data["stocks"])
    n_factors = len(factor_names)
    n_dates = len(data["dates"])

    exposures = np.zeros((n_stocks, n_factors, n_dates))
    for j, name in enumerate(factor_names):
        exposures[:, j, :] = np.array(data["factors"][name])

    dates = pd.to_datetime(data["dates"])
    return exposures, factor_names, dates


def load_ic_from_json(path):
    """Load pre-computed IC time series from factor_ic.json.

    This is the format produced by scripts/export-factor-ic.js:
    {"factors": {"mom12_1": [0.04, -0.01, ...], ...},
     "factor_meta": {"mom12_1": {"meanIC": 0.04, "icir": 0.5}, ...},
     "dates": [...], "stocks": [...]}

    Returns:
      ic_matrix: (N_factors, N_dates) array of IC values
      factor_names: list[str]
      factor_meta: dict with meanIC/icir per factor
      dates: list[str]
    """
    with open(path, "r") as f:
        data = json.load(f)

    factor_names = list(data["factors"].keys())
    n_factors = len(factor_names)
    n_dates = len(data["dates"])

    ic_matrix = np.full((n_factors, n_dates), np.nan)
    for j, name in enumerate(factor_names):
        ic_matrix[j, :] = data["factors"][name]

    factor_meta = data.get("factor_meta", {})
    dates = data["dates"]

    return ic_matrix, factor_names, factor_meta, dates


def compute_ic_series(exposures, forward_returns):
    """Compute Information Coefficient time series for each factor.

    IC(t) = Pearson correlation(cross-section of factor_j at t,
                                 cross-section of forward_return at t)

    Args:
      exposures: (N_stocks, N_factors, N_dates) or (N_panels, N_factors)
      forward_returns: (N_stocks, N_dates) forward 1-period returns

    Returns:
      ic_df: DataFrame (N_factors × N_dates) of IC values
    """
    n_factors = exposures.shape[1]
    n_dates = exposures.shape[2] if exposures.ndim == 3 else 1

    ic_matrix = np.full((n_factors, n_dates), np.nan)

    for t in range(n_dates):
        if exposures.ndim == 3:
            cross_x = exposures[:, :, t]
            cross_y = forward_returns[:, t]
        else:
            cross_x = exposures
            cross_y = forward_returns[:, t] if forward_returns.ndim > 1 else forward_returns

        valid = ~np.isnan(cross_x).any(axis=1) & ~np.isnan(cross_y)
        if valid.sum() < 10:
            continue

        for j in range(n_factors):
            x = cross_x[valid, j]
            y = cross_y[valid]
            ic = np.corrcoef(x, y)[0, 1]
            if not np.isnan(ic):
                ic_matrix[j, t] = ic

    return ic_matrix


def _generate_synthetic(n_factors=50, n_dates=252, n_stocks=300, seed=42):
    """Generate synthetic factor data for testing when Qlib is unavailable."""
    rng = np.random.default_rng(seed)
    exposures = rng.normal(0, 1, (n_stocks, n_factors, n_dates))
    factor_names = [f"factor_{i:03d}" for i in range(n_factors)]
    dates = pd.date_range("2020-01-01", periods=n_dates, freq="B")
    return exposures, factor_names, dates
