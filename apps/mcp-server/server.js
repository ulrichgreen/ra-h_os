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
  'Core concepts: nodes (knowledge units), edges (connections with explanations), dimensions (categories).',
  'Always call rah_get_context first to orient yourself — it returns hub nodes, dimensions, stats, and available guides.',
  'Search before creating: use rah_search_nodes to check if content already exists.',
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

const sanitizeDimensions = (raw) => {
  if (!Array.isArray(raw)) return [];
  const result = [];
  const seen = new Set();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const lowered = trimmed.toLowerCase();
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    result.push(trimmed);
    if (result.length >= 5) break;
  }
  return result;
};

const addNodeInputSchema = {
  title: z.string().min(1).max(160),
  content: z.string().max(20000).optional(),
  source: z.string().max(50000).optional(),
  link: z.string().url().optional(),
  description: z.string().max(2000).optional(),
  dimensions: z.array(z.string()).min(1).max(5),
  metadata: z.record(z.any()).optional(),
  chunk: z.string().max(50000).optional()
};

const addNodeOutputSchema = {
  nodeId: z.number(),
  title: z.string(),
  dimensions: z.array(z.string()),
  message: z.string()
};

const searchNodesInputSchema = {
  query: z.string().min(1).max(400),
  limit: z.number().min(1).max(25).optional(),
  dimensions: z.array(z.string()).max(5).optional()
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
      dimensions: z.array(z.string()),
      updated_at: z.string()
    })
  )
};

// rah_update_node schemas
const updateNodeInputSchema = {
  id: z.number().int().positive().describe('The ID of the node to update'),
  updates: z.object({
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description (overwrites existing)'),
    content: z.string().optional().describe('Content to APPEND (not replace)'),
    link: z.string().optional().describe('New link'),
    dimensions: z.array(z.string()).optional().describe('New dimensions (replaces existing)'),
    metadata: z.record(z.any()).optional().describe('New metadata (replaces existing)')
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
      dimensions: z.array(z.string()),
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

// rah_create_dimension schemas
const createDimensionInputSchema = {
  name: z.string().min(1).describe('Dimension name'),
  description: z.string().max(500).optional().describe('Dimension description'),
  isPriority: z.boolean().optional().describe('Lock dimension for auto-assignment')
};

const createDimensionOutputSchema = {
  success: z.boolean(),
  dimension: z.string(),
  message: z.string()
};

// rah_update_dimension schemas
const updateDimensionInputSchema = {
  name: z.string().min(1).describe('Current dimension name'),
  newName: z.string().optional().describe('New name (for renaming)'),
  description: z.string().max(500).optional().describe('New description'),
  isPriority: z.boolean().optional().describe('Lock/unlock dimension')
};

const updateDimensionOutputSchema = {
  success: z.boolean(),
  dimension: z.string(),
  message: z.string()
};

// rah_delete_dimension schemas
const deleteDimensionInputSchema = {
  name: z.string().min(1).describe('Dimension name to delete')
};

const deleteDimensionOutputSchema = {
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
  content: z.string(),
  chunk: z.string(),
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
  transcript: z.string(),
  metadata: z.record(z.any())
};

// rah_extract_pdf schemas
const extractPdfInputSchema = {
  url: z.string().url().describe('URL of the PDF file to extract content from')
};

const extractPdfOutputSchema = {
  success: z.boolean(),
  title: z.string(),
  content: z.string(),
  chunk: z.string(),
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
    description: 'Create a new node in the local RA-H knowledge base.',
    inputSchema: addNodeInputSchema,
    outputSchema: addNodeOutputSchema
  },
  async ({ title, content, source, link, description, dimensions, metadata, chunk }) => {
    const normalizedDimensions = sanitizeDimensions(dimensions);
    if (normalizedDimensions.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'At least one dimension/tag is required when creating a node.'
      );
    }

    const payload = {
      title: title.trim(),
      source: source?.trim() || chunk?.trim() || content?.trim() || undefined,
      link: link?.trim() || undefined,
      description: description?.trim() || undefined,
      dimensions: normalizedDimensions,
      metadata: metadata || {}
    };

    const result = await callRaHApi('/api/nodes', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const node = result.data;
    const summary = `Created node #${node.id}: ${node.title} [${(node.dimensions || normalizedDimensions).join(', ')}]`;

    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        nodeId: node.id,
        title: node.title,
        dimensions: node.dimensions || normalizedDimensions,
        message: result.message || summary
      }
    };
  }
);

mcpServer.registerTool(
  'rah_search_nodes',
  {
    title: 'Search RA-H nodes',
    description: 'Find existing RA-H entries that mention a topic before adding new ones.',
    inputSchema: searchNodesInputSchema,
    outputSchema: searchNodesOutputSchema
  },
  async ({ query, limit = 10, dimensions }) => {
    const params = new URLSearchParams();
    params.set('search', query.trim());
    params.set('limit', String(Math.min(Math.max(limit, 1), 25)));

    const dimensionList = sanitizeDimensions(dimensions || []);
    if (dimensionList.length > 0) {
      params.set('dimensions', dimensionList.join(','));
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
          dimensions: node.dimensions || [],
          updated_at: node.updated_at
        }))
      }
    };
  }
);

