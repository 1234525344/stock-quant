"""
Qlib Baseline — LightGBM on CSI300
Trains model, predicts, calculates IC metrics, logs to MLflow.
Bypasses Qlib workflow (SignalRecord/PortAnaRecord) due to version compat issues.
"""
import os
import sys
import time
import json

os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'
os.environ['NUMEXPR_NUM_THREADS'] = '1'

import numpy as np
import pandas as pd
import qlib
from qlib.constant import REG_CN
from qlib.utils import init_instance_by_config
from qlib.data import D
from scipy.stats import spearmanr, pearsonr


def calc_ic(pred: pd.Series, label: pd.Series) -> dict:
    """Calculate Information Coefficient metrics."""
    merged = pd.concat([pred, label], axis=1).dropna()
    if len(merged) < 10:
        return {"IC": np.nan, "Rank_IC": np.nan, "ICIR": np.nan, "Rank_ICIR": np.nan}
    p = merged.iloc[:, 0]
    l = merged.iloc[:, 1]
    ic, _ = pearsonr(p, l)
    ric, _ = spearmanr(p, l)
    return {"IC": ic, "Rank_IC": ric}


def calc_ic_by_date(pred: pd.Series, label: pd.Series) -> dict:
    """Calculate IC grouped by date."""
    df = pd.DataFrame({"pred": pred, "label": label})
    df["date"] = df.index.get_level_values("datetime").normalize() if hasattr(df.index, 'get_level_values') else df.index
    daily_ics = []
    daily_rics = []
    for dt, grp in df.groupby("date"):
        if len(grp) >= 5:
            ic, _ = pearsonr(grp["pred"], grp["label"])
            ric, _ = spearmanr(grp["pred"], grp["label"])
            if not np.isnan(ic):
                daily_ics.append(ic)
            if not np.isnan(ric):
                daily_rics.append(ric)
    ic_mean = np.mean(daily_ics) if daily_ics else np.nan
    ic_std = np.std(daily_ics) if daily_ics else np.nan
    ric_mean = np.mean(daily_rics) if daily_rics else np.nan
    ric_std = np.std(daily_rics) if daily_rics else np.nan
    icir = ic_mean / ic_std if ic_std and ic_std > 0 else np.nan
    ricir = ric_mean / ric_std if ric_std and ric_std > 0 else np.nan
    return {
        "IC_mean": ic_mean, "IC_std": ic_std, "ICIR": icir,
        "Rank_IC_mean": ric_mean, "Rank_IC_std": ric_std, "Rank_ICIR": ricir,
        "n_days": len(daily_ics),
    }


def run_baseline():
    provider_uri = "C:/Users/lb/.qlib/qlib_data/cn_data"
    qlib.init(provider_uri=provider_uri, region=REG_CN)

    market = "csi300"
    benchmark = "SH000300"

    model_config = {
        "class": "LGBModel",
        "module_path": "qlib.contrib.model.gbdt",
        "kwargs": {
            "loss": "mse",
            "colsample_bytree": 0.8879,
            "learning_rate": 0.0421,
            "subsample": 0.8789,
            "lambda_l1": 205.6999,
            "lambda_l2": 580.9766,
            "max_depth": 8,
            "num_leaves": 210,
            "num_threads": 0,
            "verbosity": -1,
            "early_stopping_rounds": 50,
            "num_boost_round": 300,
        },
    }

    dataset_config = {
        "class": "DatasetH",
        "module_path": "qlib.data.dataset",
        "kwargs": {
            "handler": {
                "class": "Alpha158",
                "module_path": "qlib.contrib.data.handler",
                "kwargs": {
                    "start_time": "2010-01-01",
                    "end_time": "2020-09-01",
                    "fit_start_time": "2010-01-01",
                    "fit_end_time": "2017-12-31",
                    "instruments": market,
                    "infer_processors": [
                        {"class": "RobustZScoreNorm", "kwargs": {"fields_group": "feature", "clip_outlier": True}},
                        {"class": "Fillna", "kwargs": {"fields_group": "feature"}},
                    ],
                    "learn_processors": [
                        {"class": "DropnaLabel"},
                        {"class": "CSRankNorm", "kwargs": {"fields_group": "label"}},
                    ],
                    "label": ["Ref($close, -1) / $close - 1"],
                },
            },
            "segments": {
                "train": ["2010-01-01", "2017-12-31"],
                "valid": ["2018-01-01", "2018-12-31"],
                "test": ["2019-01-01", "2020-09-01"],
            },
        },
    }

    print(f"Market: {market} | Benchmark: {benchmark}")
    print(f"Train: 2010-2017 | Valid: 2018 | Test: 2019-2020.09")
    print(f"Features: Alpha158 | Model: LightGBM")
    print("-" * 60)

    # Load data
    print("Loading dataset...")
    t0 = time.time()
    dataset = init_instance_by_config(dataset_config)
    segs = ["train", "valid", "test"]
    df_list = dataset.prepare(segs)
    for s, d in zip(segs, df_list):
        print(f"  {s}: {d.shape}")
    print(f"  Data load time: {time.time() - t0:.1f}s")

    # Train
    print("Training LightGBM...")
    t0 = time.time()
    model = init_instance_by_config(model_config)
    model.fit(dataset)
    print(f"  Train time: {time.time() - t0:.1f}s")

    # Predict on test set
    print("Predicting...")
    t0 = time.time()
    pred_test = model.predict(dataset, segment="test")
    print(f"  Predictions: {pred_test.shape} ({time.time() - t0:.1f}s)")

    # Get labels for test set
    label_all = dataset.prepare("test", col_set="label")
    if isinstance(label_all, list):
        label_all = label_all[0]
    label_col = label_all.columns[0]

    # IC on test set
    print("\nCalculating IC metrics on test set...")
    metrics = calc_ic_by_date(pred_test, label_all[label_col])

    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    result = {}
    for k, v in metrics.items():
        print(f"  {k}: {v:.4f}" if not isinstance(v, int) else f"  {k}: {v}")
        result[k] = float(v) if isinstance(v, (np.floating, float)) else v

    # Save to JSON
    out_path = os.path.join(os.path.dirname(__file__), "data", "baseline_result.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nResults saved to {out_path}")

    # Feature importance
    print("\nTop 10 features by importance:")
    try:
        importance = model.get_feature_importance()
        top10 = importance.head(10)
        for i, row in top10.iterrows():
            print(f"  {i}: {row.values[0]:.4f}")
    except Exception as e:
        print(f"  (skipped: {e})")

    print("\nDone!")


if __name__ == '__main__':
    run_baseline()
