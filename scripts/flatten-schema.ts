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

// 2. Remove all @@schema attributes
schema = schema.replace(/@@schema\(.*?\)/g, '');

// 3. Remove multi-line enum blocks (SQLite/Prisma doesn't support them)
// We capture them first to replace their types later
const enumMatches = schema.matchAll(/enum (\w+) \{([\s\S]*?)\}/g);
const enumNames: string[] = [];
for (const match of enumMatches) {
  enumNames.push(match[1]);
}

console.log(`🔡 Found enums: ${enumNames.join(', ')}`);

// Clear enum blocks
schema = schema.replace(/enum \w+ \{[\s\S]*?\}/g, '');

// 4. Transform field types
const lines = schema.split('\n');
const processedLines = lines.map(line => {
  let processed = line;

  // Convert Enum types to String
  for (const enumName of enumNames) {
    const enumRegex = new RegExp(`(\\s)${enumName}(\\s|\\?|\\[\\]|$)`, 'g');
    if (enumRegex.test(processed)) {
      processed = processed.replace(enumRegex, (match, p1, p2) => {
        if (match.includes('[]')) return `${p1}String${p2}`;
        return `${p1}String${p2}`;
      });
    }
  }

  // Convert Decimal to Float and remove precision like (12, 2)
  processed = processed.replace(/\sDecimal(\s|\?|$|@)/g, (match) => match.replace('Decimal', 'Float'));
  // Strip (12, 2) or (3, 2) that might be left on the same line
  if (processed.includes('Float')) {
    processed = processed.replace(/\(\d+,\s*\d+\)/g, '');
  }
  
  // Strip PostgreSQL-specific multi-column unique/index constraints 
  // but KEEP individual field @unique
  processed = processed.replace(/@@unique\(\[.*?\]\)/g, '');
  processed = processed.replace(/@@index\(\[.*?\]\)/g, '');
  
  // Convert SCALAR arrays only (Type[]) to String
  // Relation arrays (Model[]) should remain arrays
  // We identify scalar arrays by checking if the type is a known scalar or an Enum
  const lines = processed.split('\n');
  const flattenedFields: string[] = [];
  
  const processedLines = lines.map(line => {
    // Match: fieldName Type[] or fieldName Type[] @default(...)
    const arrayMatch = line.match(/^\s+(\w+)\s+(\w+)\[\]/);
    if (arrayMatch) {
      const fieldName = arrayMatch[1];
      const typeName = arrayMatch[2];
      
      // If it's NOT a relation (we'll check against known model names or manually skip if it's capitalized)
      // Actually, in this project, relations are Model[] and scalars/enums are also Capitalized or Enum[]
      // The best way is to check if it has @relation - if NOT, it's likely a scalar/enum array.
      if (!line.includes('@relation')) {
        flattenedFields.push(fieldName);
        return line.replace(`${typeName}[]`, 'String');
      }
    }
    return line;
  });
  processed = processedLines.join('\n');

  // Convert Json to String
  const jsonLines = processed.split('\n');
  const processedJsonLines = jsonLines.map(line => {
    // Match: fieldName Json or fieldName Json?
    const jsonMatch = line.match(/^\s+(\w+)\s+Json/);
    if (jsonMatch) {
      flattenedFields.push(jsonMatch[1]);
      return line.replace('Json', 'String');
    }
    return line;
  });
  processed = processedJsonLines.join('\n');
  
  // Handle defaults for converted types
  processed = processed.replace(/@default\(\[\]\)/g, '@default("")');
  
  // Save a list of flattened fields for the patcher (as a comment at top)
  const flattenedList = Array.from(new Set(flattenedFields)).join(',');
  processed = `// @@flattened:${flattenedList}\n` + processed;
  
  processed = processed.replace(/@db\.[A-Za-z]+/g, '');
  processed = processed.replace(/map: *".*?"/g, '');
  processed = processed.replace(/@@map\(.*?\)/g, ''); // Strip model mapping

  // Strip all @@index and @@unique (except primary keys) to avoid collisions in flattened schema
  if (processed.includes('@@index') || processed.includes('@@unique')) {
    processed = ''; // Delete the line if it represents a complex index/unique that might collide
  }

  // NEW: Clean up trailing commas left by previous removals (e.g., [field], )
  // We do this globally on the full schema later for multi-line cases, but let's try line-by-line first
  processed = processed.replace(/,[[:space:]]*\)/g, ')');
  // Clean up empty parentheses
  processed = processed.replace(/\([[:space:]]*\)/g, '');

  // 6. Fix default values for converted strings
  // @default(APPLIED) -> @default("APPLIED")
  if (processed.includes('@default(')) {
    processed = processed.replace(/@default\(([A-Za-z][A-Za-z0-9_]*)\)/g, (match, p1) => {
      // Don't quote special prisma functions or booleans
      if (['now', 'uuid', 'autoincrement', 'true', 'false', 'dbgenerated'].includes(p1.toLowerCase())) {
        return match;
      }
      return `@default("${p1}")`;
    });
  }

  return processed;
});

let finalSchema = processedLines.join('\n');

// 7. FINAL GLOBAL CLEANUP (Multi-line safe)
// Targeted: Remove trailing commas in attributes like @relation(...) or @@index(...)
finalSchema = finalSchema.replace(/(@+[a-zA-Z]+)\(([\s\S]*?),(\s*)\)/g, '$1($2$3)');
// Clean up empty parentheses ONLY if they were left inside an attribute (rare)
// but let's just NOT do a global parenthesis cleanup to be safe for now()

// Clean up double empty lines
finalSchema = finalSchema.replace(/\n\s*\n\s*\n/g, '\n\n');

// Debug a known problematic index area
const debugStart = finalSchema.indexOf('@@index([createdAt]');
if (debugStart !== -1) {
  console.log('--- DEBUG INDEX AREA ---');
  console.log(finalSchema.substring(debugStart, debugStart + 200));
  console.log('------------------------');
}

fs.writeFileSync(outputPath, finalSchema);
console.log('✅ Flattened schema generated.');
