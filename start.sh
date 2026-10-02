#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_PORT=5173
BACKEND_PORT=3001

echo "==> Cleaning up old development server processes..."

# Kill processes on frontend port (Vite)
lsof -ti :$FRONTEND_PORT 2>/dev/null | xargs kill -9 2>/dev/null && echo "    Killed process on port $FRONTEND_PORT" || true

# Kill processes on backend port (Express)
lsof -ti :$BACKEND_PORT 2>/dev/null | xargs kill -9 2>/dev/null && echo "    Killed process on port $BACKEND_PORT" || true

# Kill any leftover nodemon / tsx processes for this project
pkill -f "nodemon.*$PROJECT_DIR" 2>/dev/null && echo "    Killed nodemon processes" || true
pkill -f "tsx.*api/server" 2>/dev/null && echo "    Killed tsx server processes" || true

echo "==> Starting development server..."
cd "$PROJECT_DIR"
npm run dev
