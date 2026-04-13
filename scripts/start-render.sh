#!/bin/bash

# Start-render.sh
# Startup script for Whoofy on Render Free Tier with Optimized Internal Postgres

# Ensure logs are redirected to stdout for Render logging
exec > >(tee -a /app/storage/startup.log) 2>&1

echo "🚀 Starting Whoofy Services (Optimized for 512MB RAM)..."
echo "📅 Date: $(date)"
echo "🔌 Target Port: ${PORT:-10000}"
echo "🌐 Hostname: ${HOSTNAME:-0.0.0.0}"

# --- 1. PostgreSQL Setup (Internal & Ephemeral) ---
echo "🐘 Setting up Lean Ephemeral PostgreSQL..."

DB_DIR="/app/postgres_data"
DB_USER="whoofy"
DB_NAME="whoofy"
DB_PASS="whoofy"
export DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"

PG_BIN=$(find /usr/lib/postgresql/ -name bin -type d | head -n 1)
if [ -z "$PG_BIN" ]; then echo "❌ Error: PostgreSQL binaries not found!"; exit 1; fi

if [ ! -f "$DB_DIR/PG_VERSION" ]; then
    echo "📦 Initializing PostgreSQL cluster..."
    mkdir -p "$DB_DIR" && chmod 700 "$DB_DIR"
    $PG_BIN/initdb -D "$DB_DIR"
fi

echo "🔌 Starting PostgreSQL server (Ultra-Lean Mode)..."
$PG_BIN/pg_ctl -D "$DB_DIR" -l "$DB_DIR/logfile" -o "-c listen_addresses='' -c shared_buffers=16MB -c max_connections=5 -c work_mem=1MB -c temp_buffers=1MB" start

for i in {1..15}; do
    if $PG_BIN/pg_isready -h localhost; then echo "✅ PostgreSQL is ready."; break; fi
    echo "⏳ Waiting for PostgreSQL ($i)..."; sleep 2
done

$PG_BIN/psql -d postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS' SUPERUSER;" || echo "User exists."
$PG_BIN/psql -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" || echo "DB exists."

# --- 2. Database Schema Sync ---
echo "🗄️  Syncing Prisma schema..."
npx prisma db push --skip-generate || echo "❌ Prisma sync failed."

# --- 3. ML Service Setup ---
# We wait for Postgres to settle before starting ML
echo "🧪 Starting ML Service..."
/opt/venv/bin/uvicorn ml.app:app --host 0.0.0.0 --port 8000 --workers 1 --limit-concurrency 5 &
ML_PID=$!
echo "✅ ML Service PID: $ML_PID"

# Give ML service a few seconds to start before Next.js hits its main RAM usage
sleep 5

# --- 4. Web Application Setup ---
echo "🌐 Starting Next.js Web Application..."
export ML_SERVICE_URL=${ML_SERVICE_URL:-"http://localhost:8000"}

# AGGRESSIVE RAM LIMIT FOR NODE
# 512MB total - (Postgres ~32MB) - (FastAPI ~100MB) = ~380MB left for Node
export NODE_OPTIONS="--max-old-space-size=320"

# Explicitly use 0.0.0.0 if HOSTNAME not set
export HOSTNAME=${HOSTNAME:-"0.0.0.0"}

node server.js
