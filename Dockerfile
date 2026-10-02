# 多阶段构建：前端 build + 后端运行
# 项目使用 Node 22（与 @types/node ^22 / better-sqlite3 ^11 对齐）
FROM node:22-slim AS builder

WORKDIR /app

# 配置 pnpm（固定 v10，避免 v11 强制 deps status check 拦截构建）
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

# 安装依赖（利用缓存）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --config.minimumReleaseAge=0

# 复制源码并构建前端
COPY . .
RUN pnpm run build

# ============ 运行阶段 ============
FROM node:22-slim

WORKDIR /app

# 安装生产依赖与运行时
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

# 安装生产依赖
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile --config.minimumReleaseAge=0

# 复制构建产物和后端代码
COPY --from=builder /app/dist ./dist
COPY api ./api
COPY tsconfig.json ./

# 创建数据目录
RUN mkdir -p /app/data/storage /app/data/temp_chunk

EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 启动命令
CMD ["./node_modules/.bin/tsx", "api/server.ts"]
