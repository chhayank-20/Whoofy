#!/bin/bash

# convert-prisma-to-sqlite.sh
# Transforms a multi-schema PostgreSQL Prisma file into a single-schema SQLite file.

INPUT_FILE=$1
OUTPUT_FILE=$2

if [ -z "$INPUT_FILE" ] || [ -z "$OUTPUT_FILE" ]; then
    echo "Usage: $0 <input_prisma_file> <output_prisma_file>"
    exit 1
fi

echo "🔄 Converting $INPUT_FILE to SQLite format..."

# 1. Change provider and remove multi-schema features
sed -e 's/provider = "postgresql"/provider = "sqlite"/' \
    -e '/previewFeatures = \["multiSchema"\]/d' \
    -e '/schemas  = \["aimodule", "public"\]/d' \
    "$INPUT_FILE" > "$OUTPUT_FILE.tmp"

# 2. Remove all @@schema attributes
sed -i.bak '/@@schema/d' "$OUTPUT_FILE.tmp"

# 3. Remove schema references in the datasource block if they exist
# (Already handled by the multi-line sed if exact match, but let's be safe)
sed -i.bak '/schemas *=/d' "$OUTPUT_FILE.tmp"

# 4. Convert Postgres specific Decimal to standard Float for SQLite
# Example: Decimal(12, 2) -> Float
sed -i.bak 's/Decimal/Float/g' "$OUTPUT_FILE.tmp"
sed -i.bak 's/@db.Decimal([^)]*)//g' "$OUTPUT_FILE.tmp"

# 5. Handle Enums - SQLite doesn't support enums natively. 
# Prisma emulates them, but we need to remove the @@schema from enums too.
# (Already handled by the global @@schema delete)

mv "$OUTPUT_FILE.tmp" "$OUTPUT_FILE"
rm -f "$OUTPUT_FILE.tmp.bak"

echo "✅ Conversion complete: $OUTPUT_FILE"
