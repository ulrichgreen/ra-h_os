import OpenAI from 'openai';
import { getPreferredOpenAiKey } from './storage/openaiKeyServer';

function getOpenAiClient(): OpenAI {
  const apiKey = getPreferredOpenAiKey();
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Add OPENAI_API_KEY to your .env.local file.');
  }
  return new OpenAI({ apiKey });
}

export class EmbeddingService {
  /**
   * Generate embedding for a search query using OpenAI's text-embedding-3-small model
   * This matches the same model used in embed_universal.py for consistency
   */
  static async generateQueryEmbedding(query: string): Promise<number[]> {
    try {
      const openai = getOpenAiClient();
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: query.trim(),
        encoding_format: "float"
      });

      if (!response.data?.[0]?.embedding) {
        throw new Error('No embedding returned from OpenAI API');
      }

      return response.data[0].embedding;
    } catch (error) {
      console.error('Failed to generate query embedding:', error);
      throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate embedding dimensions match expected size (1536 for text-embedding-3-small)
   */
  static validateEmbedding(embedding: number[]): boolean {
    return Array.isArray(embedding) && embedding.length === 1536;
  }
}
