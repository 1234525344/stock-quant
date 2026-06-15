FROM node:22-slim

# sql.js 依赖 (better-sqlite3 用)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# 数据持久化目录
RUN mkdir -p /app/data /app/logs

ENV PORT=3456
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3456

CMD ["node", "server.js"]
