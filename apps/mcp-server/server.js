/**
 * RA-H MCP Server
 *
 * Exposes a minimal HTTP-based Model Context Protocol endpoint that lets external
 * assistants read/write the local RA-H SQLite graph by calling our existing API routes.
 * Designed to run locally (packaged with the desktop app) and never exposes data
 * beyond 127.0.0.1.
 */

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { URL } = require('node:url');

const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { McpError, ErrorCode } = require('@modelcontextprotocol/sdk/types.js');
const getRawBody = require('raw-body');

const packageJson = require('../../package.json');

const DEFAULT_PORT = Number(process.env.RAH_MCP_PORT || 44145);
const DEFAULT_HOST = '127.0.0.1';
const STATUS_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'RA-H',
  'config'
);
const STATUS_FILE = path.join(STATUS_DIR, 'mcp-status.json');

let baseUrlResolver =
  typeof process.env.RAH_MCP_TARGET_URL === 'string'
    ? () => process.env.RAH_MCP_TARGET_URL
    : () => process.env.NEXT_PUBLIC_BASE_URL || 'http://127.0.0.1:3000';

let httpServer = null;
let httpPort = null;
let lastErrorMessage = null;
let logger = (message) => console.log(`[mcp] ${message}`);

const instructions = [
  'RA-H is a personal knowledge graph — local-first, vendor-neutral.',
  'Core concepts: contexts (optional soft scopes, max 10), nodes (knowledge units), and edges (connections with explanations).',
  'If the user is trying to find a specific existing node, use rah_search_nodes first.',
  'If graph context would help with a broader task, use rah_retrieve_query_context.',
  'Use rah_get_context only when high-level graph orientation would actually help.',
  'Do not keep re-running retrieval if you already have enough relevant graph context in play.',
  'Use contexts only when one obvious existing context is explicitly helpful. If unsure or if none exist, leave context empty. Do not assume the server will infer a best-fit context.',
  'Search before creating: use rah_search_nodes to check if content already exists.',
  'Only suggest saving context when it is unusually durable and valuable. Keep the ask brief, for example: Add "X" as a node?',
  'Never write via rah_write_context unless the user has explicitly confirmed yes.',
  'Every edge needs an explanation: why does this connection exist?',
  'All data stays local on this device; nothing leaves 127.0.0.1.',
].join(' ');

const serverInfo = {
  name: 'ra-h-local-mcp',
  version: packageJson.version || '0.0.0'
};

const createServer = () =>
  new McpServer(serverInfo, {
    instructions,
    capabilities: {
      tools: {}
    }
  });

const mcpServer = createServer();

const addNodeInputSchema = {
  title: z.string().min(1).max(160),
  content: z.string().max(20000).optional(),
  source: z.string().max(50000).optional(),
  link: z.string().url().optional(),
  description: z.string().max(500).optional().describe('Description of the node. Write it as natural prose, not labels or a checklist. It must still make clear what the artifact is, why it is in the graph (infer from conversation context; ask the user if needed), and its current workflow status. Max 500 characters. If the reason is unclear, say that naturally instead of inventing it. Never use filler phrases like "insightful for understanding" or "relevant to the user\'s work".'),
  context_id: z.number().int().positive().nullable().optional().describe('Optional primary context ID. Usually omit this field entirely unless you already know a real matching context.'),
  context_name: z.string().optional(),
  metadata: z.record(z.any()).optional().describe('Optional metadata. Prefer canonical keys: type, state, captured_method, captured_by, source_metadata.'),
  chunk: z.string().max(50000).optional()
};

const addNodeOutputSchema = {
  nodeId: z.number(),
  title: z.string(),
  message: z.string()
};

const searchNodesInputSchema = {
  query: z.string().min(1).max(400),
  limit: z.number().min(1).max(25).optional(),
  contextId: z.number().int().positive().optional()
};

const searchNodesOutputSchema = {
  count: z.number(),
  nodes: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      source: z.string().nullable(),
      description: z.string().nullable(),
      link: z.string().nullable(),
      updated_at: z.string()
    })
  )
};

