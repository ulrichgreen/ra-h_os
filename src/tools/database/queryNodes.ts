import { tool } from 'ai';
import { z } from 'zod';
import { nodeService } from '@/services/database/nodes';
import { formatNodeForChat } from '../infrastructure/nodeFormatter';
import type { Node } from '@/types/database';
import { scoreNodeSearchMatch } from '@/services/database/searchRanking';

type QueryNodeFilters = {
  dimensions?: string[];
  search?: string;
  limit?: number;
  createdAfter?: string;
  createdBefore?: string;
  eventAfter?: string;
  eventBefore?: string;
};

export const queryNodesTool = tool({
  description: 'Search nodes across title, description, and source. For free-text lookups, search the graph broadly and prioritize title/description matches. Do not use dimensions to constrain keyword search unless the user is explicitly asking about a known dimension.',
  inputSchema: z.object({
    filters: z.object({
      dimensions: z.array(z.string()).describe('Filter by dimensions (e.g., ["research", "ai", "technology"]). Replaces old type/stage filtering.').optional(),
      search: z.string().describe('Search term to match against node title, description, or source').optional(),
      limit: z.number().min(1).max(50).default(10).describe('Maximum number of results to return'),
      createdAfter: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes created on or after this date.'),
      createdBefore: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes created before this date.'),
      eventAfter: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes with event_date on or after this date.'),
      eventBefore: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes with event_date before this date.'),
    }).optional()
  }),
  execute: async ({ filters = {} }: { filters?: QueryNodeFilters }) => {
    console.log('🔍 QueryNodes tool called with filters:', JSON.stringify(filters, null, 2));
    try {
      const limit = filters.limit || 10;

      const searchTerm = filters.search?.trim();
      if (searchTerm && /^\d+$/.test(searchTerm)) {
        const nodeId = Number(searchTerm);
        const node = await nodeService.getNodeById(nodeId);
        if (!node) {
          return {
            success: true,
            data: {
              nodes: [],
              count: 0,
              filters_applied: filters,
            },
            message: `Found 0 nodes matching id ${nodeId}`,
          };
        }

        const formatted = formatNodeForChat({
          id: node.id,
          title: node.title,
          dimensions: node.dimensions || [],
        });

        return {
          success: true,
          data: {
            nodes: [{
              id: node.id,
              title: node.title,
              dimensions: node.dimensions || [],
              created_at: node.created_at,
              updated_at: node.updated_at,
              event_date: node.event_date ?? null,
              formatted_display: formatted,
            }],
            count: 1,
            filters_applied: filters,
          },
          message: `Found 1 node matching id ${nodeId}:\n${formatted}`,
        };
      }

      const runQuery = async (queryFilters: typeof filters): Promise<Node[]> => {
        const timeoutPromise: Promise<Node[] | undefined> = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('QueryNodes timeout after 10 seconds')), 10000);
        });

        const nodesPromise: Promise<Node[] | undefined> = nodeService.getNodes({
          limit,
          dimensions: queryFilters.dimensions,
          search: queryFilters.search,
          searchMode: searchTerm ? 'hybrid' : 'standard',
          createdAfter: queryFilters.createdAfter,
          createdBefore: queryFilters.createdBefore,
          eventAfter: queryFilters.eventAfter,
          eventBefore: queryFilters.eventBefore,
        });

        const nodes = await Promise.race<Node[] | undefined>([nodesPromise, timeoutPromise]);
        return Array.isArray(nodes) ? nodes : [];
      };

      const effectiveFilters = searchTerm
        ? { ...filters, dimensions: undefined }
        : { ...filters };

      let safeNodes = await runQuery(effectiveFilters);

      if (searchTerm) {
        safeNodes = safeNodes
          .map(node => ({ node, score: scoreNodeSearchMatch(node, searchTerm) }))
          .sort((a, b) => b.score - a.score || b.node.updated_at.localeCompare(a.node.updated_at))
          .slice(0, limit)
          .map(entry => entry.node);
      }

      const limitedNodes = safeNodes.slice(0, limit);

      // Format nodes for chat display
      const formattedNodes = limitedNodes.map(node => {
        const formatted = formatNodeForChat({
          id: node.id,
          title: node.title,
          dimensions: node.dimensions || []
        });
        return {
          id: node.id,
          title: node.title,
          dimensions: node.dimensions || [],
          created_at: node.created_at,
          updated_at: node.updated_at,
          event_date: node.event_date ?? null,
          formatted_display: formatted
        };
      });

      // Create message with formatted node labels only (no full node payload)
      const formattedLabels = formattedNodes.map(node => node.formatted_display).join(', ');
      const message = `Found ${safeNodes.length} nodes${effectiveFilters.dimensions ? ` with dimensions: ${effectiveFilters.dimensions.join(', ')}` : ''}${effectiveFilters.search ? ` matching: "${effectiveFilters.search}"` : ''}${formattedLabels ? `:\n${formattedLabels}` : ''}`;

      return {
        success: true,
        data: {
          nodes: formattedNodes,
          count: safeNodes.length,
          filters_applied: effectiveFilters
        },
        message: message
      };
    } catch (error) {
      console.error('QueryNodes tool error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to query nodes',
        data: {
          nodes: [],
          count: 0,
          filters_applied: filters
        }
      };
    }
  }
});

// Legacy export for backwards compatibility
export const queryItemsTool = queryNodesTool;