mcpServer.registerTool(
  'rah_update_node',
  {
    title: 'Update RA-H node',
    description: 'Update an existing node. Content is APPENDED (not replaced). Dimensions are replaced.',
    inputSchema: updateNodeInputSchema,
    outputSchema: updateNodeOutputSchema
  },
  async ({ id, updates }) => {
    if (!updates || Object.keys(updates).length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'At least one field must be provided in updates.');
    }

    // Map MCP legacy fields to canonical source
    const mappedUpdates = { ...updates };
    if (mappedUpdates.content !== undefined) {
      mappedUpdates.source = mappedUpdates.content;
    }
    if (mappedUpdates.chunk !== undefined && mappedUpdates.source === undefined) {
      mappedUpdates.source = mappedUpdates.chunk;
    }
    delete mappedUpdates.content;
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
            dimensions: result.node.dimensions || [],
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
  'rah_create_dimension',
  {
    title: 'Create RA-H dimension',
    description: 'Create a new dimension/tag for organizing nodes.',
    inputSchema: createDimensionInputSchema,
    outputSchema: createDimensionOutputSchema
  },
  async ({ name, description, isPriority }) => {
    const payload = { name };
    if (description) payload.description = description;
    if (isPriority !== undefined) payload.isPriority = isPriority;

    const result = await callRaHApi('/api/dimensions', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const dim = result.data?.dimension || name;
    return {
      content: [{ type: 'text', text: `Created dimension: ${dim}` }],
      structuredContent: {
        success: true,
        dimension: dim,
        message: `Created dimension: ${dim}`
      }
    };
  }
);

mcpServer.registerTool(
  'rah_update_dimension',
  {
    title: 'Update RA-H dimension',
    description: 'Update dimension properties (rename, description, lock/unlock).',
    inputSchema: updateDimensionInputSchema,
    outputSchema: updateDimensionOutputSchema
  },
  async ({ name, newName, description, isPriority }) => {
    const payload = {};
    if (newName) {
      payload.currentName = name;
      payload.newName = newName;
    } else {
      payload.name = name;
    }
    if (description !== undefined) payload.description = description;
    if (isPriority !== undefined) payload.isPriority = isPriority;

    const result = await callRaHApi('/api/dimensions', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    const dim = result.data?.dimension || newName || name;
    return {
      content: [{ type: 'text', text: `Updated dimension: ${dim}` }],
      structuredContent: {
        success: true,
        dimension: dim,
        message: `Updated dimension: ${dim}`
      }
    };
  }
);

mcpServer.registerTool(
  'rah_delete_dimension',
  {
    title: 'Delete RA-H dimension',
    description: 'Delete a dimension and remove it from all nodes.',
    inputSchema: deleteDimensionInputSchema,
    outputSchema: deleteDimensionOutputSchema
  },
  async ({ name }) => {
    const result = await callRaHApi(`/api/dimensions?name=${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });

    return {
      content: [{ type: 'text', text: `Deleted dimension: ${name}` }],
      structuredContent: {
        success: true,
        message: `Deleted dimension: ${name}`
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
        content: result.content || '',
        chunk: result.chunk || '',
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
        transcript: result.transcript || '',
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
        content: result.content || '',
        chunk: result.chunk || '',
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
    description: 'Get orientation context: hub nodes, dimensions, stats, and available guides. Call this first.',
    inputSchema: {},
    outputSchema: {
      stats: z.object({ nodeCount: z.number(), edgeCount: z.number(), dimensionCount: z.number() }),
      hubNodes: z.array(z.object({ id: z.number(), title: z.string(), description: z.string().nullable(), edgeCount: z.number() })),
      dimensions: z.array(z.object({ name: z.string(), nodeCount: z.number(), description: z.string().nullable() })),
      guides: z.array(z.string())
    }
  },
  async () => {
    const hubResult = await callRaHApi('/api/nodes?sortBy=edges&limit=5', { method: 'GET' });
    const hubNodes = Array.isArray(hubResult.data) ? hubResult.data.map(n => ({
      id: n.id, title: n.title, description: n.description ?? null, edgeCount: n.edge_count ?? 0
    })) : [];

    const dimResult = await callRaHApi('/api/dimensions', { method: 'GET' });
    const dimensions = Array.isArray(dimResult.data) ? dimResult.data.map(d => ({
      name: d.name, nodeCount: d.node_count ?? 0, description: d.description ?? null
    })) : [];

    const guideResult = await callRaHApi('/api/guides', { method: 'GET' });
    const guides = Array.isArray(guideResult.data) ? guideResult.data.map(g => g.name) : [];

    const stats = { nodeCount: 0, edgeCount: 0, dimensionCount: dimensions.length };
    try {
      const countResult = await callRaHApi('/api/nodes?limit=1', { method: 'GET' });
      if (countResult.total !== undefined) stats.nodeCount = countResult.total;
    } catch { /* use defaults */ }

    return {
      content: [{ type: 'text', text: `Knowledge graph: ${stats.dimensionCount} dimensions, ${hubNodes.length} hub nodes. ${guides.length} guides available.` }],
      structuredContent: { stats, hubNodes, dimensions, guides }
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
