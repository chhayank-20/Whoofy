#!/bin/bash

# Start-render.sh
# Startup script for Whoofy on Render Free Tier (SQLite + ML Edition)

# Ensure logs are redirected
exec > >(tee -a /app/storage/startup.log) 2>&1

echo "🚀 Starting Whoofy Services (SQLite + Local ML Mode)..."
echo "📅 Date: $(date)"

# --- 1. SQLite Database Setup ---
echo "🗄️  Setting up SQLite Database..."
mkdir -p /app/storage
export DATABASE_URL="file:/app/storage/whoofy.db"

# Sync schema to SQLite file
# Use the render-specific schema we built in the Dockerfile
npx prisma db push --schema prisma/schema.render.prisma --skip-generate --accept-data-loss || echo "⚠️ Prisma sync warning (check logs)."

# --- 2. ML Service Setup (YOLO/OCR) ---
echo "🧠 Starting Local ML Service (YOLO/OCR)..."
# Now that Postgres is gone, we have the RAM for this.
/opt/venv/bin/uvicorn ml.app:app --host 0.0.0.0 --port 8000 --workers 1 --limit-concurrency 2 &
ML_PID=$!
echo "✅ ML Service PID: $ML_PID"

sleep 3

# --- 3. Web Application Setup ---
echo "🌐 Starting Next.js Web Application..."
export ML_SERVICE_URL=${ML_SERVICE_URL:-"http://localhost:8000"}

# Higher RAM limit for Node since Postgres is gone
export NODE_OPTIONS="--max-old-space-size=400"
export HOSTNAME="0.0.0.0"

node server.js
