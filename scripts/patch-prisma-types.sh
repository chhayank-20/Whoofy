#!/bin/bash

# Use this script to patch the generated Prisma Client types.
# This version reads fields from the generated @flattened list.

SCHEMA="prisma/schema.render.prisma"
TARGET="node_modules/.prisma/client/index.d.ts"

if [ ! -f "$TARGET" ]; then
  echo "⚠️  Prisma client definitions not found at $TARGET"
  exit 0
fi

if [ ! -f "$SCHEMA" ]; then
  echo "⚠️  Schema not found at $SCHEMA"
  exit 0
fi

echo "🩹 Patching Prisma Client types for SQLite compatibility..."

# Extract the flattened list from the first line of the schema
FLATTENED_LIST=$(head -n 1 "$SCHEMA" | grep "@@flattened" | cut -d: -f2)

if [ -z "$FLATTENED_LIST" ]; then
    echo "⚠️  No flattened fields found in $SCHEMA header."
    exit 0
fi

echo "📋 Processing fields: $FLATTENED_LIST"

IFS=',' read -ra ADDR <<< "$FLATTENED_LIST"
for field in "${ADDR[@]}"; do
  # Replace 'field: string' or 'field: string | null' or any other string variation
  # we use a very aggressive regex to catch all occurrences (scalars, input types, etc.)
  # using perl -i for cross-platform -i support
  perl -i -pe "s/\b$field: string(\b| |\|)/$field: any /g" "$TARGET"
done

echo "✅ Patching complete."
