"""
Qlib Service — CLI bridge for Node.js backend.
Usage: python qlib_service.py <command> [options]
Output: JSON on stdout (non-JSON lines go to stderr)
"""
import os
import sys
import json
import argparse

os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'
os.environ['NUMEXPR_NUM_THREADS'] = '1'

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_DIR, "data")
MODEL_DIR = os.path.join(DATA_DIR, "models")
os.makedirs(MODEL_DIR, exist_ok=True)

import numpy as np
import pandas as pd
import qlib
from qlib.constant import REG_CN
from qlib.utils import init_instance_by_config
from qlib.data import D
from scipy.stats import spearmanr, pearsonr


def init():
    qlib.init(provider_uri="C:/Users/lb/.qlib/qlib_data/cn_data", region=REG_CN)


def get_handler_config(market, start, end, fit_end):
    return {
        "class": "Alpha158",
        "module_path": "qlib.contrib.data.handler",
        "kwargs": {
            "start_time": start,
            "end_time": end,
            "fit_start_time": start,
            "fit_end_time": fit_end,
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
    }


def get_model_config(model_type):
    configs = {
        "lgb": {
            "class": "LGBModel",
            "module_path": "qlib.contrib.model.gbdt",
            "kwargs": {
                "loss": "mse", "colsample_bytree": 0.8879, "learning_rate": 0.0421,
                "subsample": 0.8789, "lambda_l1": 205.6999, "lambda_l2": 580.9766,
                "max_depth": 8, "num_leaves": 210, "num_threads": 0,
                "verbosity": -1, "early_stopping_rounds": 50, "num_boost_round": 300,
            },
        },
        "lgb_fast": {
            "class": "LGBModel",
            "module_path": "qlib.contrib.model.gbdt",
            "kwargs": {
                "loss": "mse", "colsample_bytree": 0.8, "learning_rate": 0.05,
                "subsample": 0.8, "max_depth": 6, "num_leaves": 128,
                "num_threads": 0, "verbosity": -1, "early_stopping_rounds": 30,
                "num_boost_round": 150,
            },
        },
    }
    if model_type in configs:
        return configs[model_type]
    # Return custom config from model_type if it's JSON
    try:
        return json.loads(model_type)
    except (json.JSONDecodeError, TypeError):
        return configs["lgb"]


def calc_ic_metrics(pred, label):
    """Calculate daily IC metrics."""
    df = pd.DataFrame({"pred": pred, "label": label})
    # Get date from multi-index or regular index
    if hasattr(df.index, 'get_level_values'):
        try:
            df["date"] = df.index.get_level_values("datetime").normalize()
        except (KeyError, AttributeError):
            df["date"] = pd.to_datetime(df.index).normalize()
    else:
        df["date"] = pd.to_datetime(df.index).normalize()

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

    ic_mean = float(np.mean(daily_ics)) if daily_ics else None
    ic_std = float(np.std(daily_ics)) if daily_ics else None
    ric_mean = float(np.mean(daily_rics)) if daily_rics else None
    ric_std = float(np.std(daily_rics)) if daily_rics else None
    icir = ic_mean / ic_std if ic_std and ic_std > 0 else None
    ricir = ric_mean / ric_std if ric_std and ric_std > 0 else None

    return {
        "IC_mean": ic_mean, "IC_std": ic_std, "ICIR": icir,
        "Rank_IC_mean": ric_mean, "Rank_IC_std": ric_std, "Rank_ICIR": ricir,
        "n_days": len(daily_ics),
    }


def cmd_train(market="csi300", model_type="lgb",
              train_start=None, train_end=None,
              valid_start=None, valid_end=None,
              test_start=None, test_end=None,
              model_name=None, **kwargs):
    """Train a model and save artifacts."""
    train_start = train_start or "2010-01-01"
    train_end = train_end or "2017-12-31"
    valid_start = valid_start or "2018-01-01"
    valid_end = valid_end or "2018-12-31"
    test_start = test_start or "2019-01-01"
    test_end = test_end or "2020-09-01"
    init()

    handler_config = get_handler_config(market, train_start, test_end, train_end)
    model_cfg = get_model_config(model_type)

    dataset_config = {
        "class": "DatasetH",
        "module_path": "qlib.data.dataset",
        "kwargs": {
            "handler": handler_config,
            "segments": {
                "train": [train_start, train_end],
                "valid": [valid_start, valid_end],
                "test": [test_start, test_end],
            },
        },
    }

    import time
    t0 = time.time()

    dataset = init_instance_by_config(dataset_config)
    segs = ["train", "valid", "test"]
    df_list = dataset.prepare(segs)
    shapes = {s: list(d.shape) for s, d in zip(segs, df_list)}

    model = init_instance_by_config(model_cfg)
    model.fit(dataset)

    train_time = round(time.time() - t0, 1)

    # Predict on test
    pred_test = model.predict(dataset, segment="test")
    label_all = dataset.prepare("test", col_set="label")
    if isinstance(label_all, list):
        label_all = label_all[0]
    label_col = label_all.columns[0]

    metrics = calc_ic_metrics(pred_test, label_all[label_col])

    # Save model
    if model_name is None:
        model_name = f"{market}_{model_type}_{time.strftime('%Y%m%d_%H%M%S')}"
    model_path = os.path.join(MODEL_DIR, model_name)
    os.makedirs(model_path, exist_ok=True)
    model.to_pickle(os.path.join(model_path, "model.pkl"))

    # Save predictions and labels
    pred_test.to_pickle(os.path.join(model_path, "pred_test.pkl"))
    label_all.to_pickle(os.path.join(model_path, "label_test.pkl"))

    # Feature importance
    try:
        importance = model.get_feature_importance()
        imp_dict = {str(k): float(v) for k, v in importance.to_dict().items()}
        top_features = dict(sorted(imp_dict.items(), key=lambda x: abs(x[1]), reverse=True)[:20])
    except Exception:
        top_features = {}

    meta = {
        "model_name": model_name,
        "market": market,
        "model_type": model_type,
        "train_time_s": train_time,
        "shapes": shapes,
    }
    meta.update(metrics)

    with open(os.path.join(model_path, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2, default=str)

    print(json.dumps(meta, indent=2, default=str))
    return meta


def cmd_predict(model_name, market="csi300", date=None, stock_list=None, **kwargs):
    """Predict using a trained model."""
    init()

    model_path = os.path.join(MODEL_DIR, model_name)
    pkl_path = os.path.join(model_path, "model.pkl")
    if not os.path.isfile(pkl_path):
        print(json.dumps({"error": f"Model not found: {model_name}"}))
        return

    from qlib.contrib.model.gbdt import LGBModel
    model = LGBModel()
    model.load(pkl_path)

    # If specific date/stocks given
    if date and stock_list:
        instruments = stock_list if isinstance(stock_list, list) else stock_list.split(",")
        instruments = [s.strip() for s in instruments if s.strip()]
        # Build prediction dataset for specific date
        handler_config = get_handler_config(market, date, date, date)
        # Override instruments
        handler_config["kwargs"]["instruments"] = instruments
        dataset_config = {
            "class": "DatasetH",
            "module_path": "qlib.data.dataset",
            "kwargs": {
                "handler": handler_config,
                "segments": {"predict": [date, date]},
            },
        }
        dataset = init_instance_by_config(dataset_config)
        pred = model.predict(dataset, segment="predict")
        result = [{"stock": str(idx), "score": float(s)} for idx, s in pred.items()]
        print(json.dumps({"predictions": result}, default=str))
    else:
        # Predict on full test range
        meta_path = os.path.join(model_path, "meta.json")
        with open(meta_path) as f:
            meta = json.load(f)
        print(json.dumps(meta, indent=2, default=str))


def cmd_list_models(**kwargs):
    """List all trained models."""
    models = []
    if os.path.isdir(MODEL_DIR):
        for name in sorted(os.listdir(MODEL_DIR), reverse=True):
            mpath = os.path.join(MODEL_DIR, name)
            meta_path = os.path.join(mpath, "meta.json")
            if os.path.isfile(meta_path):
                with open(meta_path) as f:
                    meta = json.load(f)
                models.append(meta)
    print(json.dumps(models, indent=2, default=str))


def cmd_status(**kwargs):
    """Check Qlib environment status."""
    try:
        init()
        cal = D.calendar()
        status = {
            "status": "ok",
            "qlib_version": qlib.__version__,
            "data_start": str(cal[0]),
            "data_end": str(cal[-1]),
            "n_trading_days": len(cal),
            "models_available": len(os.listdir(MODEL_DIR)) if os.path.isdir(MODEL_DIR) else 0,
            "model_dir": MODEL_DIR,
        }
    except Exception as e:
        status = {"status": "error", "error": str(e)}
    print(json.dumps(status, indent=2, default=str))


COMMANDS = {
    "train": cmd_train,
    "predict": cmd_predict,
    "list-models": cmd_list_models,
    "status": cmd_status,
}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Qlib Service CLI")
    parser.add_argument("command", choices=list(COMMANDS.keys()), help="Command to run")
    parser.add_argument("--model-name", type=str, help="Model name")
    parser.add_argument("--market", type=str, default="csi300")
    parser.add_argument("--model-type", type=str, default="lgb")
    parser.add_argument("--date", type=str)
    parser.add_argument("--stock-list", type=str)
    parser.add_argument("--train-start", type=str)
    parser.add_argument("--train-end", type=str)
    parser.add_argument("--valid-start", type=str)
    parser.add_argument("--valid-end", type=str)
    parser.add_argument("--test-start", type=str)
    parser.add_argument("--test-end", type=str)
    parser.add_argument("--extra", type=str, default="{}", help="JSON extra args")

    args = vars(parser.parse_args())
    cmd = args.pop("command")
    extra = json.loads(args.pop("extra", "{}"))
    args.update(extra)

    COMMANDS[cmd](**args)
