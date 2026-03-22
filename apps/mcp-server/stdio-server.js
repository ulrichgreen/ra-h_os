#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const packageJson = require('../../package.json');

const instructions = [
  'RA-H is a personal knowledge graph — local-first, vendor-neutral.',
  'Core concepts: nodes (knowledge units), edges (connections with explanations), dimensions (categories).',
  'Always call rah_get_context first to orient yourself — it returns hub nodes, dimensions, stats, and available guides.',
  'Search before creating: use rah_search_nodes to check if content already exists.',
  'Every edge needs an explanation: why does this connection exist?',
  'All data stays local on this device; nothing leaves 127.0.0.1.',
].join(' ');

const serverInfo = {
  name: 'ra-h-local-stdio',
  version: packageJson.version || '0.0.0'
};

const STATUS_PATH = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'RA-H',
  'config',
  'mcp-status.json'
);

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
      content: z.string().nullable(),
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
      content: z.string().nullable(),
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
      from_node_id: z.number(),
      to_node_id: z.number(),
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

const server = new McpServer(serverInfo, { instructions });

function logError(...args) {
  console.error('[ra-h-stdio]', ...args);
}

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

function readStatusFile() {
  try {
    if (!fs.existsSync(STATUS_PATH)) {
      return null;
    }
    const raw = fs.readFileSync(STATUS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function resolveBaseUrl() {
  const envTarget = process.env.RAH_MCP_TARGET_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (envTarget && envTarget.trim().length > 0) {
    return envTarget.replace(/\/+$/, '');
  }
  const status = readStatusFile();
  if (status?.target_base_url) {
    return String(status.target_base_url).replace(/\/+$/, '');
  }
  if (status?.port) {
    return `http://127.0.0.1:${status.port}`.replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:3000';
}

async function callRaHApi(pathname, options = {}) {
  const baseUrl = (await resolveBaseUrl()).replace(/\/+$/, '');
  const targetUrl = `${baseUrl}${pathname}`;

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
    throw new Error(errorMessage);
  }
  return body;
}

server.registerTool(
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
      throw new Error('At least one dimension/tag is required when creating a node.');
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

server.registerTool(
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
    const summary =
      nodes.length === 0
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

server.registerTool(
  'rah_update_node',
  {
    title: 'Update RA-H node',
    description: 'Update an existing node. Content is APPENDED (not replaced). Dimensions are replaced.',
    inputSchema: updateNodeInputSchema,
    outputSchema: updateNodeOutputSchema
  },
  async ({ id, updates }) => {
    if (!updates || Object.keys(updates).length === 0) {
      throw new Error('At least one field must be provided in updates.');
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

server.registerTool(
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
      throw new Error('No valid node IDs provided.');
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

server.registerTool(
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

server.registerTool(
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
          from_node_id: e.from_node_id,
          to_node_id: e.to_node_id,
          type: e.type ?? e.source ?? null,
          weight: e.weight ?? null
        }))
      }
    };
  }
);

server.registerTool(
  'rah_update_edge',
  {
    title: 'Update RA-H edge',
    description: 'Update an existing edge connection.',
    inputSchema: updateEdgeInputSchema,
    outputSchema: updateEdgeOutputSchema
  },
  async ({ id, explanation }) => {
    if (typeof explanation !== 'string' || explanation.trim().length === 0) {
      throw new Error('explanation is required');
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

server.registerTool(
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

server.registerTool(
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

server.registerTool(
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

server.registerTool(
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

server.registerTool(
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

server.registerTool(
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

server.registerTool(
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
const getContextOutputSchema = {
  schema: z.object({
    nodeCount: z.number(),
    edgeCount: z.number(),
    dimensionCount: z.number()
  }),
  hubNodes: z.array(z.object({
    id: z.number(),
    title: z.string(),
    description: z.string().nullable(),
    edgeCount: z.number()
  })),
  dimensions: z.array(z.object({
    name: z.string(),
    nodeCount: z.number(),
    description: z.string().nullable()
  })),
  guides: z.array(z.string())
};

server.registerTool(
  'rah_get_context',
  {
    title: 'Get RA-H context',
    description: 'Get orientation context: hub nodes, dimensions, stats, and available guides. Call this first.',
    inputSchema: {},
    outputSchema: getContextOutputSchema
  },
  async () => {
    // Fetch hub nodes (top 5 most-connected)
    const hubResult = await callRaHApi('/api/nodes?sortBy=edges&limit=5', { method: 'GET' });
    const hubNodes = Array.isArray(hubResult.data) ? hubResult.data.map(n => ({
      id: n.id,
      title: n.title,
      description: n.description ?? null,
      edgeCount: n.edge_count ?? 0
    })) : [];

    // Fetch dimensions
    const dimResult = await callRaHApi('/api/dimensions', { method: 'GET' });
    const dimensions = Array.isArray(dimResult.data) ? dimResult.data.map(d => ({
      name: d.name,
      nodeCount: d.node_count ?? 0,
      description: d.description ?? null
    })) : [];

    // Fetch guides
    const guideResult = await callRaHApi('/api/guides', { method: 'GET' });
    const guides = Array.isArray(guideResult.data) ? guideResult.data.map(g => g.name) : [];

    // Get counts
    const nodeCount = hubNodes.length > 0 ? undefined : 0;
    const stats = {
      nodeCount: nodeCount ?? hubNodes.reduce((_, n) => 0, 0),
      edgeCount: 0,
      dimensionCount: dimensions.length
    };

    // Try to get actual counts from a stats endpoint or compute
    try {
      const countResult = await callRaHApi('/api/nodes?limit=1', { method: 'GET' });
      if (countResult.total !== undefined) {
        stats.nodeCount = countResult.total;
      }
    } catch { /* use defaults */ }

    const summary = `Knowledge graph: ${stats.dimensionCount} dimensions, ${hubNodes.length} hub nodes. ${guides.length} guides available.`;

    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        schema: stats,
        hubNodes,
        dimensions,
        guides
      }
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logError('STDIO MCP server ready');
}

main().catch((error) => {
  logError('Fatal error:', error);
  process.exit(1);
});
