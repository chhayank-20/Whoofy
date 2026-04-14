import { PrismaClient } from '@prisma/client';
import logger from '@/utils/logger';

/**
 * Prisma Client Singleton with SQLite JSON Transparency Extension
 */
const basePrisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
});

/**
 * Helper to recursively parse JSON strings in objects
 */
function parseJsonFields(data: any): any {
  if (!data || typeof data !== 'object') return data;
  
  if (Array.isArray(data)) {
    return data.map(parseJsonFields);
  }

  const result = { ...data };
  for (const key in result) {
    const value = result[key];
    
    // Dynamic JSON detection for SQLite strings
    if (typeof value === 'string' && value.length > 1) {
      if ((value.startsWith('[') && value.endsWith(']')) || 
          (value.startsWith('{') && value.endsWith('}'))) {
        try {
          result[key] = JSON.parse(value);
        } catch (e) {
          // Fallback to original value if parsing fails
          // (e.g. if it's just a string that happens to start with [)
        }
      }
    } else if (value && typeof value === 'object') {
      result[key] = parseJsonFields(value);
    }
  }
  return result;
}

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);
        
        // Only parse results in SQLite mode
        if (process.env.DATABASE_URL?.startsWith('file:')) {
          return parseJsonFields(result);
        }
        
        return result;
      },
    },
  },
});

const globalForPrisma = globalThis as unknown as {
  prisma: typeof prisma | undefined;
};

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Connect to database
 */
export async function connectDatabase(): Promise<void> {
  try {
    // basePrisma is used for the connection lifecycle
    await basePrisma.$connect();
    logger.info('✅ Database connected successfully');
  } catch (error) {
    logger.error({ error }, '❌ Database connection failed');
    throw error;
  }
}

/**
 * Disconnect from database
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await basePrisma.$disconnect();
    logger.info('✅ Database disconnected');
  } catch (error) {
    logger.error({ error }, '❌ Database disconnection failed');
    throw error;
  }
}

/**
 * Health check for database
 */
export async function checkDatabaseHealth(): Promise<'up' | 'down'> {
  try {
    await basePrisma.$queryRaw`SELECT 1`;
    return 'up';
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    return 'down';
  }
}

export default prisma;
