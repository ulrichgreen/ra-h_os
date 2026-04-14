import { contextService } from '@/services/database/contextService';
import { nodeService } from '@/services/database/nodes';
import { countHighSignalQueryTermMatches, getHighSignalSearchTerms, scoreNodeSearchMatch } from '@/services/database/searchRanking';
import type { Node } from '@/types/database';

export interface DirectNodeLookupInput {
  search?: string;
  limit?: number;
  context_name?: string;
  contextId?: number;
  createdAfter?: string;
  createdBefore?: string;
  eventAfter?: string;
  eventBefore?: string;
}

export interface DirectNodeLookupResult {
  nodes: Node[];
  count: number;
  filtersApplied: {
    search?: string;
    limit: number;
    context_name?: string;
    createdAfter?: string;
    createdBefore?: string;
    eventAfter?: string;
    eventBefore?: string;
  };
}

function normalizeContextName(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

async function resolveSearchContext(input: DirectNodeLookupInput): Promise<{ contextId?: number; context_name?: string }> {
  const normalizedName = normalizeContextName(input.context_name);
  if (normalizedName) {
    const context = await contextService.getContextByName(normalizedName);
    if (!context) {
      console.warn(`directNodeLookup received unknown context_name "${normalizedName}"; ignoring context filter.`);
      return {};
    }
    return {
      contextId: context.id,
      context_name: context.name,
    };
  }

  if (typeof input.contextId === 'number') {
    const context = await contextService.getContextById(input.contextId);
    if (!context) {
      console.warn(`directNodeLookup received invalid legacy contextId ${input.contextId}; ignoring context filter.`);
      return {};
    }
    return {
      contextId: context.id,
      context_name: context.name,
    };
  }

  return {};
}

function hasStrongAnchorMatch(nodes: Node[], searchTerm: string): boolean {
  if (!searchTerm || nodes.length === 0) return false;
  const highSignalTerms = getHighSignalSearchTerms(searchTerm);
  const requiredMatches = Math.min(2, highSignalTerms.length || 1);
  return nodes.some(node => countHighSignalQueryTermMatches(node, searchTerm) >= requiredMatches);
}

export async function directNodeLookup(input: DirectNodeLookupInput): Promise<DirectNodeLookupResult> {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const searchTerm = input.search?.trim();

  if (searchTerm && /^\d+$/.test(searchTerm)) {
    const nodeId = Number(searchTerm);
    const node = await nodeService.getNodeById(nodeId);
    return {
      nodes: node ? [node] : [],
      count: node ? 1 : 0,
      filtersApplied: {
        search: searchTerm,
        limit,
      },
    };
  }

  const resolvedContext = await resolveSearchContext(input);
  const effectiveFilters = {
    search: searchTerm,
    limit,
    contextId: resolvedContext.contextId,
    searchMode: 'standard' as const,
    createdAfter: input.createdAfter,
    createdBefore: input.createdBefore,
    eventAfter: input.eventAfter,
    eventBefore: input.eventBefore,
  };

  let safeNodes = await nodeService.getNodes(effectiveFilters);

  const hadExtraFilters = Boolean(
    effectiveFilters.contextId !== undefined ||
    effectiveFilters.createdAfter ||
    effectiveFilters.createdBefore ||
    effectiveFilters.eventAfter ||
    effectiveFilters.eventBefore
  );

  if (searchTerm && hadExtraFilters && (safeNodes.length === 0 || !hasStrongAnchorMatch(safeNodes, searchTerm))) {
    console.warn(`directNodeLookup falling back to plain literal search for "${searchTerm}" after filtered lookup missed a strong anchor match.`);
    safeNodes = await nodeService.searchNodes(searchTerm, limit);
  }

  if (searchTerm) {
    safeNodes = safeNodes
      .map(node => ({ node, score: scoreNodeSearchMatch(node, searchTerm) }))
      .sort((a, b) => b.score - a.score || b.node.updated_at.localeCompare(a.node.updated_at))
      .slice(0, limit)
      .map(entry => entry.node);
  } else {
    safeNodes = safeNodes.slice(0, limit);
  }

  return {
    nodes: safeNodes,
    count: safeNodes.length,
    filtersApplied: {
      search: searchTerm,
      limit,
      context_name: resolvedContext.context_name,
      createdAfter: input.createdAfter,
      createdBefore: input.createdBefore,
      eventAfter: input.eventAfter,
      eventBefore: input.eventBefore,
    },
  };
}
