#!/bin/bash

set -e

echo "🚀 Starting Whoofy on Render (SQLite + ML Mode)..."

# --- 1. Database Initialization (SQLite) ---
echo "📂 Initializing SQLite database..."
mkdir -p /app/storage

# Initialize the DB if it doesn't exist or just sync the schema
# We use the flattened schema we generated during build
export DATABASE_URL="file:/app/storage/whoofy.db"

echo "🔄 Syncing database schema..."
# npx prisma db push is lighter than migrate for ephemeral data
npx prisma db push --schema ./prisma/schema.render.prisma --accept-data-loss --skip-generate

# --- 2. Start ML Service (FastAPI / YOLO) ---
echo "🤖 Starting local ML service (YOLO/OCR)..."
cd /app/ml
# Start uvicorn in background
# We use --workers 1 to save RAM
python3 -m uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1 &
ML_PID=$!

# Wait for ML service to be ready
echo "⏳ Waiting for ML service to warm up..."
max_retries=30
count=0
while ! curl -s http://localhost:8000/health > /dev/null; do
    sleep 2
    count=$((count + 1))
    if [ $count -gt $max_retries ]; then
        echo "⚠️ ML service took too long to start, continuing anyway..."
        break
    fi
done
echo "✅ ML service ready."

# --- 3. Start Next.js App ---
echo "🌐 Starting Next.js application..."
cd /app
# Standalone mode: node server.js
# We use the port Render provides (PORT env var)
PORT="${PORT:-3000}"
export PORT=$PORT

# Higher RAM limit for Node since Postgres is gone
export NODE_OPTIONS="--max-old-space-size=400"
export HOSTNAME="0.0.0.0"

exec node server.js
