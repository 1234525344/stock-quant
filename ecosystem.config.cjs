module.exports = {
  apps: [
    {
      name: 'quant-server',
      script: 'server.js',
      cwd: 'C:/Users/lb/stock-quant',
      env: {
        NODE_ENV: 'production',
      },
      // Auto-restart on crash with exponential backoff
      autorestart: true,
      max_restarts: 100,
      min_uptime: '10s',
      max_memory_restart: '500M',
      restart_delay: 5000,
      // Logging
      error_file: 'C:/Users/lb/stock-quant/logs/server-error.log',
      out_file: 'C:/Users/lb/stock-quant/logs/server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Windows
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
    {
      name: 'quant-tunnel',
      script: 'tunnel-manager.js',
      cwd: 'C:/Users/lb/stock-quant',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 10000,
      error_file: 'C:/Users/lb/stock-quant/logs/tunnel-error.log',
      out_file: 'C:/Users/lb/stock-quant/logs/tunnel-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      kill_timeout: 5000,
    },
    {
      name: 'quant-monitor',
      script: 'monitor.js',
      cwd: 'C:/Users/lb/stock-quant',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_restarts: 100,
      restart_delay: 5000,
      error_file: 'C:/Users/lb/stock-quant/logs/monitor-error.log',
      out_file: 'C:/Users/lb/stock-quant/logs/monitor-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
