/**
 * Node metadata embedding service for RA-H knowledge management system
 * Embeds node metadata (title, content, dimensions, AI analysis) into nodes.embedding field
 */

import OpenAI from 'openai';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { 
  createDatabaseConnection, 
  getDbVectorCapability,
  serializeFloat32Vector,
  formatEmbeddingText,
  batchProcess 
} from './sqlite-vec';
import type { VectorCapability } from '@/services/database/sqlite-runtime';

interface NodeRecord {
  id: number;
  title: string;
  source: string | null;
  notes: string | null;
  description: string | null;
  dimensions_json: string;
  embedding?: Buffer | null;
  embedding_updated_at?: string | null;
  embedding_text?: string | null;
}

interface EmbedNodeOptions {
  nodeId?: number;
  forceReEmbed?: boolean;
  verbose?: boolean;
}

export class NodeEmbedder {
  private openaiClient: OpenAI;
  private openaiProvider: ReturnType<typeof createOpenAI>;
  private db: ReturnType<typeof createDatabaseConnection>;
  private readonly vectorCapability: VectorCapability;
  private processedCount: number = 0;
  private failedCount: number = 0;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    
    this.openaiClient = new OpenAI({ apiKey });
    this.openaiProvider = createOpenAI({ apiKey });
    this.db = createDatabaseConnection();
    this.vectorCapability = getDbVectorCapability(this.db);
  }

  /**
   * Analyze node content with AI to extract insights
   */
  private async analyzeNodeWithAI(node: NodeRecord): Promise<string> {
    const dimensions = node.dimensions_json ? JSON.parse(node.dimensions_json) : [];
    const dimensionsText = Array.isArray(dimensions) && dimensions.length ? dimensions.join(', ') : 'none';
    
    const prompt = `Analyze this content and provide 2-3 key insights or themes in a concise paragraph (max 100 words):

Title: ${node.title}
Source: ${node.source || node.notes || 'No source'}
Dimensions: ${dimensionsText}

Focus on the main concepts, key relationships, and practical implications.`;

    try {
      const { text } = await generateText({
        model: this.openaiProvider('gpt-4o-mini'),
        prompt,
        maxOutputTokens: 150,
        temperature: 0.3,
      });

      return text;
    } catch (error) {
      console.error(`AI analysis failed for node ${node.id}:`, error);
      return '';
    }
  }

  /**
   * Generate embedding for text using OpenAI
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openaiClient.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    
    return response.data[0].embedding;
  }

  /**
   * Embed a single node
   */
  private async embedNode(node: NodeRecord, forceReEmbed: boolean = false): Promise<void> {
    // Skip if already embedded and not forcing
    if (node.embedding && !forceReEmbed) {
      console.log(`Skipping node ${node.id} - already has embedding`);
      return;
    }

    // Parse dimensions from JSON string
    const dimensions = node.dimensions_json ? JSON.parse(node.dimensions_json) : [];
    
    // Create base embedding text
    let embeddingText = formatEmbeddingText(
      node.title,
      node.source || node.notes || '',
      dimensions,
      node.description
    );

    // Add AI analysis if source exists
    const sourceText = node.source || node.notes || '';
    if (sourceText.trim().length > 0) {
      const analysis = await this.analyzeNodeWithAI(node);
      if (analysis) {
        embeddingText += `\n\nAI Analysis: ${analysis}`;
      }
    }

    try {
      // Generate embedding
      const embedding = await this.generateEmbedding(embeddingText);
      const embeddingBlob = serializeFloat32Vector(embedding);
      
      // Update database
      const updateStmt = this.db.prepare(`
        UPDATE nodes 
        SET embedding = ?, 
            embedding_updated_at = ?, 
            embedding_text = ?
        WHERE id = ?
      `);
      
      const now = new Date().toISOString();
      updateStmt.run(embeddingBlob, now, embeddingText, node.id);
      
      if (this.vectorCapability.available) {
        try {
          const pkCol = 'node_id';
          const deleteStmt = this.db.prepare(`DELETE FROM vec_nodes WHERE ${pkCol} = ?`);
          deleteStmt.run(BigInt(node.id));

          const vectorString = `[${embedding.join(',')}]`;
          const insertStmt = this.db.prepare(`INSERT INTO vec_nodes (${pkCol}, embedding) VALUES (?, ?)`);
          insertStmt.run(BigInt(node.id), vectorString);
        } catch (vecError) {
          console.warn(`Could not update vec_nodes for node ${node.id}:`, vecError);
        }
      }
      
      this.processedCount++;
      console.log(`✓ Embedded node ${node.id}: "${node.title}"`);
      
    } catch (error) {
      this.failedCount++;
      console.error(`✗ Failed to embed node ${node.id}:`, error);
      throw error;
    }
  }

  /**
   * Embed nodes based on options
   */
  async embedNodes(options: EmbedNodeOptions = {}): Promise<{ processed: number; failed: number }> {
    const { nodeId, forceReEmbed = false, verbose = false } = options;
    
    let query: string;
    let params: any[] = [];
    
    if (nodeId) {
      // Single node
        query = `
        SELECT n.id, n.title, n.source, n.notes, n.description,
               COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                        FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json,
               n.embedding, n.embedding_updated_at
        FROM nodes n
        WHERE n.id = ?
      `;
      params = [nodeId];
    } else if (forceReEmbed) {
      // All nodes
      query = `
        SELECT n.id, n.title, n.source, n.notes, n.description,
               COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                        FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json,
               n.embedding, n.embedding_updated_at
        FROM nodes n
        ORDER BY n.id
      `;
    } else {
      // Only nodes without embeddings
      query = `
        SELECT n.id, n.title, n.source, n.notes, n.description,
               COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                        FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json,
               n.embedding, n.embedding_updated_at
        FROM nodes n
        WHERE n.embedding IS NULL OR n.embedding_updated_at IS NULL
        ORDER BY n.id
      `;
    }
    
    const stmt = this.db.prepare(query);
    const nodes = stmt.all(...params) as NodeRecord[];
    
    if (nodes.length === 0) {
      console.log('No nodes to process');
      return { processed: 0, failed: 0 };
    }
    
    console.log(`Processing ${nodes.length} nodes...`);
    
    // Process in batches
    await batchProcess(
      nodes,
      async (node) => {
        try {
          await this.embedNode(node, forceReEmbed);
        } catch (error) {
          // Error already logged in embedNode
        }
      },
      5, // Batch size
      verbose ? (processed, total) => {
        console.log(`Progress: ${processed}/${total} nodes`);
      } : undefined
    );
    
    console.log(`\nComplete! Processed: ${this.processedCount}, Failed: ${this.failedCount}`);
    
    return {
      processed: this.processedCount,
      failed: this.failedCount
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

/**
 * CLI interface for direct execution
 */
export async function runCLI(args: string[]): Promise<void> {
  const nodeId = args.includes('--node-id') 
    ? parseInt(args[args.indexOf('--node-id') + 1])
    : undefined;
  
  const forceReEmbed = args.includes('--force');
  const verbose = args.includes('--verbose');
  
  const embedder = new NodeEmbedder();
  
  try {
    await embedder.embedNodes({ nodeId, forceReEmbed, verbose });
  } finally {
    embedder.close();
  }
}

// Run if called directly (for testing)
if (require.main === module) {
  runCLI(process.argv.slice(2)).catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}
