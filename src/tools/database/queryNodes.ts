import { tool } from 'ai';
import { z } from 'zod';
import { contextService } from '@/services/database';
import { nodeService } from '@/services/database/nodes';
import { formatNodeForChat } from '../infrastructure/nodeFormatter';
import type { Node } from '@/types/database';
import { countHighSignalQueryTermMatches, getHighSignalSearchTerms, scoreNodeSearchMatch } from '@/services/database/searchRanking';

type QueryNodeFilters = {
  contextId?: number;
  search?: string;
  limit?: number;
  createdAfter?: string;
  createdBefore?: string;
  eventAfter?: string;
  eventBefore?: string;
};

export const queryNodesTool = tool({
  description: 'Find specific existing nodes in the graph by searching title, description, and source. Use this first when the user is trying to locate a node they already created or a specific existing podcast, article, idea, person, project, or note. For broader current-turn grounding of a substantive question, use retrieveQueryContext instead. Leave contextId unset unless you know an actual context-table ID; never pass a hub node ID or arbitrary node ID as contextId.',
  inputSchema: z.object({
    filters: z.object({
      contextId: z.number().int().positive().describe('Optional primary context filter.').optional(),
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
        });

        return {
          success: true,
          data: {
            nodes: [{
              id: node.id,
              title: node.title,
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
          contextId: queryFilters.contextId,
          search: queryFilters.search,
          // Keep queryNodes literal-first. retrieveQueryContext is the broader semantic path.
          searchMode: 'standard',
          createdAfter: queryFilters.createdAfter,
          createdBefore: queryFilters.createdBefore,
          eventAfter: queryFilters.eventAfter,
          eventBefore: queryFilters.eventBefore,
        });

        const nodes = await Promise.race<Node[] | undefined>([nodesPromise, timeoutPromise]);
        return Array.isArray(nodes) ? nodes : [];
      };

      const effectiveFilters = { ...filters };
      if (effectiveFilters.contextId !== undefined) {
        const context = await contextService.getContextById(effectiveFilters.contextId);
        if (!context) {
          console.warn(`queryNodes received invalid contextId ${effectiveFilters.contextId}; ignoring context filter.`);
          delete effectiveFilters.contextId;
        }
      }

      let safeNodes = await runQuery(effectiveFilters);

      const hadExtraFilters = Boolean(
        effectiveFilters.contextId !== undefined ||
        effectiveFilters.createdAfter ||
        effectiveFilters.createdBefore ||
        effectiveFilters.eventAfter ||
        effectiveFilters.eventBefore
      );

      const hasStrongAnchorMatch = (nodes: Node[]): boolean => {
        if (!searchTerm || nodes.length === 0) return false;
        const highSignalTerms = getHighSignalSearchTerms(searchTerm);
        const requiredMatches = Math.min(2, highSignalTerms.length || 1);
        return nodes.some(node => countHighSignalQueryTermMatches(node, searchTerm) >= requiredMatches);
      };

      // Match the nav search behavior when the model overconstrains a direct lookup.
      // This prevents notes from disappearing behind synthetic date filters or weak filtered matches.
      if (searchTerm && hadExtraFilters && (safeNodes.length === 0 || !hasStrongAnchorMatch(safeNodes))) {
        console.warn(`queryNodes falling back to plain literal search for "${searchTerm}" after filtered lookup failed to return a strong anchor match.`);
        safeNodes = await nodeService.searchNodes(searchTerm, limit);
      }

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
        });
        return {
          id: node.id,
          title: node.title,
          created_at: node.created_at,
          updated_at: node.updated_at,
          event_date: node.event_date ?? null,
          formatted_display: formatted
        };
      });

      // Create message with formatted node labels only (no full node payload)
      const formattedLabels = formattedNodes.map(node => node.formatted_display).join(', ');
      const message = `Found ${safeNodes.length} nodes${effectiveFilters.search ? ` matching: "${effectiveFilters.search}"` : ''}${formattedLabels ? `:\n${formattedLabels}` : ''}`;

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
