#!/bin/bash

# Use this script to patch the generated Prisma Client types.
# This changes 'string' back to 'any' for fields that were Json/Array originally.

TARGET="node_modules/.prisma/client/index.d.ts"

if [ ! -f "$TARGET" ]; then
  echo "⚠️  Prisma client definitions not found at $TARGET"
  exit 0
fi

echo "🩹 Patching Prisma Client types for SQLite compatibility..."

# List of fields that were originally Json or Array
FIELDS=("objects" "labels" "brands" "people" "textDetections" "logos" "visualSimilarity" "uniqueObjects" "brandsDetected" "targetBrandConfirmation" "visualSentiment" "visualSimilaritySummary" "captionSentiment" "transcriptSentiment" "languages" "regions" "comments" "brandMentions" "niches" "overallIssues" "commentAnalysis" "engagementAnalysis" "platforms" "niche" "interests" "categories" "requirements")

for field in "${FIELDS[@]}"; do
  # Use perl for better cross-platform support with -i
  # We replace both 'field: string' and 'field: string | null' or any other string variation
  perl -i -pe "s/\b$field: string(\b| |\|)/$field: any /g" "$TARGET"
done

echo "✅ Patching complete."