const retrieveQueryContextInputSchema = {
  query: z.string().min(1).max(800),
  focused_node_id: z.number().int().positive().nullable().optional(),
  active_context_id: z.number().int().positive().nullable().optional(),
  limit: z.number().min(1).max(12).optional()
};

const retrieveQueryContextOutputSchema = {
  query: z.string(),
  shouldRetrieve: z.boolean(),
  mode: z.enum(['skip', 'focused', 'query']),
  reason: z.string(),
  focused_node_id: z.number().nullable(),
  active_context_id: z.number().nullable(),
  nodes: z.array(z.object({
    id: z.number(),
    title: z.string(),
    description: z.string().nullable(),
    link: z.string().nullable(),
    updated_at: z.string(),
    kind: z.enum(['focused', 'query_match', 'context_hint', 'neighbor']),
    reason: z.string(),
    seed_node_id: z.number().optional()
  })),
  chunks: z.array(z.object({
    id: z.number(),
    node_id: z.number(),
    node_title: z.string(),
    preview: z.string(),
    similarity: z.number()
  }))
};

const writeContextInputSchema = {
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(500),
  source: z.string().max(50000).optional(),
  context_id: z.number().int().positive().nullable().optional(),
  metadata: z.record(z.any()).optional(),
  confirmed_by_user: z.boolean()
};

const writeContextOutputSchema = {
  success: z.boolean(),
  nodeId: z.number(),
  title: z.string(),
  message: z.string()
};

const queryContextsInputSchema = {
  contextId: z.number().int().positive().optional(),
  name: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).optional(),
  includeNodes: z.boolean().optional()
};

const queryContextsOutputSchema = {
  count: z.number(),
  contexts: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      description: z.string().nullable(),
      icon: z.string().nullable(),
      count: z.number(),
      nodes: z.array(
        z.object({
          id: z.number(),
          title: z.string(),
          description: z.string().nullable(),
          link: z.string().nullable(),
          context_id: z.number().nullable().optional(),
          updated_at: z.string()
        })
      ).optional()
    })
  )
};

// rah_update_node schemas
const updateNodeInputSchema = {
  id: z.number().int().positive().describe('The ID of the node to update'),
  updates: z.object({
    title: z.string().optional().describe('New title'),
    description: z.string().max(500).optional().describe('Description of the node. Write it as natural prose, not labels or a checklist. It must still make clear what the artifact is, why it is in the graph (infer from conversation context; ask the user if needed), and its current workflow status. Max 500 characters. If the reason is unclear, say that naturally instead of inventing it. Never use filler phrases like "insightful for understanding" or "relevant to the user\'s work".'),
    content: z.string().optional().describe('Legacy alias for source. Mapped to source for backward compatibility.'),
    source: z.string().optional().describe('Canonical source text for embedding.'),
    link: z.string().optional().describe('New link'),
    context_id: z.number().int().positive().nullable().optional().describe('Optional primary context ID. Omit this field to preserve existing context. Only use null when you intentionally want to clear context.'),
    metadata: z.record(z.any()).optional().describe('Metadata patch. This now merges with existing metadata. Prefer canonical keys: type, state, captured_method, captured_by, source_metadata.')
  }).describe('Fields to update')
};

const updateNodeOutputSchema = {
  success: z.boolean(),
  nodeId: z.number(),
  message: z.string()
};

// rah_get_nodes schemas
const getNodesInputSchema = {
  nodeIds: z.array(z.number().int().positive()).min(1).max(10).describe('List of node IDs to load')
};

const getNodesOutputSchema = {
  count: z.number(),
  nodes: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      source: z.string().nullable(),
      link: z.string().nullable(),
      updated_at: z.string()
    })
  )
};

// rah_create_edge schemas
const createEdgeInputSchema = {
  sourceId: z.number().int().positive().describe('Source node ID'),
  targetId: z.number().int().positive().describe('Target node ID'),
  explanation: z.string().min(1).describe('REQUIRED: Why does this connection exist? Be specific.')
};

