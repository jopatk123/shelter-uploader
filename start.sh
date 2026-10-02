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

# --- 固定 Node.js 22 ---
# better-sqlite3 11.x 的原生模块只支持 Node 22（NODE_MODULE_VERSION 127）。
# 若用更高版本 node 运行会报 ERR_DLOPEN_FAILED，这里优先切换到本机已安装的 Node 22。
NODE22_CANDIDATES=(
  "$HOME/.nvm/versions/node"/v22*/bin
  /opt/homebrew/opt/node@22/bin
  /usr/local/opt/node@22/bin
)
for candidate in "${NODE22_CANDIDATES[@]}"; do
  if [ -x "$candidate/node" ]; then
    export PATH="$candidate:$PATH"
    break
  fi
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo unknown)"
if [ "$NODE_MAJOR" != "22" ]; then
  echo "错误：需要 Node.js 22，当前为 $(node -v 2>/dev/null || echo '未安装 Node.js')。" >&2
  echo "better-sqlite3 11.x 的原生模块不支持其它大版本，请先安装 Node 22（brew install node@22 或 nvm install 22）。" >&2
  exit 1
fi
echo "==> Using $(node -v)"

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