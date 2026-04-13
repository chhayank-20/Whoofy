#!/bin/bash

# Start-render.sh
# Startup script for Whoofy on Render Free Tier with Optimized Internal Postgres

echo "🚀 Starting Whoofy Services (Optimized for 512MB RAM)..."

# --- 1. PostgreSQL Setup (Internal & Ephemeral) ---
echo "🐘 Setting up Lean Ephemeral PostgreSQL..."

# Config
DB_DIR="/app/postgres_data"
DB_USER="whoofy"
DB_NAME="whoofy"
DB_PASS="whoofy"
export DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"

# Detect Postgres binary directory
PG_BIN=$(find /usr/lib/postgresql/ -name bin -type d | head -n 1)
if [ -z "$PG_BIN" ]; then
    echo "❌ Error: PostgreSQL binaries not found!"
    exit 1
fi

# Initialize DB if not already initialized
if [ ! -f "$DB_DIR/PG_VERSION" ]; then
    echo "📦 Initializing PostgreSQL cluster..."
    mkdir -p "$DB_DIR"
    chmod 700 "$DB_DIR"
    $PG_BIN/initdb -D "$DB_DIR"
fi

# Start PostgreSQL with Ultra-Lean settings
echo "🔌 Starting PostgreSQL server (Lean Mode)..."
# Settings: 
# - shared_buffers=16MB (Minimum recommended)
# - max_connections=10 (Low to save memory)
# - work_mem=1MB (Minimal per-session memory)
$PG_BIN/pg_ctl -D "$DB_DIR" -l "$DB_DIR/logfile" -o "-c listen_addresses='' -c shared_buffers=16MB -c max_connections=10 -c work_mem=1MB -c temp_buffers=2MB" start

# Wait for Postgres to be ready
for i in {1..10}; do
    if $PG_BIN/pg_isready -h localhost; then
        echo "✅ PostgreSQL is ready."
        break
    fi
    echo "⏳ Waiting for PostgreSQL..."
    sleep 1
done

# Create User and DB (if they don't exist)
echo "👤 Configuring internal DB user and schema..."
$PG_BIN/psql -d postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS' SUPERUSER;" || echo "User config skip"
$PG_BIN/psql -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" || echo "DB config skip"

# --- 2. Database Schema Sync ---
echo "🗄️  Syncing Prisma schema..."
# We use --skip-generate because we already generated in build phase
npx prisma db push --skip-generate

# --- 3. ML Service Setup ---
echo "🧪 Starting ML Service (1 worker to save RAM)..."
# Force single worker and limited memory if possible via uvicorn
uvicorn ml.app:app --host 0.0.0.0 --port 8000 --workers 1 --limit-concurrency 10 &
ML_PID=$!

sleep 2

# --- 4. Web Application Setup ---
echo "🌐 Starting Next.js Web Application..."
export ML_SERVICE_URL=${ML_SERVICE_URL:-"http://localhost:8000"}
# Start node
node server.js