const createEdgeOutputSchema = {
  success: z.boolean(),
  edgeId: z.number(),
  message: z.string()
};

// rah_query_edges schemas
const queryEdgesInputSchema = {
  nodeId: z.number().int().positive().optional().describe('Find edges connected to this node'),
  limit: z.number().min(1).max(50).optional().describe('Max edges to return')
};

const queryEdgesOutputSchema = {
  count: z.number(),
  edges: z.array(
    z.object({
      id: z.number(),
      source_id: z.number(),
      target_id: z.number(),
      type: z.string().nullable(),
      weight: z.number().nullable()
    })
  )
};

// rah_update_edge schemas
const updateEdgeInputSchema = {
  id: z.number().int().positive().describe('Edge ID to update'),
  explanation: z.string().min(1).optional().describe('New explanation text (will re-infer relationship type)')
};

const updateEdgeOutputSchema = {
  success: z.boolean(),
  message: z.string()
};

// rah_search_embeddings schemas
const searchEmbeddingsInputSchema = {
  query: z.string().min(1).describe('Semantic search query'),
  limit: z.number().min(1).max(20).optional().describe('Max results')
};

const searchEmbeddingsOutputSchema = {
  count: z.number(),
  results: z.array(
    z.object({
      nodeId: z.number(),
      title: z.string(),
      chunkPreview: z.string(),
      similarity: z.number()
    })
  )
};

// rah_extract_url schemas
const extractUrlInputSchema = {
  url: z.string().url().describe('URL of the webpage to extract content from')
};

const extractUrlOutputSchema = {
  success: z.boolean(),
  title: z.string(),
  source: z.string(),
  metadata: z.record(z.any())
};

// rah_extract_youtube schemas
const extractYoutubeInputSchema = {
  url: z.string().describe('YouTube video URL to extract transcript from')
};

const extractYoutubeOutputSchema = {
  success: z.boolean(),
  title: z.string(),
  channel: z.string(),
  source: z.string(),
  metadata: z.record(z.any())
};

// rah_extract_pdf schemas
const extractPdfInputSchema = {
  url: z.string().url().describe('URL of the PDF file to extract content from')
};

const extractPdfOutputSchema = {
  success: z.boolean(),
  title: z.string(),
  source: z.string(),
  metadata: z.record(z.any())
};

async function resolveBaseUrl() {
  try {
    const value = await baseUrlResolver();
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.replace(/\/+$/, '');
    }
  } catch (error) {
    lastErrorMessage = error instanceof Error ? error.message : String(error);
  }
  return (process.env.NEXT_PUBLIC_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

async function callRaHApi(pathname, options = {}) {
  const baseUrl = await resolveBaseUrl();
  const targetUrl = `${baseUrl}${pathname}`;
  try {
    const response = await fetch(targetUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.success === false) {
      const errorMessage = body?.error || `RA-H API request failed at ${pathname}`;
      lastErrorMessage = errorMessage;
      throw new McpError(ErrorCode.InternalError, errorMessage);
    }
    lastErrorMessage = null;
    return body;
  } catch (error) {
    const message =
      error instanceof McpError
        ? error.message
        : `Unable to reach local RA-H API at ${targetUrl}`;
    lastErrorMessage = message;
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(ErrorCode.InternalError, message);
  }
}

mcpServer.registerTool(
  'rah_add_node',
  {
    title: 'Add RA-H node',
    description: 'Create a new node in the local RA-H knowledge base. `context_id` is optional and should usually be omitted entirely unless one obvious existing context clearly fits.',
    inputSchema: addNodeInputSchema,
    outputSchema: addNodeOutputSchema
  },
  async ({ title, content, source, link, description, context_id, context_name, metadata, chunk }) => {
    const payload = {
      title: title.trim(),
      source: source?.trim() || content?.trim() || chunk?.trim() || undefined,
      link: link?.trim() || undefined,
      description: description?.trim() || undefined,
      context_id,
      context_name: context_name?.trim() || undefined,
      metadata: metadata || {}
    };

    const result = await callRaHApi('/api/nodes', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const node = result.data;
    const summary = `Created node #${node.id}: ${node.title}`;

    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        nodeId: node.id,
        title: node.title,
        message: result.message || summary
      }
    };
  }
);

