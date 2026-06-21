#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Python 量化引擎 — 回测/指标/信号/TradingView数据桥接
用法: python quant-engine.py <command> <code> [params...]
"""
import sys, json, math, io
# 强制 UTF-8 输出 (Windows GBK 兼容)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# ========== 技术指标 ==========

def SMA(data, period):
    """简单移动平均"""
    if len(data) < period: return [None]*len(data)
    result = [None]*(period-1)
    s = sum(data[:period])
    result.append(s/period)
    for i in range(period, len(data)):
        s += data[i] - data[i-period]
        result.append(s/period)
    return result

def EMA(data, period):
    """指数移动平均"""
    result = [None]*len(data)
    k = 2/(period+1)
    result[0] = data[0]
    for i in range(1, len(data)):
        result[i] = data[i]*k + result[i-1]*(1-k)
    return result

def MACD(closes, fast=12, slow=26, signal=9):
    """MACD指标"""
    ema_fast = EMA(closes, fast)
    ema_slow = EMA(closes, slow)
    dif = [None]*len(closes)
    dea = [None]*len(closes)
    macd_hist = [None]*len(closes)
    for i in range(len(closes)):
        if ema_fast[i] and ema_slow[i]:
            dif[i] = ema_fast[i] - ema_slow[i]
    dea_vals = EMA([d if d else 0 for d in dif], signal)
    for i in range(len(closes)):
        if dif[i] and dea_vals[i]:
            dea[i] = dea_vals[i]
            macd_hist[i] = (dif[i] - dea[i])*2
    return dif, dea, macd_hist

def RSI(closes, period=14):
    """相对强弱指标"""
    result = [None]*len(closes)
    gains = [0]*len(closes)
    losses = [0]*len(closes)
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i-1]
        gains[i] = diff if diff > 0 else 0
        losses[i] = -diff if diff < 0 else 0
    avg_gain = sum(gains[1:period+1])/period
    avg_loss = sum(losses[1:period+1])/period
    for i in range(period, len(closes)):
        if avg_loss == 0:
            result[i] = 100
        else:
            rs = avg_gain/avg_loss
            result[i] = 100 - 100/(1+rs)
        if i < len(closes)-1:
            avg_gain = (avg_gain*(period-1)+gains[i+1])/period
            avg_loss = (avg_loss*(period-1)+losses[i+1])/period
    return result

def BOLL(closes, period=20, std=2):
    """布林带"""
    ma = SMA(closes, period)
    upper = [None]*len(closes)
    lower = [None]*len(closes)
    for i in range(period-1, len(closes)):
        if ma[i] is None: continue
        vals = closes[i-period+1:i+1]
        avg = sum(vals)/period
        variance = sum((v-avg)**2 for v in vals)/period
        s = math.sqrt(variance)
        upper[i] = ma[i] + std*s
        lower[i] = ma[i] - std*s
    return upper, ma, lower

def ATR(highs, lows, closes, period=14):
    """平均真实波幅"""
    result = [None]*len(closes)
    tr = [0]*len(closes)
    for i in range(1, len(closes)):
        tr[i] = max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1]))
    for i in range(period, len(closes)):
        result[i] = sum(tr[i-period+1:i+1])/period
    return result

# ========== 回测引擎 ==========

def backtest(klines, strategy="maCross", params=None):
    """策略回测引擎"""
    closes = [k['close'] for k in klines]
    opens = [k['open'] for k in klines]
    highs = [k['high'] for k in klines]
    lows = [k['low'] for k in klines]
    volumes = [k['volume'] for k in klines]
    dates = [k['date'] for k in klines]

    signals = []   # [{date, type: buy/sell, price, reason}]
    trades = []    # [{entryDate, exitDate, entryPrice, exitPrice, pnl, pnlPct, holdingDays}]
    equity = []    # [{date, value}]
    position = 0
    cash = 1000000
    initial_cash = cash
    shares = 0
    entry_price = 0
    entry_date = ''

    # 生成信号
    if strategy == "maCross":
        fast = params.get('fast', 5) if params else 5
        slow = params.get('slow', 20) if params else 20
        ma_fast = SMA(closes, fast)
        ma_slow = SMA(closes, slow)
        for i in range(slow, len(closes)):
            if ma_fast[i] and ma_slow[i] and ma_fast[i-1] and ma_slow[i-1]:
                if ma_fast[i-1] <= ma_slow[i-1] and ma_fast[i] > ma_slow[i]:
                    signals.append({'date': dates[i], 'type': 'buy', 'price': closes[i], 'reason': f'MA{fast}上穿MA{slow}'})
                elif ma_fast[i-1] >= ma_slow[i-1] and ma_fast[i] < ma_slow[i]:
                    signals.append({'date': dates[i], 'type': 'sell', 'price': closes[i], 'reason': f'MA{fast}下穿MA{slow}'})

    elif strategy == "macd":
        dif, dea, hist = MACD(closes)
        for i in range(1, len(closes)):
            if hist[i] and hist[i-1] and hist[i] > 0 and hist[i-1] <= 0:
                signals.append({'date': dates[i], 'type': 'buy', 'price': closes[i], 'reason': 'MACD金叉'})
            elif hist[i] and hist[i-1] and hist[i] < 0 and hist[i-1] >= 0:
                signals.append({'date': dates[i], 'type': 'sell', 'price': closes[i], 'reason': 'MACD死叉'})

    elif strategy == "boll":
        upper, mid, lower = BOLL(closes)
        for i in range(1, len(closes)):
            if lower[i] and closes[i-1] < lower[i-1] and closes[i] >= lower[i]:
                signals.append({'date': dates[i], 'type': 'buy', 'price': closes[i], 'reason': '触及下轨反弹'})
            elif upper[i] and closes[i-1] > upper[i-1] and closes[i] <= upper[i]:
                signals.append({'date': dates[i], 'type': 'sell', 'price': closes[i], 'reason': '触及上轨回落'})

    elif strategy == "rsi":
        rsi_vals = RSI(closes, 14)
        for i in range(1, len(closes)):
            if rsi_vals[i] and rsi_vals[i-1] and rsi_vals[i-1] <= 30 and rsi_vals[i] > 30:
                signals.append({'date': dates[i], 'type': 'buy', 'price': closes[i], 'reason': 'RSI超卖反弹'})
            elif rsi_vals[i] and rsi_vals[i-1] and rsi_vals[i-1] >= 70 and rsi_vals[i] < 70:
                signals.append({'date': dates[i], 'type': 'sell', 'price': closes[i], 'reason': 'RSI超买回落'})

    # 模拟交易 — 逐根K线推进，每根记录权益
    sig_idx = 0
    for i, k in enumerate(klines):
        # 检查当天是否有信号
        while sig_idx < len(signals) and signals[sig_idx]['date'] == k['date']:
            sig = signals[sig_idx]
            if sig['type'] == 'buy' and cash > 0:
                shares = int(cash / sig['price'] / 100) * 100
                if shares > 0:
                    cost = shares * sig['price'] * 1.0003  # 手续费万三
                    cash -= cost
                    position = shares
                    entry_price = sig['price']
                    entry_date = sig['date']
            elif sig['type'] == 'sell' and position > 0:
                revenue = position * sig['price'] * 0.9997
                pnl = revenue - (position * entry_price)
                pnl_pct = (sig['price']/entry_price - 1)*100
                trades.append({
                    'entryDate': entry_date,
                    'exitDate': sig['date'],
                    'entryPrice': entry_price,
                    'exitPrice': sig['price'],
                    'pnl': round(pnl, 2),
                    'pnlPct': round(pnl_pct, 2),
                    'holdingDays': 0
                })
                cash = revenue
                position = 0
            sig_idx += 1

        # 每根K线记录当前权益
        value = cash + position * k['close']
        equity.append({'date': k['date'], 'value': round(value, 2)})

    final_value = cash + position*closes[-1]
    total_return = (final_value/initial_cash - 1)*100
    daily_returns = []
    for i in range(1, len(equity)):
        daily_returns.append((equity[i]['value']/equity[i-1]['value'])-1)
    avg_daily = sum(daily_returns)/len(daily_returns) if daily_returns else 0
    std_daily = math.sqrt(sum((r-avg_daily)**2 for r in daily_returns)/len(daily_returns)) if daily_returns else 0
    sharpe = (avg_daily/std_daily)*math.sqrt(252) if std_daily > 0 else 0
    # 最大回撤
    peak_val = 0; max_dd = 0
    for e in equity:
        if e['value'] > peak_val: peak_val = e['value']
        dd = (e['value']-peak_val)/peak_val*100
        if dd < max_dd: max_dd = dd

    return {
        'strategy': strategy,
        'params': params or {},
        'initialCapital': initial_cash,
        'finalValue': round(final_value, 2),
        'totalReturn': round(total_return, 2),
        'sharpe': round(sharpe, 2),
        'maxDrawdown': round(max_dd, 2),
        'totalTrades': len(trades),
        'winRate': round(sum(1 for t in trades if t['pnl']>0)/len(trades)*100, 1) if trades else 0,
        'signals': signals,
        'trades': trades,
        'equity': equity[-250:],
    }

# ========== CLI ==========

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'help'

    if cmd == 'indicators':
        # 读取stdin的JSON kline数据
        data = json.load(sys.stdin)
        closes = [k['close'] for k in data]
        highs = [k['high'] for k in data] if 'high' in data[0] else closes
        lows = [k['low'] for k in data] if 'low' in data[0] else closes
        result = {
            'sma5': SMA(closes, 5)[-200:],
            'sma10': SMA(closes, 10)[-200:],
            'sma20': SMA(closes, 20)[-200:],
            'sma60': SMA(closes, 60)[-200:],
            'ema12': EMA(closes, 12)[-200:],
            'ema26': EMA(closes, 26)[-200:],
            'boll_upper': BOLL(closes)[0][-200:],
            'boll_mid': BOLL(closes)[1][-200:],
            'boll_lower': BOLL(closes)[2][-200:],
            'rsi14': RSI(closes, 14)[-200:],
            'macd_dif': MACD(closes)[0][-200:],
            'macd_dea': MACD(closes)[1][-200:],
            'macd_hist': MACD(closes)[2][-200:],
            'atr14': ATR(highs, lows, closes, 14)[-200:],
        }
        print(json.dumps(result, ensure_ascii=False))

    elif cmd == 'backtest':
        data = json.load(sys.stdin)
        strategy = sys.argv[2] if len(sys.argv) > 2 else 'maCross'
        params = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        result = backtest(data, strategy, params)
        print(json.dumps(result, ensure_ascii=False))

    else:
        print(json.dumps({"error": "未知命令, 用: indicators / backtest"}))
