#!/bin/bash

# Whoofy Startup Script
# This script starts all services: Next.js app, ML service, Redis, and DB.

set -e

# --- Configuration & Environment ---

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create a .env file based on .env.docker.example or .env.example."
    exit 1
fi

# Load .env (simplified)
# Note: This doesn't handle all shell special chars but works for basic k=v
export $(grep -v '^#' .env | xargs)

# --- Dependency Checks ---

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed or not in PATH."
    exit 1
fi

# Check for Node.js (needed for Prisma and Scheduler)
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed."
    exit 1
fi

# --- Database & Setup ---

echo "🚀 Starting core services (DB, Redis, ML)..."
docker compose up -d db redis ml

# Wait for DB to be ready
echo "⏳ Waiting for Database to be ready..."
# Simple wait loop
until docker compose exec db pg_isready -U ${POSTGRES_USER:-postgres} &>/dev/null; do
  sleep 1
done
echo "✅ Database is ready."

# Generate Prisma Client
echo "📦 Generating Prisma Client..."
npm run db:generate

# Run Migrations (if needed)
# Since we might be using a fresh db container, we ensure tables exist
echo "🗄️  Setting up database tables..."
# Using the existing script if available, or just standard prisma push
if [ -f scripts/setup-supabase.ts ]; then
    # If using local db, we might need a different approach than setup-supabase
    # but for local db, prisma db push is usually enough for dev
    npx prisma db push --skip-generate
else
    npx prisma db push --skip-generate
fi

# --- Web Application ---

echo "🌐 Starting Web Application (Dockerized)..."
docker compose up -d web

# --- View Tracking Scheduler ---

echo "🕒 Starting View Tracking Scheduler (Local Process)..."
# We run it in the background and redirect output to a log file
npm run scheduler:view-tracking > scheduler.log 2>&1 &
SCHEDULER_PID=$!

echo "---------------------------------------------------"
echo "🎉 Whoofy is now running!"
echo "---------------------------------------------------"
echo "🖥️  Web App: http://localhost:3000"
echo "🧪 ML Service: http://localhost:8000 (Internal usage)"
echo "📊 Scheduler PID: $SCHEDULER_PID (Logging to scheduler.log)"
echo ""
echo "To see application logs, run:"
echo "  docker compose logs -f web"
echo ""
echo "To stop everything, run:"
echo "  docker compose down"
echo "  kill $SCHEDULER_PID"
echo "---------------------------------------------------"
