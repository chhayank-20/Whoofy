#!/bin/bash

# Whoofy Render Startup Script
# Runs: SQLite schema push → ML service (background) → Next.js (foreground)

# --- Signal Handling ---
term_handler() {
  echo "📥 Termination signal received. Shutting down..."
  [ -n "$ML_PID" ] && kill -SIGTERM "$ML_PID" 2>/dev/null
  [ -n "$NODE_PID" ] && kill -SIGTERM "$NODE_PID" 2>/dev/null
  wait
  exit 0
}
trap 'term_handler' SIGTERM SIGINT

echo "🚀 Starting Whoofy on Render..."
echo "   Node: $(node --version 2>/dev/null || echo 'not found')"
echo "   Python: $(python3 --version 2>/dev/null || echo 'not found')"
echo "   Working dir: $(pwd)"
echo "   Files: $(ls /app/)"

# --- 1. Database Initialization ---
echo ""
echo "📂 Initializing SQLite database..."
mkdir -p /app/storage
export DATABASE_URL="file:/app/storage/whoofy.db"

# schema.render.prisma was generated during the Docker build.
# Use the prisma binary from node_modules (part of standalone output)
PRISMA_BIN="$(find /app/node_modules -name 'prisma' -type f -executable 2>/dev/null | head -1)"

if [ -z "$PRISMA_BIN" ]; then
  # Fallback: try npx (might work if node is in PATH with global npx)
  PRISMA_BIN="npx prisma"
fi

echo "🔄 Pushing database schema to SQLite..."
echo "   Using prisma: $PRISMA_BIN"

$PRISMA_BIN db push \
  --schema /app/prisma/schema.render.prisma \
  --accept-data-loss \
  --skip-generate || echo "⚠️ DB push failed — continuing with existing DB if any"

echo "✅ Database step complete."

# --- 2. Start ML Service in background ---
echo ""
echo "🤖 Starting ML service (YOLO/OCR)..."
cd /app/ml
python3 -m uvicorn app:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --no-access-log &
ML_PID=$!
cd /app
echo "   ML service PID: $ML_PID"

# --- 3. Start Next.js (standalone server) ---
echo ""
echo "🌐 Starting Next.js on port ${PORT:-3000}..."
export NODE_OPTIONS="--max-old-space-size=350"
export HOSTNAME="0.0.0.0"
export PORT="${PORT:-3000}"

# Next.js standalone: server.js is at root of the standalone output
# which was copied to /app/ in the Dockerfile
node /app/server.js &
NODE_PID=$!
echo "   Next.js PID: $NODE_PID"

echo ""
echo "✅ All services started. Container will stay alive until Next.js exits."

# Keep container alive — only exit if Next.js dies
wait $NODE_PID
EXIT_CODE=$?
echo "⚠️ Next.js exited with code $EXIT_CODE"
term_handler
