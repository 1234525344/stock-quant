// PM2 进程管理配置
module.exports = {
  apps: [{
    name: "stock-quant",
    script: "server.js",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    watch: false,
    max_memory_restart: "512M",
    min_uptime: "60s",
    max_restarts: 5,
    restart_delay: 10000,
    env: {
      NODE_ENV: "production",
    },
    // 日志配置
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    error_file: "logs/error.log",
    out_file: "logs/out.log",
    merge_logs: true,
    // 崩溃自动重启
    autorestart: true,
    kill_timeout: 8000,
  }]
};
