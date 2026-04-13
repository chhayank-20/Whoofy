#!/bin/bash

# Start-render.sh
# Startup script for Whoofy on Render Free Tier with Optimized Internal Postgres

# Ensure logs are redirected to stdout for Render logging
exec > >(tee -a /app/storage/startup.log) 2>&1

echo "🚀 Starting Whoofy Services (Optimized for 512MB RAM)..."
echo "📅 Date: $(date)"
echo "🔌 Target Port: ${PORT:-10000}"

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
    echo "📦 Initializing PostgreSQL cluster at $DB_DIR..."
    mkdir -p "$DB_DIR"
    chmod 700 "$DB_DIR"
    $PG_BIN/initdb -D "$DB_DIR"
fi

# Start PostgreSQL with Ultra-Lean settings
echo "🔌 Starting PostgreSQL server (Lean Mode)..."
$PG_BIN/pg_ctl -D "$DB_DIR" -l "$DB_DIR/logfile" -o "-c listen_addresses='' -c shared_buffers=16MB -c max_connections=10 -c work_mem=1MB -c temp_buffers=2MB" start

# Wait for Postgres to be ready
for i in {1..15}; do
    if $PG_BIN/pg_isready -h localhost; then
        echo "✅ PostgreSQL is ready."
        break
    fi
    echo "⏳ Waiting for PostgreSQL ($i)..."
    sleep 2
done

# Create User and DB (if they don't exist)
echo "👤 Configuring internal DB user and schema..."
$PG_BIN/psql -d postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS' SUPERUSER;" || echo "User already exists."
$PG_BIN/psql -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" || echo "Database already exists."

# --- 2. Database Schema Sync ---
echo "🗄️  Syncing Prisma schema..."
npx prisma db push --skip-generate || echo "❌ Prisma sync failed, continuing..."

# --- 3. ML Service Setup ---
echo "🧪 Starting ML Service..."
# Use path to venv explicitly to be safe
/opt/venv/bin/uvicorn ml.app:app --host 0.0.0.0 --port 8000 --workers 1 --limit-concurrency 5 &
ML_PID=$!

echo "✅ ML Service PID: $ML_PID"

# --- 4. Web Application Setup ---
echo "🌐 Starting Next.js Web Application on port ${PORT:-10000}..."
export ML_SERVICE_URL=${ML_SERVICE_URL:-"http://localhost:8000"}

# Note: standalone server.js automatically listens on process.env.PORT
# If Render provides PORT=10000, it will use that.
node server.js
