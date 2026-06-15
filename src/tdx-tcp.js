// 通达信TCP行情接收器 v6
// TDX二进制协议解析 + ZLib解压 + 自动重连
//
// 行情服务器: 119.147.212.81:7709 (主)
// 协议: TDX Level-1 market data, binary + ZLib compression

const net = require("net");
const zlib = require("zlib");
const { logger } = require("./logger");

const TDX_SERVERS = [
  { host: "119.147.212.81", port: 7709 },
  { host: "47.92.127.149", port: 7709 },
  { host: "120.76.152.2", port: 7709 },
  { host: "124.70.45.107", port: 7709 },
  { host: "47.94.201.130", port: 7709 },
];

class TDXTCPClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.subscribedCodes = new Set();
    this.quoteCallbacks = [];
    this.statusCallbacks = [];
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.serverIndex = 0;
    this.buffer = Buffer.alloc(0);
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000;
  }

  connect(host, port) {
    this._cleanup();

    const server = (host && port) ? { host, port } : TDX_SERVERS[this.serverIndex];
    this.socket = new net.Socket();
    this.socket.setTimeout(25000);
    this.socket.setKeepAlive(true, 15000);
    this.socket.setNoDelay(true);

    this.socket.connect(server.port, server.host, () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this._notifyStatus("connected", { host: server.host, port: server.port });
      this._startHeartbeat();
      this._resubscribe();
      // 发送登录指令 (TDX协议握手)
      this._sendLogin();
    });

    this.socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this._parseMessages();
    });

    this.socket.on("error", (err) => {
      this.connected = false;
      this._notifyStatus("error", { message: err.message });
      this._cleanup();
      this._scheduleReconnect();
    });

    this.socket.on("close", () => {
      this.connected = false;
      this._notifyStatus("disconnected", {});
      this._stopHeartbeat();
      this._scheduleReconnect();
    });

    this.socket.on("timeout", () => {
      this.socket.destroy();
    });
  }

  disconnect() {
    this._cleanup();
    this.connected = false;
    this._notifyStatus("disconnected", {});
  }

  subscribe(codes) {
    codes = Array.isArray(codes) ? codes : [codes];
    for (const code of codes) this.subscribedCodes.add(code);
    if (this.connected) this._sendSubscribe(codes);
  }

  unsubscribe(codes) {
    codes = Array.isArray(codes) ? codes : [codes];
    for (const code of codes) this.subscribedCodes.delete(code);
  }

  onQuote(callback) {
    this.quoteCallbacks.push(callback);
    return () => {
      const idx = this.quoteCallbacks.indexOf(callback);
      if (idx >= 0) this.quoteCallbacks.splice(idx, 1);
    };
  }

  onStatus(callback) {
    this.statusCallbacks.push(callback);
    return () => {
      const idx = this.statusCallbacks.indexOf(callback);
      if (idx >= 0) this.statusCallbacks.splice(idx, 1);
    };
  }

  getStatus() {
    return {
      connected: this.connected,
      subscribed: [...this.subscribedCodes],
      server: this.connected ? TDX_SERVERS[this.serverIndex] : null,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  // ====== 内部 ======

  _sendLogin() {
    // TDX登录包: 标准的客户端认证请求
    // 对于行情服务器, 通常发送简单的认证消息
    const loginPacket = this._buildPacket([0x01, 0x00]); // 登录命令
    this._rawSend(loginPacket);
  }

  _sendSubscribe(codes) {
    // TDX订阅请求包
    // 格式: 命令码(1) + 市场(1) + 股票代码列表
    const codeStrs = [];
    for (const code of codes) {
      const mkt = code.startsWith("6") ? 1 : 0; // 1=沪, 0=深
      codeStrs.push(String.fromCharCode(mkt) + code);
    }

    const body = Buffer.from(codeStrs.join(""), "binary");
    const packet = this._buildPacket([0x02, 0x00], body); // 订阅命令
    this._rawSend(packet);
  }

  _buildPacket(cmdBytes, body = Buffer.alloc(0)) {
    const header = Buffer.from(cmdBytes);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(body.length + header.length, 0);
    return Buffer.concat([length, header, body]);
  }

  _rawSend(data) {
    if (!this.socket || !this.connected) return;
    try { this.socket.write(data); } catch (e) { logger.warn("[TDX] 写入失败:", e.message); }
  }

  // ====== 消息解析 ======

  _parseMessages() {
    while (this.buffer.length >= 4) {
      // TDX消息格式:
      // 压缩数据: [4字节总长度][2字节解压后长度][2字节命令][ZLib数据...]
      // 未压缩:   [4字节长度][2字节命令][数据...]

      const totalLen = this.buffer.readUInt32LE(0);
      if (totalLen < 6 || totalLen > 524288) {
        // 无效长度, 尝试跳过1字节重新对齐
        this.buffer = this.buffer.slice(1);
        continue;
      }

      if (this.buffer.length < totalLen) break; // 数据不完整, 等待

      const packet = this.buffer.slice(0, totalLen);
      this.buffer = this.buffer.slice(totalLen);

      try {
        const cmd = packet.readUInt16LE(4); // 命令码

        // 登录响应 (cmd=0x0001)
        if (cmd === 0x0001) {
          this._notifyStatus("logged_in", {});
          continue;
        }

        // 行情数据 (cmd=0x0002 或 0x0003)
        if (cmd === 0x0002 || cmd === 0x0003) {
          const dataPart = packet.slice(6);

          // 尝试ZLib解压
          try {
            const decompressed = zlib.inflateSync(dataPart);
            this._parseDecompressed(decompressed);
          } catch (e) {
            // 未压缩, 直接解析
            this._parseUncompressed(dataPart);
          }
        }
      } catch (e) {
        // 解析失败, 继续处理下一个包
      }
    }

    // 防止缓冲区无限增长
    if (this.buffer.length > 524288) {
      this.buffer = this.buffer.slice(-65536);
    }
  }

  _parseDecompressed(data) {
    let offset = 0;
    // 解压后的数据包含多个股票行情记录
    // 每条记录: [6字节代码(ascii)] [8字节名称(GBK)] [4字节*N 价位]

    while (offset + 20 < data.length) {
      const code = data.toString("ascii", offset, offset + 6).trim();
      offset += 6;
      if (!/^\d{6}$/.test(code)) break;

      // 名称 (GBK编码, 最多8字节)
      let nameEnd = -1;
      for (let i = 0; i < 8 && offset + i < data.length; i++) {
        if (data[offset + i] === 0) { nameEnd = i; break; }
      }
      if (nameEnd < 0) nameEnd = Math.min(8, data.length - offset);
      const name = data.toString("gbk", offset, offset + nameEnd).trim();
      offset += 8;

      if (offset + 20 > data.length) break;

      // 价位字段 (TDX内部以分或特殊编码存储)
      const open = this._readPrice(data, offset);
      const preClose = this._readPrice(data, offset + 4);
      const price = this._readPrice(data, offset + 8);
      const high = this._readPrice(data, offset + 12);
      const low = this._readPrice(data, offset + 16);
      offset += 20;

      // 成交量和成交额
      let volume = 0, amount = 0;
      if (offset + 8 <= data.length) {
        volume = data.readUInt32LE(offset);
        amount = data.readFloatLE(offset + 4);
        offset += 8;
      }

      if (price > 0 && price < 100000 && code.length === 6) {
        const quote = {
          code, name,
          open, preClose, price, high, low,
          volume, amount: +amount.toFixed(0),
          change: preClose ? +((price - preClose) / preClose * 100).toFixed(2) : 0,
          changeAmount: preClose ? +(price - preClose).toFixed(2) : 0,
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          source: "tdx_tcp",
        };
        for (const cb of this.quoteCallbacks) {
          try { cb(quote); } catch (e) {}
        }
      }
    }
  }

  _parseUncompressed(data) {
    // 未压缩格式: 以分隔符分割的文本行情
    const text = data.toString("ascii").trim();
    const lines = text.split(/[\r\n]+/).filter(Boolean);

    for (const line of lines) {
      const fields = line.split(/[,|]/);
      if (fields.length < 6) continue;

      const code = fields[0].trim();
      if (!/^\d{6}$/.test(code)) continue;

      try {
        const price = parseFloat(fields[1]);
        const preClose = parseFloat(fields[2]) || price;
        const open = parseFloat(fields[3]) || price;
        const high = parseFloat(fields[4]) || price;
        const low = parseFloat(fields[5]) || price;

        if (!price || price <= 0 || price > 100000) continue;

        const quote = {
          code, name: "",
          open, preClose, price, high, low,
          volume: parseInt(fields[6]) || 0,
          amount: parseFloat(fields[7]) || 0,
          change: preClose ? +((price - preClose) / preClose * 100).toFixed(2) : 0,
          changeAmount: preClose ? +(price - preClose).toFixed(2) : 0,
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          source: "tdx_tcp",
        };

        for (const cb of this.quoteCallbacks) {
          try { cb(quote); } catch (e) {}
        }
      } catch (e) {}
    }
  }

  _readPrice(buf, offset) {
    // TDX价格编码: 整数 = 价格 * 100
    const raw = buf.readUInt32LE(offset);
    // 处理可能的溢出和异常值
    if (raw > 10000000) {
      // 可能是float编码
      const floatVal = buf.readFloatLE(offset);
      if (floatVal > 0 && floatVal < 100000) return +floatVal.toFixed(2);
    }
    return +(raw / 100).toFixed(2);
  }

  // ====== 重连逻辑 ======

  _scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.serverIndex = (this.serverIndex + 1) % TDX_SERVERS.length;
    this.reconnectAttempts++;

    // 指数退避: 1s, 2s, 4s, 8s, ..., max 30s
    const delay = Math.min(
      1000 * Math.pow(2, Math.min(this.reconnectAttempts - 1, 5)),
      this.maxReconnectDelay
    );

    this._notifyStatus("reconnecting", {
      server: TDX_SERVERS[this.serverIndex],
      attempt: this.reconnectAttempts,
      delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected) this.connect();
    }, delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.connected) {
        try {
          // 空包作为keep-alive
          const ping = Buffer.alloc(6);
          ping.writeUInt32LE(6, 0);       // 总长度=6
          ping.writeUInt16LE(0x0000, 4);  // 心跳命令
          this.socket.write(ping);
        } catch (e) {}
      }
    }, 12000);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _resubscribe() {
    if (this.subscribedCodes.size > 0) {
      this._sendSubscribe([...this.subscribedCodes]);
    }
  }

  _cleanup() {
    this._stopHeartbeat();
    if (this.socket) {
      try { this.socket.destroy(); } catch (e) {}
      this.socket = null;
    }
  }

  _notifyStatus(status, detail) {
    for (const cb of this.statusCallbacks) {
      try { cb({ status, ...detail, timestamp: Date.now() }); } catch (e) {}
    }
  }
}

// ============ 单例 ============
let clientInstance = null;

function getTDXTCPClient() {
  if (!clientInstance) clientInstance = new TDXTCPClient();
  return clientInstance;
}

function connectTDXServer(host, port) {
  const client = getTDXTCPClient();
  client.connect(host, port);
  return client;
}

module.exports = { TDXTCPClient, getTDXTCPClient, connectTDXServer };
