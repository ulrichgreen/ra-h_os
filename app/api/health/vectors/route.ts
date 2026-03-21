import { NextResponse } from 'next/server';
import { getSQLiteClient } from '@/services/database/sqlite-client';
import { chunkService } from '@/services/database/chunks';

export async function GET() {
  try {
    const sqlite = getSQLiteClient();
    const vectorCapability = sqlite.getVectorCapability();
    
    // Test basic database connection
    const connectionTest = await sqlite.testConnection();
    if (!connectionTest) {
      return NextResponse.json({
        status: 'error',
        message: 'Database connection failed',
        details: null
      });
    }

    // Check if vector extension is loaded
    const vectorExtensionTest = await sqlite.checkVectorExtension();
    let vectorStats = null;
    let chunkStats = null;
    let vectorHealth = vectorCapability.available ? 'healthy' : 'unavailable';

    try {
      const totalChunks = await chunkService.getChunkCount();
      chunkStats = {
        total_chunks: totalChunks,
        vectorized_chunks: null,
        missing_embeddings: null,
        coverage_percentage: null,
      };

      if (vectorCapability.available && vectorExtensionTest) {
        try {
          const chunksWithoutEmbeddings = await chunkService.getChunksWithoutEmbeddings();
          const vectorizedCount = totalChunks - chunksWithoutEmbeddings.length;
          const result = sqlite.query('SELECT COUNT(*) as count FROM vec_chunks');
          const vecCount = Number(result.rows[0].count);

          chunkStats = {
            total_chunks: totalChunks,
            vectorized_chunks: vectorizedCount,
            missing_embeddings: chunksWithoutEmbeddings.length,
            coverage_percentage: totalChunks > 0 ? Math.round((vectorizedCount / totalChunks) * 100) : 0
          };

          vectorStats = {
            vec_chunks_count: vecCount,
            matches_chunk_embeddings: vecCount === vectorizedCount
          };
          
          vectorHealth = vecCount === vectorizedCount ? 'healthy' : 'inconsistent';
        } catch (vecError: any) {
          vectorHealth = 'corrupted';
          vectorStats = {
            error: vecError.message,
            suggestion: 'Vector table may be corrupted and need recreation'
          };
        }
      } else {
        vectorHealth = 'unavailable';
        vectorStats = {
          backend: vectorCapability.backend,
          extension_path: vectorCapability.extensionPath,
          reason: vectorCapability.available ? null : vectorCapability.reason,
        };
      }

    } catch (error: any) {
      return NextResponse.json({
        status: 'error',
        message: 'Failed to collect vector statistics',
        details: error.message
      });
    }

    return NextResponse.json({
      status: 'success',
      data: {
        database_connected: connectionTest,
        vector_extension_loaded: vectorExtensionTest,
        vector_capability: vectorCapability,
        vector_health: vectorHealth,
        chunk_stats: chunkStats,
        vector_stats: vectorStats,
        recommendations: generateRecommendations(vectorHealth, chunkStats, vectorStats)
      }
    });

  } catch (error: any) {
    console.error('Vector health check failed:', error);
    return NextResponse.json({
      status: 'error',
      message: 'Health check failed',
      details: error.message
    });
  }
}

function generateRecommendations(
  vectorHealth: string, 
  chunkStats: any, 
  vectorStats: any
): string[] {
  const recommendations: string[] = [];

  if (vectorHealth === 'corrupted') {
    recommendations.push('Vector tables are corrupted - restart the application to trigger automatic healing');
  }

  if (vectorHealth === 'unavailable') {
    recommendations.push('Semantic/vector search is unavailable. Install sqlite-vec for your platform or switch to Qdrant.');
  }

  if (chunkStats && typeof chunkStats.coverage_percentage === 'number' && chunkStats.coverage_percentage < 95) {
    recommendations.push(`${chunkStats.missing_embeddings} chunks missing embeddings - consider running embedding generation`);
  }

  if (vectorStats && !vectorStats.matches_chunk_embeddings) {
    recommendations.push('Vector count does not match chunk embeddings - database inconsistency detected');
  }

  if (recommendations.length === 0) {
    recommendations.push('Vector search system is healthy');
  }

  return recommendations;
}
