#!/bin/bash
# Whoofy Runtime Startup Script for Render
# Order: SQLite db push → ML service (background) → Next.js (foreground)
# The container exits only if Next.js dies.

set -uo pipefail

# --- Graceful shutdown ---
ML_PID=""
NODE_PID=""

term_handler() {
  echo "📥 Received shutdown signal..."
  [ -n "$ML_PID" ] && kill -SIGTERM "$ML_PID" 2>/dev/null || true
  [ -n "$NODE_PID" ] && kill -SIGTERM "$NODE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap term_handler SIGTERM SIGINT

# --- Diagnostics ---
echo "========================================"
echo "🚀 Whoofy starting on Render Free Tier"
echo "   Date:    $(date)"
echo "   Node:    $(node --version 2>/dev/null)"
echo "   Python:  $(python3 --version 2>/dev/null)"
echo "   Port:    ${PORT:-3000}"
echo "   App dir: $(ls /app/ | tr '\n' ' ')"
echo "========================================"

# --- 1. SQLite Database Setup ---
echo ""
echo "📂 Setting up SQLite database..."
mkdir -p /app/storage
export DATABASE_URL="file:/app/storage/whoofy.db"

echo "🔄 Running db push with Render SQLite schema..."

# Use the extracted Prisma CLI at /app/prisma-cli/prisma
NODE_PATH="/app/prisma-cli/node_modules" \
  node /app/prisma-cli/node_modules/prisma/build/index.js \
  db push \
  --schema /app/prisma/schema.render.prisma \
  --accept-data-loss \
  --skip-generate 2>&1 || {
    echo "⚠️  db push failed — if DB file already exists this may be OK"
  }

echo "✅ DB step complete."

# --- 2. Start ML Service (background) ---
echo ""
echo "🤖 Starting ML service (YOLO/OCR/CLIP) on port 8000..."
cd /app/ml
python3 -m uvicorn app:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --no-access-log 2>&1 &
ML_PID=$!
cd /app
echo "   ML PID: $ML_PID"

# --- 3. Start Next.js (foreground via background + wait) ---
echo ""
echo "🌐 Starting Next.js on port ${PORT:-3000}..."
export NODE_OPTIONS="--max-old-space-size=350"
export HOSTNAME="0.0.0.0"
export PORT="${PORT:-3000}"

# server.js is placed at /app/server.js by the COPY --from=node_builder /app/.next/standalone /app/
node /app/server.js 2>&1 &
NODE_PID=$!
echo "   Next.js PID: $NODE_PID"

echo ""
echo "✅ Services launched. Waiting for Next.js (PID $NODE_PID)..."

# Container lives as long as Next.js lives
wait "$NODE_PID"
EXIT_CODE=$?
echo "⚠️  Next.js exited with code $EXIT_CODE — shutting down..."
term_handler
