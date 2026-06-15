// 模拟券商 — Paper Trading 执行
// 按当前价成交，模拟 T+1、手续费、滑点
const tradeDB = require("../database/trades.db");

class PaperBroker {
  constructor() {
    this.orderQueue = [];
    this._processing = false;
  }

  // 模拟市场买入
  async buy(code, name, quantity, price, strategyId) {
    const slippage = 1.001; // 0.1% 买入滑点
    const execPrice = +(price * slippage).toFixed(2);
    const fee = this._calcFee(execPrice * quantity);
    const amount = execPrice * quantity + fee;

    const acc = tradeDB.getAccount();
    if (acc.cash < amount) {
      return { success: false, error: `可用资金不足: 需要 ¥${amount.toFixed(2)}, 可用 ¥${acc.cash.toFixed(2)}` };
    }

    // 扣款
    tradeDB.setAccount("cash", +(acc.cash - amount).toFixed(2));

    const orderId = `ORD${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    tradeDB.run(`INSERT INTO orders (id, code, name, side, quantity, price, order_type, status, filled_qty, filled_price, strategy_id)
      VALUES (?,?,?,'buy',?,?,'market','filled',?,?,?)`,
      [orderId, code, name, quantity, execPrice, quantity, execPrice, strategyId || ""]);

    tradeDB.run(`INSERT INTO trades (order_id, code, name, side, quantity, price, amount, fee, strategy_id)
      VALUES (?,?,?,'buy',?,?,?,?,?)`,
      [orderId, code, name, quantity, execPrice, amount, fee, strategyId || ""]);

    this._updatePosition(code, name, quantity, execPrice);

    return {
      success: true,
      orderId,
      code,
      side: "buy",
      quantity,
      price: execPrice,
      amount,
      fee,
      cashRemaining: +(acc.cash - amount).toFixed(2),
    };
  }

  // 模拟市场卖出
  async sell(code, name, quantity, price, strategyId) {
    const slippage = 0.999; // 0.1% 卖出滑点
    const execPrice = +(price * slippage).toFixed(2);

    const pos = tradeDB.get("SELECT * FROM positions WHERE code=? AND quantity>=?", [code, quantity]);
    if (!pos) {
      return { success: false, error: `持仓不足: ${code} 当前持有 ${pos ? pos.quantity : 0} 股，试图卖出 ${quantity} 股` };
    }

    const amount = execPrice * quantity;
    const fee = this._calcFee(amount) + amount * 0.001; // 佣金 + 印花税
    const netAmount = amount - fee;

    const acc = tradeDB.getAccount();
    tradeDB.setAccount("cash", +(acc.cash + netAmount).toFixed(2));

    const orderId = `ORD${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    tradeDB.run(`INSERT INTO orders (id, code, name, side, quantity, price, order_type, status, filled_qty, filled_price, strategy_id)
      VALUES (?,?,?,'sell',?,?,'market','filled',?,?,?)`,
      [orderId, code, name, quantity, execPrice, quantity, execPrice, strategyId || ""]);

    tradeDB.run(`INSERT INTO trades (order_id, code, name, side, quantity, price, amount, fee, strategy_id)
      VALUES (?,?,?,'sell',?,?,?,?,?)`,
      [orderId, code, name, quantity, execPrice, netAmount, fee, strategyId || ""]);

    const realizedPnl = (execPrice - pos.avg_cost) * quantity;
    this._updatePositionSold(code, quantity, realizedPnl);

    return {
      success: true,
      orderId,
      code,
      side: "sell",
      quantity,
      price: execPrice,
      amount: netAmount,
      fee,
      realizedPnl: +realizedPnl.toFixed(2),
      cashRemaining: +(acc.cash + netAmount).toFixed(2),
    };
  }

  _updatePosition(code, name, qty, price) {
    const existing = tradeDB.get("SELECT * FROM positions WHERE code=?", [code]);
    if (existing) {
      const totalQty = existing.quantity + qty;
      const totalCost = existing.avg_cost * existing.quantity + price * qty;
      const newCost = +(totalCost / totalQty).toFixed(3);
      tradeDB.run(
        "UPDATE positions SET quantity=?, avg_cost=?, name=?, current_price=?, market_value=?, unrealized_pnl=?, updated_at=datetime('now','localtime') WHERE code=?",
        [totalQty, newCost, name, price, +(totalQty * price).toFixed(2), +((price - newCost) * totalQty).toFixed(2), code]
      );
    } else {
      tradeDB.run(
        "INSERT INTO positions (code, name, quantity, avg_cost, current_price, market_value, unrealized_pnl) VALUES (?,?,?,?,?,?,?)",
        [code, name, qty, price, price, +(qty * price).toFixed(2), 0]
      );
    }
  }

  _updatePositionSold(code, soldQty, realizedPnl) {
    const existing = tradeDB.get("SELECT * FROM positions WHERE code=?", [code]);
    if (!existing) return;
    const remaining = existing.quantity - soldQty;
    if (remaining <= 0) {
      tradeDB.run("UPDATE positions SET quantity=0, market_value=0, unrealized_pnl=0, realized_pnl=realized_pnl+?, updated_at=datetime('now','localtime') WHERE code=?",
        [realizedPnl, code]);
    } else {
      tradeDB.run(
        "UPDATE positions SET quantity=?, realized_pnl=realized_pnl+?, updated_at=datetime('now','localtime') WHERE code=?",
        [remaining, realizedPnl, code]
      );
    }
  }

  updatePositionPrices(quotes) {
    for (const q of quotes) {
      const pos = tradeDB.get("SELECT * FROM positions WHERE code=? AND quantity>0", [q.code]);
      if (!pos) continue;
      const mktValue = +(pos.quantity * q.price).toFixed(2);
      const upnl = +((q.price - pos.avg_cost) * pos.quantity).toFixed(2);
      tradeDB.run(
        "UPDATE positions SET current_price=?, market_value=?, unrealized_pnl=?, name=?, updated_at=datetime('now','localtime') WHERE code=?",
        [q.price, mktValue, upnl, q.name || pos.name, q.code]
      );
    }
  }

  _calcFee(amount) {
    return Math.max(5, +(amount * 0.00025).toFixed(2)); // 最低5元, 万2.5
  }
}

module.exports = new PaperBroker();
