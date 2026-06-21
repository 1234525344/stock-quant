#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""TDX 行情桥接 — pytdx → JSON，供 Node.js 调用"""
import sys, json, time, random, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def get_quotes(codes):
    """获取股票实时行情，返回 [{code, name, price, open, high, low, preClose, volume, amount}]"""
    from pytdx.hq import TdxHq_API

    servers = [
        "110.41.147.114", "175.178.112.197", "101.33.225.16",
        "175.178.128.227", "122.51.120.217", "150.158.160.2",
        "43.139.95.83", "124.223.163.242"
    ]
    random.shuffle(servers)

    hq = TdxHq_API()
    results = []

    for host in servers:
        try:
            if hq.connect(host, 7709):
                # 确定市场: 6xxxxx=沪(1), 0xxxxx/3xxxxx=深(0)
                sh_codes = [c for c in codes if c.startswith(('6','5','9'))]
                sz_codes = [c for c in codes if c.startswith(('0','3','2'))]

                if sh_codes:
                    data = hq.get_security_quotes([(1, c) for c in sh_codes])
                    if data:
                        for d in data:
                            if d and d.get('price', 0) > 0:
                                # ETF(5开头)价格需要除以10
                                div = 10.0 if d.get('code','').startswith('5') else 1.0
                                results.append({
                                    "code": d.get('code', ''),
                                    "name": d.get('name', ''),
                                    "price": d.get('price', 0) / div,
                                    "open": d.get('open', 0) / div,
                                    "high": d.get('high', 0) / div,
                                    "low": d.get('low', 0) / div,
                                    "preClose": d.get('last_close', 0) / div,
                                    "volume": d.get('vol', 0) or d.get('volume', 0),
                                    "amount": d.get('amount', 0),
                                })

                if sz_codes:
                    data = hq.get_security_quotes([(0, c) for c in sz_codes])
                    if data:
                        for d in data:
                            if d and d.get('price', 0) > 0:
                                # 深圳ETF(1开头)也除以10
                                div = 10.0 if d.get('code','').startswith(('1','5')) else 1.0
                                results.append({
                                    "code": d.get('code', ''),
                                    "name": d.get('name', ''),
                                    "price": d.get('price', 0) / div,
                                    "open": d.get('open', 0) / div,
                                    "high": d.get('high', 0) / div,
                                    "low": d.get('low', 0) / div,
                                    "preClose": d.get('last_close', 0) / div,
                                    "volume": d.get('vol', 0) or d.get('volume', 0),
                                    "amount": d.get('amount', 0),
                                })

                hq.disconnect()
                break  # got data, stop trying servers
        except Exception:
            try: hq.disconnect()
            except: pass
            continue

    return results

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps([]))
        sys.exit(0)

    codes = sys.argv[1].split(',')
    results = get_quotes(codes)

    # 补全缺失的代码
    found = {r['code'] for r in results}
    for c in codes:
        if c not in found:
            results.append({"code": c, "name": "", "price": 0, "preClose": 0})

    print(json.dumps(results, ensure_ascii=False))
