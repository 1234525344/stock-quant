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
    max_restarts: 10,
    restart_delay: 5000,
    // 优雅关闭
    kill_timeout: 5000,
  }]
};
