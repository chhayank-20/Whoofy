#!/bin/bash

# --- Signal Handling ---
term_handler() {
  echo "📥 Termination signal received. Shutting down..."
  kill -SIGTERM "$ML_PID" 2>/dev/null
  kill -SIGTERM "$NODE_PID" 2>/dev/null
  exit 0
}
trap 'term_handler' SIGTERM SIGINT

set -e

echo "🚀 Starting Whoofy on Render (Optimized SQLite + Parallel ML)..."

# --- 1. Database Initialization (SQLite) ---
echo "📂 Initializing SQLite database..."
mkdir -p /app/storage
export DATABASE_URL="file:/app/storage/whoofy.db"

echo "🔄 Syncing database schema..."
# Flatten the schema BEFORE push if it hasn't been done (usually done in CI but safe here)
npx tsx scripts/flatten-schema.ts prisma/schema.prisma prisma/schema.render.prisma
npx prisma db push --schema ./prisma/schema.render.prisma --accept-data-loss --skip-generate

# --- 2. Start ML Service (Background) ---
echo "🤖 Starting ML service (YOLO/OCR) in background..."
cd /app/ml
# We use --workers 1 and --no-access-log to save RAM
python3 -m uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1 &
ML_PID=$!
cd /app

# --- 3. Start Next.js App (Foreground) ---
echo "🌐 Starting Next.js application on port ${PORT:-3000}..."
# We start this immediately so Render's health checks pass
export NODE_OPTIONS="--max-old-space-size=350"
export HOSTNAME="0.0.0.0"

# Note: We use node server.js because it's already built for standalone
node server.js &
NODE_PID=$!

echo "✅ Startup sequence initiated. Monitoring processes..."

# Wait for processes
wait -n

echo "⚠️ A service has exited. Shutting down..."
term_handler