mcpServer.registerTool(
  'rah_search_nodes',
  {
    title: 'Search RA-H nodes',
    description: 'Find existing RA-H entries that mention a topic before adding new ones. For full current-turn grounding of a substantive request, prefer rah_retrieve_query_context.',
    inputSchema: searchNodesInputSchema,
    outputSchema: searchNodesOutputSchema
  },
  async ({ query, limit = 10, contextId }) => {
    const params = new URLSearchParams();
    params.set('search', query.trim());
    params.set('limit', String(Math.min(Math.max(limit, 1), 25)));

    if (contextId) {
      params.set('contextId', String(contextId));
    }

    const result = await callRaHApi(`/api/nodes?${params.toString()}`, {
      method: 'GET'
    });

    const nodes = Array.isArray(result.data) ? result.data : [];
    const summary = nodes.length === 0
      ? 'No existing RA-H nodes mention that topic yet.'
      : `Found ${nodes.length} node(s) mentioning that topic.`;

    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        count: nodes.length,
        nodes: nodes.map((node) => ({
          id: node.id,
          title: node.title,
          source: node.source ?? null,
          description: node.description ?? null,
          link: node.link ?? null,
          updated_at: node.updated_at
        }))
      }
    };
  }
);

mcpServer.registerTool(
  'rah_retrieve_query_context',
  {
    title: 'Retrieve RA-H query context',
    description: 'Given the raw user query plus optional focused node state, retrieve the most relevant graph context for the current turn. It starts with direct graph search and broadens only if useful. Use this when graph context could help answer or complete a broader task. For explicit node lookup, use rah_search_nodes.',
    inputSchema: retrieveQueryContextInputSchema,
    outputSchema: retrieveQueryContextOutputSchema
  },
  async ({ query, focused_node_id, active_context_id, limit = 6 }) => {
    const result = await callRaHApi('/api/retrieval/query-context', {
      method: 'POST',
      body: JSON.stringify({
        query,
        focused_node_id: focused_node_id ?? null,
        active_context_id: active_context_id ?? null,
        limit
      })
    });

    return {
      content: [{ type: 'text', text: result.data.shouldRetrieve ? `Retrieved ${result.data.nodes.length} node(s) and ${result.data.chunks.length} chunk(s) for this turn.` : result.data.reason }],
      structuredContent: result.data
    };
  }
);

mcpServer.registerTool(
  'rah_query_contexts',
  {
    title: 'Query RA-H contexts',
    description: 'List or inspect optional contexts. Use this only when a context is already obviously relevant or the user asks for it.',
    inputSchema: queryContextsInputSchema,
    outputSchema: queryContextsOutputSchema
  },
  async ({ contextId, name, search, limit = 50, includeNodes = false }) => {
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedSearch = typeof search === 'string' ? search.trim().toLowerCase() : '';

    let contexts = [];

    if (contextId) {
      const result = await callRaHApi(`/api/contexts/${contextId}`, { method: 'GET' });
      contexts = result.data ? [result.data] : [];
    } else {
      const result = await callRaHApi('/api/contexts', { method: 'GET' });
      contexts = Array.isArray(result.data) ? result.data : [];
    }

    if (normalizedName) {
      contexts = contexts.filter((context) => context.name.toLowerCase() === normalizedName.toLowerCase());
    }

    if (normalizedSearch) {
      contexts = contexts.filter((context) =>
        context.name.toLowerCase().includes(normalizedSearch) ||
        (context.description || '').toLowerCase().includes(normalizedSearch)
      );
    }

    contexts = contexts.slice(0, Math.min(Math.max(limit, 1), 100));

    const includeContextNodes = includeNodes && contexts.length === 1 && (contextId || normalizedName);
    const structuredContexts = await Promise.all(
      contexts.map(async (context) => {
        if (!includeContextNodes) {
          return {
            id: context.id,
            name: context.name,
            description: context.description ?? null,
            icon: context.icon ?? null,
            count: context.count ?? 0
          };
        }

        const nodesResult = await callRaHApi(`/api/contexts/${context.id}/nodes`, { method: 'GET' });
        const nodes = Array.isArray(nodesResult.data) ? nodesResult.data : [];

        return {
          id: context.id,
          name: context.name,
          description: context.description ?? null,
          icon: context.icon ?? null,
          count: context.count ?? nodes.length,
          nodes: nodes.map((node) => ({
            id: node.id,
            title: node.title,
            description: node.description ?? null,
            link: node.link ?? null,
            context_id: node.context_id ?? null,
            updated_at: node.updated_at
          }))
        };
      })
    );

    const summary = structuredContexts.length === 0
      ? 'No contexts found.'
      : `Found ${structuredContexts.length} context(s).`;

    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        count: structuredContexts.length,
        contexts: structuredContexts
      }
    };
  }
);

