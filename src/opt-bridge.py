#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""期权行情桥接 — akshare → JSON，供 Node.js 调用

用法:
  python opt-bridge.py quotes [codes]          # 50ETF期权实时行情 (默认)
  python opt-bridge.py info                    # 上交所期权合约基本信息
  python opt-bridge.py minute <symbol>         # 单合约实时分钟行情
  python opt-bridge.py daily <symbol>          # 单合约日线历史
"""
import sys, json, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

MODE = sys.argv[1] if len(sys.argv) > 1 else 'quotes'


def _get_latest_from_minute(code):
    """从分钟线取最新价格 + 从日线取昨收价（主数据源）"""
    try:
        import akshare as ak
        df = ak.option_sse_minute_sina(symbol=code)
        if df is None or len(df) == 0:
            return None
        last = df.iloc[-1]
        result = {
            "code": str(code),
            "price": float(last.iloc[2] or 0),
            "volume": int(last.iloc[3] or 0),
            "avgPrice": float(last.iloc[5] or 0),
            "preClose": 0,
        }
        # 从日线取昨收 (前一日收盘价)
        try:
            daily = ak.option_sse_daily_sina(symbol=code)
            if daily is not None and len(daily) >= 2:
                result["preClose"] = float(daily.iloc[-2].iloc[4] or 0)
            elif daily is not None and len(daily) == 1:
                result["preClose"] = float(daily.iloc[0].iloc[4] or 0)
        except:
            pass
        return result
    except:
        return None


def _get_from_tencent(code):
    """从腾讯行情获取期权实时价（备用数据源）"""
    try:
        import requests
        url = f"https://qt.gtimg.cn/q=CON_OP_{code}"
        r = requests.get(url, timeout=5, headers={"Referer": "https://finance.qq.com"})
        if r.status_code != 200:
            return None
        text = r.text
        if 'none_match' in text:
            return None
        # 腾讯期权格式: v_CON_OP_XXXXX="字段1~字段2~..."
        # 字段: 0:名称 1:代码 2:最新价 3:涨跌额 4:涨跌幅 5:昨收 6:开盘 7:最高 8:最低 ...
        for line in text.split('\n'):
            if '="' in line and 'CON_OP' in line:
                raw = line.split('="')[1].rstrip('";\n')
                fields = raw.split('~')
                if len(fields) > 30:
                    return {
                        "code": str(code),
                        "name": fields[1] if len(fields) > 1 else str(code),
                        "price": float(fields[3]) if fields[3] else 0,
                        "preClose": float(fields[4]) if fields[4] else 0,
                        "open": float(fields[5]) if fields[5] else 0,
                        "high": float(fields[33]) if len(fields) > 33 and fields[33] else 0,
                        "low": float(fields[34]) if len(fields) > 34 and fields[34] else 0,
                        "volume": int(fields[6]) if fields[6] else 0,
                        "amount": float(fields[37]) if len(fields) > 37 and fields[37] else 0,
                        "avgPrice": 0,
                    }
        return None
    except:
        return None


def get_option_quotes(codes=None):
    """获取期权实时行情 — 指定代码用分钟线，全部列表用info+分钟线"""
    target_codes = codes if (codes and codes[0]) else []
    results = []

    if target_codes:
        # 指定代码: 逐合约查分钟线取最新价（主力数据源）+ 腾讯备用
        for code in target_codes:
            try:
                latest = _get_latest_from_minute(code)
                if latest:
                    results.append({
                        "code": latest["code"], "name": latest["code"],
                        "price": latest["price"], "open": 0, "high": 0, "low": 0,
                        "preClose": latest.get("preClose", 0),
                        "volume": latest["volume"], "amount": 0,
                        "buy": 0, "sell": 0, "strike": 0,
                    })
                else:
                    # 分钟线无数据，尝试腾讯API
                    tx = _get_from_tencent(code)
                    if tx and tx.get("price", 0) > 0:
                        results.append({
                            "code": tx["code"], "name": tx.get("name", tx["code"]),
                            "price": tx["price"], "open": tx.get("open", 0),
                            "high": tx.get("high", 0), "low": tx.get("low", 0),
                            "preClose": tx.get("preClose", 0),
                            "volume": tx.get("volume", 0), "amount": tx.get("amount", 0),
                            "buy": 0, "sell": 0, "strike": 0,
                        })
                    else:
                        results.append({"code": code, "name": code, "price": 0, "preClose": 0})
            except:
                results.append({"code": code, "name": code, "price": 0, "preClose": 0})
    else:
        # 无指定代码: 从 info 获取合约列表，用分钟线逐合约取价
        # (原 option_sse_spot_price_sina 批量接口已于2026年失效，改用逐合约查询)
        try:
            info_list = get_option_info()
            if info_list:
                import time
                for item in info_list:
                    code = item.get("code", "")
                    if not code or len(str(code)) < 8:
                        continue
                    try:
                        latest = _get_latest_from_minute(str(code))
                        if latest and latest.get("price", 0) > 0:
                            results.append({
                                "code": latest["code"], "name": item.get("name", latest["code"]),
                                "price": latest["price"], "open": 0, "high": 0, "low": 0,
                                "preClose": latest.get("preClose", 0),
                                "volume": latest["volume"], "amount": 0,
                                "buy": 0, "sell": 0, "strike": float(item.get("strike", 0)),
                            })
                        else:
                            # 无实时价但保留合约信息+昨收
                            code_str = str(code)
                            preclose = 0
                            try:
                                import akshare as ak
                                daily = ak.option_sse_daily_sina(symbol=code_str)
                                if daily is not None and len(daily) >= 2:
                                    preclose = float(daily.iloc[-2].iloc[4] or 0)
                            except:
                                pass
                            results.append({
                                "code": code_str, "name": item.get("name", code_str),
                                "price": 0, "open": 0, "high": 0, "low": 0,
                                "preClose": preclose, "volume": 0, "amount": 0,
                                "buy": 0, "sell": 0, "strike": float(item.get("strike", 0)),
                            })
                        # 避免请求过快
                        if len(results) % 5 == 0:
                            time.sleep(0.1)
                    except:
                        results.append({
                            "code": str(code), "name": item.get("name", str(code)),
                            "price": 0, "open": 0, "high": 0, "low": 0,
                            "preClose": 0, "volume": 0, "amount": 0,
                            "buy": 0, "sell": 0, "strike": float(item.get("strike", 0)),
                        })
        except Exception as e:
            print(f"opt-bridge batch error: {e}", file=sys.stderr)

    return results


def get_option_info():
    """获取上交所期权合约基本信息 (所有到期月份)"""
    try:
        import akshare as ak
        df = ak.option_current_day_sse()
        if df is None or len(df) == 0:
            return []

        # column order (position-based for encoding safety):
        # 0:合约代码 1:交易代码 2:合约名称 3:标的 4:认购/认沽 5:行权价 6:合约单位 7:到期日 8:行权日 9:最后交易日 10:上市日期
        cols = list(df.columns)
        results = []
        for _, row in df.iterrows():
            results.append({
                "code": str(row.iloc[0]) if len(cols) > 0 else '',           # 数字代码(API用)
                "tradingCode": str(row.iloc[1]) if len(cols) > 1 else '',    # 交易代码(显示用)
                "name": str(row.iloc[2]) if len(cols) > 2 else '',
                "type": str(row.iloc[4]) if len(cols) > 4 else '',
                "strike": float(row.iloc[5]) if len(cols) > 5 else 0,
                "expireDate": str(row.iloc[7]) if len(cols) > 7 else '',
                "underlying": str(row.iloc[3]) if len(cols) > 3 else '',
                "contractUnit": int(row.iloc[6]) if len(cols) > 6 else 0,
                "listDate": str(row.iloc[10]) if len(cols) > 10 else '',
            })
        return results
    except Exception as e:
        print(f"opt-bridge info error: {e}", file=sys.stderr)
        return []


def get_option_minute(symbol):
    """获取单期权合约实时分钟行情"""
    try:
        import akshare as ak
        df = ak.option_sse_minute_sina(symbol=symbol)
        if df is None or len(df) == 0:
            return []
        # columns: 0:日期 1:时间 2:价格 3:成交量 4:持仓量 5:均价
        results = []
        for _, row in df.iterrows():
            results.append({
                "date": str(row.iloc[0]),
                "time": str(row.iloc[1]),
                "price": float(row.iloc[2] or 0),
                "volume": int(row.iloc[3] or 0),
                "openInterest": int(row.iloc[4] or 0),
                "avgPrice": float(row.iloc[5] or 0),
            })
        return results
    except Exception as e:
        print(f"opt-bridge minute error: {e}", file=sys.stderr)
        return []


def get_option_daily(symbol):
    """获取单期权合约日线历史行情"""
    try:
        import akshare as ak
        df = ak.option_sse_daily_sina(symbol=symbol)
        if df is None or len(df) == 0:
            return []
        # columns: 0:日期 1:开盘 2:最高 3:最低 4:收盘 5:成交量
        results = []
        for _, row in df.iterrows():
            results.append({
                "date": str(row.iloc[0]),
                "open": float(row.iloc[1] or 0),
                "high": float(row.iloc[2] or 0),
                "low": float(row.iloc[3] or 0),
                "close": float(row.iloc[4] or 0),
                "volume": int(row.iloc[5] or 0),
            })
        return results
    except Exception as e:
        print(f"opt-bridge daily error: {e}", file=sys.stderr)
        return []


# ====== CLI 入口 ======
if __name__ == '__main__':
    if MODE == 'info':
        results = get_option_info()
        print(json.dumps(results, ensure_ascii=False))

    elif MODE == 'minute':
        symbol = sys.argv[2] if len(sys.argv) > 2 else ''
        results = get_option_minute(symbol)
        print(json.dumps(results, ensure_ascii=False))

    elif MODE == 'daily':
        symbol = sys.argv[2] if len(sys.argv) > 2 else ''
        results = get_option_daily(symbol)
        print(json.dumps(results, ensure_ascii=False))

    else:  # quotes (default)
        codes = sys.argv[2].split(',') if len(sys.argv) > 2 else []
        results = get_option_quotes(codes)
        print(json.dumps(results, ensure_ascii=False))
