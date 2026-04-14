import fs from 'fs';
import path from 'path';

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.log('Usage: tsx flatten-schema.ts <input> <output>');
  process.exit(1);
}

console.log(`🌐 Flattening Prisma schema: ${inputPath} -> ${outputPath}`);

let schema = fs.readFileSync(inputPath, 'utf8');

// 1. Change datasource to SQLite
schema = schema.replace(/provider *= *"postgresql"/, 'provider = "sqlite"');
schema = schema.replace(/previewFeatures *= *\["multiSchema"\]/, '');
schema = schema.replace(/schemas *= *\[.*?\]/, '');

// Normalize @default(now) -> @default(now()) (some schemas omit the parens)
schema = schema.replace(/@default\(now\)/g, '@default(now())');
// Normalize @default(dbgenerated()) -> remove (unsupported in SQLite context)
schema = schema.replace(/@default\(dbgenerated\(.*?\)\)/g, '');


// 2. Remove all @@schema attributes
schema = schema.replace(/@@schema\(.*?\)/g, '');

// 3. Extract enum names then remove all enum blocks
//    (Prisma SQLite does not support enums)
const enumNames: string[] = [];
for (const match of schema.matchAll(/enum (\w+) \{[\s\S]*?\}/g)) {
  enumNames.push(match[1]);
}
console.log(`🔡 Found enums: ${enumNames.join(', ')}`);
schema = schema.replace(/enum \w+ \{[\s\S]*?\}/g, '');

// 4. Process line-by-line transformations
const flattenedFields: string[] = [];

const processedLines = schema.split('\n').map(line => {
  let processed = line;

  // 4a. Convert all Enum types to String (both scalar and array)
  for (const enumName of enumNames) {
    // Match: <space>EnumName<optional []><space|?|end>
    const enumRegex = new RegExp(`(\\s)${enumName}(\\[\\])?(\\s|\\?|$)`, 'g');
    processed = processed.replace(enumRegex, (match, p1, arr, p3) => {
      if (arr) flattenedFields.push(line.match(/^\s+(\w+)\s+/)?.[1] ?? '');
      return `${p1}String${p3}`;
    });
  }

  // 4b. Convert Decimal to Float and strip precision args like (10, 2)
  //     Also track the field name so the type patcher converts it to 'any'
  const decimalMatch = processed.match(/^\s+(\w+)\s+Decimal/);
  if (decimalMatch) flattenedFields.push(decimalMatch[1]);
  processed = processed.replace(/\sDecimal(\s|\?|$|@)/g, m => m.replace('Decimal', 'Float'));
  if (processed.includes('Float')) {
    processed = processed.replace(/\(\d+,\s*\d+\)/g, '');
  }


  // 4c. Convert scalar String[], Int[], Float[], Boolean[], DateTime[] to String
  //     Skip lines with @relation (those are relation arrays, keep them)
  const scalarArrayMatch = processed.match(/^\s+(\w+)\s+(String|Int|Float|Boolean|DateTime)\[\]/);
  if (scalarArrayMatch && !processed.includes('@relation')) {
    flattenedFields.push(scalarArrayMatch[1]);
    processed = processed.replace(`${scalarArrayMatch[2]}[]`, 'String');
  }

  // 4d. Convert Json fields to String
  //     Match: <whitespace>fieldName   Json  (with optional ? and @default)
  const jsonMatch = processed.match(/^\s+(\w+)\s+Json(\?|\s|$)/);
  if (jsonMatch) {
    flattenedFields.push(jsonMatch[1]);
    processed = processed.replace(/\bJson\b/, 'String');
  }

  // 4e. Strip PostgreSQL-specific attributes
  processed = processed.replace(/@db\.[A-Za-z]+(\(\d+(,\s*\d+)?\))?/g, '');
  processed = processed.replace(/map:\s*".*?"/g, '');
  processed = processed.replace(/@@map\(.*?\)/g, '');
  // Strip @@index and @@unique lines entirely (not just the content)
  // We blank the whole line to avoid trailing commas
  if (/^\s*@@index\s*\(/.test(processed) || /^\s*@@unique\s*\(/.test(processed)) {
    return '';
  }

  // 4f. Fix @default([]) -> @default("") for now-String fields
  processed = processed.replace(/@default\(\[\]\)/g, '@default("")');

  // 4g. Fix enum-valued @default(SOME_VALUE) -> @default("SOME_VALUE")
  //     but skip prisma-special functions: now, uuid, autoincrement, cuid, etc.
  const prismaFns = new Set(['now', 'uuid', 'autoincrement', 'cuid', 'true', 'false', 'dbgenerated', '""', '[]', '{}']);
  processed = processed.replace(/@default\(([A-Za-z][A-Za-z0-9_]*)\)/g, (match, val) => {
    if (prismaFns.has(val.toLowerCase())) return match;
    return `@default("${val}")`;
  });

  return processed;
});

let finalSchema = processedLines.join('\n');

// 5. Global cleanup
// Remove trailing commas inside attribute parentheses left by map: stripping
// e.g. @relation(..., onDelete: Cascade, ) -> @relation(..., onDelete: Cascade)
finalSchema = finalSchema.replace(/,\s*\)/g, ')');

// Remove empty/repeated blank lines
finalSchema = finalSchema.replace(/\n{3,}/g, '\n\n');



// 6. Write the flattened field list as a comment on the FIRST line of the output
//    This is read by patch-prisma-types.sh to know which fields to patch
const uniqueFlattened = [...new Set(flattenedFields.filter(f => f.length > 0))];
console.log(`📋 Flattened ${uniqueFlattened.length} fields: ${uniqueFlattened.join(', ')}`);
const header = `// @@flattened:${uniqueFlattened.join(',')}\n`;

fs.writeFileSync(outputPath, header + finalSchema);
console.log('✅ Flattened schema generated.');