mcpServer.registerTool(
  'rah_update_node',
  {
    title: 'Update RA-H node',
    description: 'Update an existing node. `context_id` is optional and should usually be omitted entirely unless you are intentionally setting or clearing a real context.',
    inputSchema: updateNodeInputSchema,
    outputSchema: updateNodeOutputSchema
  },
  async ({ id, updates }) => {
    if (!updates || Object.keys(updates).length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'At least one field must be provided in updates.');
    }

    // Backward compatibility: map legacy content/chunk → source
    const mappedUpdates = { ...updates };
    if (mappedUpdates.chunk !== undefined && mappedUpdates.source === undefined) {
      mappedUpdates.source = mappedUpdates.chunk;
    }
    if (mappedUpdates.content !== undefined) {
      mappedUpdates.source = mappedUpdates.content;
      delete mappedUpdates.content;
    }
    delete mappedUpdates.chunk;

    const result = await callRaHApi(`/api/nodes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(mappedUpdates)
    });

    const node = result.node || result.data;
    return {
      content: [{ type: 'text', text: `Updated node #${id}` }],
      structuredContent: {
        success: true,
        nodeId: node?.id || id,
        message: result.message || `Updated node #${id}`
      }
    };
  }
);

mcpServer.registerTool(
  'rah_get_nodes',
  {
    title: 'Get RA-H nodes by ID',
    description: 'Load full node records by their IDs.',
    inputSchema: getNodesInputSchema,
    outputSchema: getNodesOutputSchema
  },
  async ({ nodeIds }) => {
    const uniqueIds = Array.from(new Set(nodeIds.filter(id => Number.isFinite(id) && id > 0)));
    if (uniqueIds.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'No valid node IDs provided.');
    }

    const nodes = [];
    for (const id of uniqueIds) {
      try {
        const result = await callRaHApi(`/api/nodes/${id}`, { method: 'GET' });
        if (result.node) {
          nodes.push({
            id: result.node.id,
            title: result.node.title,
            source: result.node.source ?? null,
            link: result.node.link ?? null,
            updated_at: result.node.updated_at
          });
        }
      } catch (e) {
        // Skip missing nodes
      }
    }

    return {
      content: [{ type: 'text', text: `Loaded ${nodes.length} of ${uniqueIds.length} nodes.` }],
      structuredContent: {
        count: nodes.length,
        nodes
      }
    };
  }
);

