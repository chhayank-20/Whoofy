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
# SQLite doesn't support @db.Decimal or @db.Float with precision
sed -i.bak 's/Decimal/Float/g' "$OUTPUT_FILE.tmp"
sed -i.bak 's/@db\.[A-Za-z]*([^)]*)//g' "$OUTPUT_FILE.tmp"
sed -i.bak 's/@db\.[A-Za-z]*//g' "$OUTPUT_FILE.tmp"

# 5. Handle Enums - SQLite doesn't support enums in Prisma.
# Conversion:
# a) Find all enum names
# b) Replace their usage with String
# c) Remove the enum blocks

echo "🔡 Converting enums to Strings for SQLite compatibility..."
ENUM_NAMES=$(grep "^enum " "$OUTPUT_FILE.tmp" | awk '{print $2}')

for ENUM in $ENUM_NAMES; do
    echo "  - $ENUM"
    # Replace the type with String. We look for the enum name followed by a newline or space
    # and ensures it's a field definition (index 2 in prisma format)
    sed -i.bak "s/[[:space:]]$ENUM[[:space:]]*$/ String/g" "$OUTPUT_FILE.tmp"
    sed -i.bak "s/[[:space:]]$ENUM[[:space:]]*@/ String @/g" "$OUTPUT_FILE.tmp"
    # Also handle array types like Platform[]
    sed -i.bak "s/[[:space:]]$ENUM\[\]/ String\[\]/g" "$OUTPUT_FILE.tmp"
done

# Now remove the enum blocks themselves
perl -i -0777 -pe 's/enum \w+ \{.*?\}//gs' "$OUTPUT_FILE.tmp"

# 6. Quote non-function defaults for String fields
# Example: @default(Pending) -> @default("Pending")
# We look for @default(SOMETHING) where SOMETHING doesn't end with ()
sed -i.bak 's/@default(\([A-Za-z][A-Za-z0-9_]*\))/@default("\1")/g' "$OUTPUT_FILE.tmp"
# But we must NOT quote true/false
sed -i.bak 's/@default("true")/@default(true)/g' "$OUTPUT_FILE.tmp"
sed -i.bak 's/@default("false")/@default(false)/g' "$OUTPUT_FILE.tmp"

mv "$OUTPUT_FILE.tmp" "$OUTPUT_FILE"
rm -f "$OUTPUT_FILE.tmp.bak"

echo "✅ Conversion complete: $OUTPUT_FILE"
