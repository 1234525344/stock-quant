#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""财务数据桥接 — akshare 基本面 → JSON"""
import sys, json, math, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def get_fundamental(code):
    try:
        import akshare as ak
        df = ak.stock_financial_abstract(symbol=code)
        if df is None or len(df) == 0:
            return {"error": "无财务数据"}

        # 关键指标行索引 (akshare固定顺序)
        # [0]=归母净利润, [1]=营业总收入, [2]=营业成本, [3]=净利润, [4]=扣非净利润, [5]=股东权益
        items = df.values.tolist()

        def get_val(row_idx):
            """获取最新季度数据"""
            row = items[row_idx]
            vals = [float(v) for v in row[2:] if v and str(v) != 'nan']
            return vals[0] if vals else 0

        def get_prev(row_idx):
            """获取同比去年同季度数据(大约-4列)"""
            row = items[row_idx]
            vals = [float(v) for v in row[2:] if v and str(v) != 'nan']
            return vals[4] if len(vals) > 4 else (vals[1] if len(vals) > 1 else 0)

        revenue = get_val(1)
        prev_rev = get_prev(1)
        profit = get_val(0)
        prev_profit = get_prev(0)
        equity = get_val(5)

        return {
            "code": code,
            "summary": {
                "revenue": revenue,
                "revenueGrowth": ((revenue / prev_rev) - 1) * 100 if prev_rev else 0,
                "netProfit": profit,
                "profitGrowth": ((profit / prev_profit) - 1) * 100 if prev_profit else 0,
                "roe": (profit / equity * 100) if equity > 0 else 0,
                "netMargin": (profit / revenue * 100) if revenue > 0 else 0,
                "equity": equity,
            }
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == '__main__':
    code = sys.argv[1] if len(sys.argv) > 1 else '603773'
    result = get_fundamental(code)
    print(json.dumps(result, ensure_ascii=False))