mcpServer.registerTool(
  'rah_create_edge',
  {
    title: 'Create RA-H edge',
    description: 'Create a connection between two nodes.',
    inputSchema: createEdgeInputSchema,
    outputSchema: createEdgeOutputSchema
  },
  async ({ sourceId, targetId, explanation }) => {
    const payload = {
      from_node_id: sourceId,
      to_node_id: targetId,
      explanation: explanation.trim(),
      source: 'helper_name',
      created_via: 'mcp'
    };

    const result = await callRaHApi('/api/edges', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const edge = result.edge || result.data;
    return {
      content: [{ type: 'text', text: `Created edge from #${sourceId} to #${targetId}` }],
      structuredContent: {
        success: true,
        edgeId: edge?.id || 0,
        message: result.message || `Created edge from #${sourceId} to #${targetId}`
      }
    };
  }
);

mcpServer.registerTool(
  'rah_query_edges',
  {
    title: 'Query RA-H edges',
    description: 'Find connections between nodes.',
    inputSchema: queryEdgesInputSchema,
    outputSchema: queryEdgesOutputSchema
  },
  async ({ nodeId, limit = 25 }) => {
    const params = new URLSearchParams();
    if (nodeId) params.set('nodeId', String(nodeId));
    params.set('limit', String(Math.min(Math.max(limit, 1), 50)));

    const result = await callRaHApi(`/api/edges?${params.toString()}`, {
      method: 'GET'
    });

    const edges = Array.isArray(result.data) ? result.data : [];
    return {
      content: [{ type: 'text', text: `Found ${edges.length} edge(s).` }],
      structuredContent: {
        count: edges.length,
        edges: edges.map(e => ({
          id: e.id,
          source_id: e.from_node_id,
          target_id: e.to_node_id,
          type: e.context?.type ?? null,
          weight: typeof e.context?.confidence === 'number' ? e.context.confidence : null
        }))
      }
    };
  }
);

mcpServer.registerTool(
  'rah_update_edge',
  {
    title: 'Update RA-H edge',
    description: 'Update an existing edge connection.',
    inputSchema: updateEdgeInputSchema,
    outputSchema: updateEdgeOutputSchema
  },
  async ({ id, explanation }) => {
    if (typeof explanation !== 'string' || explanation.trim().length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'explanation is required.');
    }

    const result = await callRaHApi(`/api/edges/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        context: { explanation: explanation.trim(), created_via: 'mcp' }
      })
    });

    return {
      content: [{ type: 'text', text: `Updated edge #${id}` }],
      structuredContent: {
        success: true,
        message: result.message || `Updated edge #${id}`
      }
    };
  }
);

mcpServer.registerTool(
  'rah_search_embeddings',
  {
    title: 'Semantic search RA-H',
    description: 'Search node content using semantic similarity (vector search).',
    inputSchema: searchEmbeddingsInputSchema,
    outputSchema: searchEmbeddingsOutputSchema
  },
  async ({ query, limit = 10 }) => {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('limit', String(Math.min(Math.max(limit, 1), 20)));

    const result = await callRaHApi(`/api/nodes/search?${params.toString()}`, {
      method: 'GET'
    });

    const results = Array.isArray(result.data) ? result.data : [];
    return {
      content: [{ type: 'text', text: `Found ${results.length} semantically similar result(s).` }],
      structuredContent: {
        count: results.length,
        results: results.map(r => ({
          nodeId: r.node_id || r.nodeId || r.id,
          title: r.title || 'Untitled',
          chunkPreview: (r.source || '').slice(0, 200),
          similarity: r.similarity || r.score || 0
        }))
      }
    };
  }
);

mcpServer.registerTool(
  'rah_extract_url',
  {
    title: 'Extract URL content',
    description: 'Extract content from a webpage URL. Returns title, content, and metadata for creating nodes.',
    inputSchema: extractUrlInputSchema,
    outputSchema: extractUrlOutputSchema
  },
  async ({ url }) => {
    const result = await callRaHApi('/api/extract/url', {
      method: 'POST',
      body: JSON.stringify({ url })
    });

    const summary = `Extracted content from: ${result.title || 'webpage'}`;
    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        success: true,
        title: result.title || 'Untitled',
        source: result.source || '',
        metadata: result.metadata || {}
      }
    };
  }
);

