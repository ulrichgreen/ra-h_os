import { tool } from 'ai';
import { z } from 'zod';
import { contextService } from '@/services/database/contextService';

type QueryContextFilters = {
  id?: number;
  name?: string;
  search?: string;
  limit?: number;
  includeNodes?: boolean;
};

function matchesSearch(value: string | null | undefined, search: string): boolean {
  if (!value) return false;
  return value.toLowerCase().includes(search);
}

export const queryContextsTool = tool({
  description: 'List and inspect contexts. Use this to discover available primary scopes before filtering nodes or assigning node context.',
  inputSchema: z.object({
    filters: z.object({
      id: z.number().int().positive().describe('Exact context ID lookup.').optional(),
      name: z.string().describe('Exact context name lookup.').optional(),
      search: z.string().describe('Case-insensitive search across context names and descriptions.').optional(),
      limit: z.number().min(1).max(100).default(50).describe('Maximum number of contexts to return.').optional(),
      includeNodes: z.boolean().default(false).describe('Include the node list for an exact single-context lookup.').optional(),
    }).optional(),
  }),
  execute: async ({ filters = {} }: { filters?: QueryContextFilters }) => {
    try {
      const limit = filters.limit || 50;
      const normalizedName = filters.name?.trim();
      const normalizedSearch = filters.search?.trim().toLowerCase();

      let contexts = await contextService.listContexts();

      if (filters.id !== undefined) {
        contexts = contexts.filter((context) => context.id === filters.id);
      }

      if (normalizedName) {
        contexts = contexts.filter((context) => context.name.toLowerCase() === normalizedName.toLowerCase());
      }

      if (normalizedSearch) {
        contexts = contexts.filter((context) =>
          matchesSearch(context.name, normalizedSearch) ||
          matchesSearch(context.description, normalizedSearch)
        );
      }

      const limitedContexts = contexts.slice(0, limit);
      const canIncludeNodes =
        filters.includeNodes === true &&
        limitedContexts.length === 1 &&
        (filters.id !== undefined || Boolean(normalizedName));

      const contextsWithNodes = await Promise.all(
        limitedContexts.map(async (context) => {
          if (!canIncludeNodes) return context;

          const nodes = await contextService.getNodesForContext(context.id);
          return {
            ...context,
            nodes: nodes.map((node) => ({
              id: node.id,
              title: node.title,
              description: node.description ?? null,
              context_id: node.context_id ?? null,
              context: node.context ?? null,
              updated_at: node.updated_at,
            })),
          };
        })
      );

      const message = contextsWithNodes.length === 0
        ? 'No contexts found.'
        : `Found ${contextsWithNodes.length} context${contextsWithNodes.length === 1 ? '' : 's'}:\n${contextsWithNodes.map((context) => `• ${context.name} (#${context.id}, ${context.count} nodes)`).join('\n')}`;

      return {
        success: true,
        data: {
          contexts: contextsWithNodes,
          count: contextsWithNodes.length,
          total_available: contexts.length,
          filters_applied: filters,
        },
        message,
      };
    } catch (error) {
      console.error('QueryContexts tool error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to query contexts',
        data: {
          contexts: [],
          count: 0,
          filters_applied: filters,
        },
      };
    }
  },
});
