#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 读取 .env（若存在）中的端口配置，保持与 vite/后端一致，避免端口硬编码
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env"
  set +a
fi
FRONTEND_PORT="${VITE_PORT:-5173}"
BACKEND_PORT="${PORT:-3001}"

echo "==> Cleaning up old development server processes..."

# Kill processes on frontend port (Vite)
lsof -ti :$FRONTEND_PORT 2>/dev/null | xargs kill -9 2>/dev/null && echo "    Killed process on port $FRONTEND_PORT" || true

# Kill processes on backend port (Express)
lsof -ti :$BACKEND_PORT 2>/dev/null | xargs kill -9 2>/dev/null && echo "    Killed process on port $BACKEND_PORT" || true

# Kill any leftover nodemon / tsx processes for this project
pkill -f "nodemon.*$PROJECT_DIR" 2>/dev/null && echo "    Killed nodemon processes" || true
pkill -f "tsx.*api/server" 2>/dev/null && echo "    Killed tsx server processes" || true

echo "==> Starting development server (pnpm)..."
cd "$PROJECT_DIR"
pnpm dev