mcpServer.registerTool(
  'rah_extract_youtube',
  {
    title: 'Extract YouTube transcript',
    description: 'Extract transcript from a YouTube video. Returns title, channel, transcript, and metadata.',
    inputSchema: extractYoutubeInputSchema,
    outputSchema: extractYoutubeOutputSchema
  },
  async ({ url }) => {
    const result = await callRaHApi('/api/extract/youtube', {
      method: 'POST',
      body: JSON.stringify({ url })
    });

    const summary = `Extracted transcript from: ${result.title || 'YouTube video'}`;
    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        success: true,
        title: result.title || 'Untitled',
        channel: result.channel || 'Unknown',
        source: result.source || '',
        metadata: result.metadata || {}
      }
    };
  }
);

mcpServer.registerTool(
  'rah_extract_pdf',
  {
    title: 'Extract PDF content',
    description: 'Extract content from a PDF file URL. Returns title, content, and metadata for creating nodes.',
    inputSchema: extractPdfInputSchema,
    outputSchema: extractPdfOutputSchema
  },
  async ({ url }) => {
    const result = await callRaHApi('/api/extract/pdf', {
      method: 'POST',
      body: JSON.stringify({ url })
    });

    const summary = `Extracted content from: ${result.title || 'PDF document'}`;
    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        success: true,
        title: result.title || 'Untitled PDF',
        source: result.source || '',
        metadata: result.metadata || {}
      }
    };
  }
);

// rah_get_context — orientation tool for external agents
mcpServer.registerTool(
  'rah_get_context',
  {
    title: 'Get RA-H context',
    description: 'Get orientation context: high-level graph state, optional contexts, hub nodes, stats, and available guides. Use this for orientation only, not as the default retrieval path for substantive requests.',
    inputSchema: {},
    outputSchema: {
      stats: z.object({ nodeCount: z.number(), edgeCount: z.number(), contextCount: z.number().optional() }),
      hubNodes: z.array(z.object({ id: z.number(), title: z.string(), description: z.string().nullable(), edgeCount: z.number() })),
      contexts: z.array(z.object({ id: z.number(), name: z.string(), description: z.string().nullable(), icon: z.string().nullable().optional(), count: z.number() })).optional(),
      guides: z.array(z.string())
    }
  },
  async () => {
    const hubResult = await callRaHApi('/api/nodes?sortBy=edges&limit=5', { method: 'GET' });
    const hubNodes = Array.isArray(hubResult.data) ? hubResult.data.map(n => ({
      id: n.id, title: n.title, description: n.description ?? null, edgeCount: n.edge_count ?? 0
    })) : [];

    const contextResult = await callRaHApi('/api/contexts', { method: 'GET' });
    const contexts = Array.isArray(contextResult.data) ? contextResult.data.map(c => ({
      id: c.id, name: c.name, description: c.description ?? null, icon: c.icon ?? null, count: c.count ?? 0
    })) : [];

    const guideResult = await callRaHApi('/api/guides', { method: 'GET' });
    const guides = Array.isArray(guideResult.data) ? guideResult.data.map(g => g.name) : [];

    const stats = { nodeCount: 0, edgeCount: 0, contextCount: contexts.length };
    try {
      const countResult = await callRaHApi('/api/nodes?limit=1', { method: 'GET' });
      if (countResult.total !== undefined) stats.nodeCount = countResult.total;
    } catch { /* use defaults */ }

    return {
      content: [{ type: 'text', text: `Knowledge graph: ${stats.contextCount} contexts, ${hubNodes.length} hub nodes for graph grounding, ${guides.length} guides available.` }],
      structuredContent: { stats, hubNodes, contexts, guides }
    };
  }
);

