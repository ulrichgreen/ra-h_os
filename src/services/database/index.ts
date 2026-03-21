// Service instances
export { nodeService, NodeService } from './nodes';
export { chunkService, ChunkService } from './chunks';
export { edgeService, EdgeService } from './edges';
export { dimensionService, DimensionService } from './dimensionService';
// export { HelperService } from './helpers'; // Removed - migrated to JSON-based service

// Types
export * from '@/types/database';

// Health check utility
export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  vectorExtension: boolean;
  tablesExist: boolean;
  error?: string;
}> {
  try {
    return checkSQLiteDatabaseHealth();
  } catch (error) {
    return {
      connected: false,
      vectorExtension: false,
      tablesExist: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function checkSQLiteDatabaseHealth(): Promise<{
  connected: boolean;
  vectorExtension: boolean;
  tablesExist: boolean;
  error?: string;
}> {
  try {
    const { getSQLiteClient } = await import('./sqlite-client');
    const sqlite = getSQLiteClient();
    
    const connected = await sqlite.testConnection();
    const vectorCapability = sqlite.getVectorCapability();
    if (!connected) {
      return {
        connected: false,
        vectorExtension: false,
        tablesExist: false,
        error: 'SQLite connection failed'
      };
    }

    const vectorExtension = vectorCapability.available;
    
    // Check if main tables exist
    const tables = await sqlite.checkTables();
    const requiredTables = ['nodes', 'chunks', 'edges'];
    const tablesExist = requiredTables.every(table => tables.includes(table));

    return {
      connected,
      vectorExtension,
      tablesExist
    };
  } catch (error) {
    return {
      connected: false,
      vectorExtension: false,
      tablesExist: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