mcpServer.registerTool(
  'rah_write_context',
  {
    title: 'Write RA-H context node',
    description: 'Write one atomic durable context node to the graph only after the user has explicitly approved the save. Use this sparingly for unusually valuable context. Never call it unless the user has clearly said yes.',
    inputSchema: writeContextInputSchema,
    outputSchema: writeContextOutputSchema
  },
  async ({ title, description, source, context_id, metadata, confirmed_by_user }) => {
    if (!confirmed_by_user) {
      throw new Error('rah_write_context requires explicit user confirmation before writing to the graph.');
    }

    const result = await callRaHApi('/api/nodes', {
      method: 'POST',
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        source: source?.trim() || undefined,
        context_id: context_id ?? null,
        metadata: {
          captured_by: 'human',
          captured_method: 'write_context',
          ...(metadata || {})
        }
      })
    });

    const node = result.data;
    const message = result.message || `Saved context as node #${node.id}: ${node.title}`;
    return {
      content: [{ type: 'text', text: message }],
      structuredContent: {
        success: true,
        nodeId: node.id,
        title: node.title,
        message
      }
    };
  }
);

async function readRequestBody(req) {
  if (req.method !== 'POST') return undefined;
  try {
    const raw = await getRawBody(req, {
      limit: '4mb',
      encoding: 'utf-8'
    });
    return raw ? JSON.parse(raw) : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.ParseError, `Invalid JSON body: ${message}`);
  }
}

async function handleMcpRequest(req, res) {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on('close', () => {
    transport.close().catch(() => undefined);
  });

  try {
    const parsedBody = await readRequestBody(req);
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    const message = error instanceof McpError ? error.message : 'MCP transport failure';
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: ErrorCode.InternalError, message }
    }));
    logger(`MCP request error: ${message}`);
  }
}

function ensureStatusDir() {
  fs.mkdirSync(STATUS_DIR, { recursive: true });
}

async function getStatusSnapshot() {
  const baseUrl = await resolveBaseUrl();
  return {
    enabled: !!httpServer,
    port: httpPort,
    url: httpPort ? `http://${DEFAULT_HOST}:${httpPort}/mcp` : null,
    target_base_url: baseUrl,
    last_updated: new Date().toISOString(),
    last_error: lastErrorMessage
  };
}

async function persistStatus() {
  try {
    if (!httpServer) {
      ensureStatusDir();
      fs.writeFileSync(
        STATUS_FILE,
        JSON.stringify({
          enabled: false,
          port: null,
          url: null,
          last_updated: new Date().toISOString()
        }, null, 2)
      );
      return;
    }
    const snapshot = await getStatusSnapshot();
    ensureStatusDir();
    fs.writeFileSync(STATUS_FILE, JSON.stringify(snapshot, null, 2));
  } catch (error) {
    logger(`Failed to persist MCP status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function ensureMcpServer(options = {}) {
  if (typeof options.logger === 'function') {
    logger = options.logger;
  }
  if (typeof options.resolveBaseUrl === 'function') {
    baseUrlResolver = options.resolveBaseUrl;
  }

  if (httpServer) {
    await persistStatus();
    return { port: httpPort };
  }

  const port = Number(options.port || DEFAULT_PORT);
  const host = options.host || DEFAULT_HOST;

  httpServer = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    if (parsedUrl.pathname === '/status') {
      const snapshot = await getStatusSnapshot();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(snapshot));
      return;
    }

    if (parsedUrl.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Route not found' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Use POST for MCP requests' }));
      return;
    }

    await handleMcpRequest(req, res);
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpPort = port;
      logger(`MCP server listening on http://${host}:${port}/mcp`);
      resolve();
    });
  });

  await persistStatus();
  return { port };
}

function updateBaseUrlResolver(resolver) {
  if (typeof resolver === 'function') {
    baseUrlResolver = resolver;
    persistStatus().catch(() => undefined);
  }
}

async function stopMcpServer() {
  if (!httpServer) return;
  await new Promise((resolve) => {
    httpServer.close(() => resolve());
  });
  httpServer = null;
  httpPort = null;
  await persistStatus();
}

module.exports = {
  ensureMcpServer,
  updateBaseUrlResolver,
  getStatusSnapshot,
  stopMcpServer,
  STATUS_FILE
};

if (require.main === module) {
  ensureMcpServer({
    port: DEFAULT_PORT,
    resolveBaseUrl: baseUrlResolver
  }).catch((error) => {
    console.error('Failed to start RA-H MCP server:', error);
    process.exit(1);
  });
}
