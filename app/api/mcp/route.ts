import { NextRequest, NextResponse } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SERVER_INFO = {
  name: 'ra-h-mcp',
  version: '2.1.1',
};

const instructions = [
  'RA-H is a personal knowledge graph — local-first, vendor-neutral.',
  'Core concepts: nodes (knowledge units) and edges (connections with explanations).',
  'If the user is trying to find a specific existing node, use rah_search_nodes first.',
  'If the user is asking a broader question or request that would benefit from graph context, use rah_retrieve_query_context.',
  'Use rah_get_context only for orientation when high-level graph state would actually help.',
  'Search before creating: use rah_search_nodes to check if content already exists.',
  'Every edge needs an explanation: why does this connection exist?',
  'Never create or update an edge unless the user has explicitly confirmed the relationship.',
].join(' ');

function getBaseUrl(request: NextRequest): string {
  const envBase = process.env.RAH_MCP_TARGET_URL || process.env.NEXT_PUBLIC_BASE_URL;
  return (envBase || request.nextUrl.origin).replace(/\/+$/, '');
}

async function callRaHApi(request: NextRequest, pathname: string, options: RequestInit = {}) {
  const response = await fetch(`${getBaseUrl(request)}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.success === false) {
    throw new Error(payload?.error || `RA-H API request failed at ${pathname}`);
  }

  return payload;
}

function createServer(request: NextRequest): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions,
    capabilities: { tools: {} },
  });

  server.registerTool(
    'rah_add_node',
    {
      title: 'Add RA-H node',
      description: 'Create a new node in the local RA-H knowledge base after you have already decided a net-new write is correct. If the user explicitly asked to save or import something and the target artifact is clear, write after duplicate/update checks. If you are only suggesting a save, propose the node first and wait for confirmation.',
      inputSchema: {
        title: z.string().min(1).max(160),
        content: z.string().max(20000).optional(),
        source: z.string().max(50000).optional(),
        link: z.string().url().optional(),
        description: z.string().max(500).optional(),
        metadata: z.record(z.any()).optional(),
        chunk: z.string().max(50000).optional(),
      },
    },
    async ({ title, content, source, link, description, metadata, chunk }) => {
      const payload = await callRaHApi(request, '/api/nodes', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          source: source?.trim() || content?.trim() || chunk?.trim() || undefined,
          link: link?.trim() || undefined,
          description: description?.trim() || undefined,
          metadata: metadata || {},
        }),
      });

      const node = payload.data;
      return {
        content: [{ type: 'text', text: `Created node #${node.id}: ${node.title}` }],
        structuredContent: {
          nodeId: node.id,
          title: node.title,
          message: payload.message || `Created node #${node.id}: ${node.title}`,
        },
      };
    }
  );

  server.registerTool(
    'rah_search_nodes',
    {
      title: 'Search RA-H nodes',
      description: 'Find existing RA-H entries that mention a topic before adding new ones. For full current-turn grounding of a substantive request, prefer `rah_retrieve_query_context`.',
      inputSchema: {
        query: z.string().min(1).max(400),
        limit: z.number().min(1).max(25).optional(),
        createdAfter: z.string().optional(),
        createdBefore: z.string().optional(),
        eventAfter: z.string().optional(),
        eventBefore: z.string().optional(),
      },
    },
    async ({ query, limit = 10, createdAfter, createdBefore, eventAfter, eventBefore }) => {
      const payload = await callRaHApi(request, '/api/nodes/direct-search', {
        method: 'POST',
        body: JSON.stringify({
          query: query.trim(),
          limit: Math.min(Math.max(limit, 1), 25),
          createdAfter: typeof createdAfter === 'string' ? createdAfter.trim() : undefined,
          createdBefore: typeof createdBefore === 'string' ? createdBefore.trim() : undefined,
          eventAfter: typeof eventAfter === 'string' ? eventAfter.trim() : undefined,
          eventBefore: typeof eventBefore === 'string' ? eventBefore.trim() : undefined,
        }),
      });
      const nodes = Array.isArray(payload.data?.nodes) ? payload.data.nodes : [];

      return {
        content: [{ type: 'text', text: nodes.length === 0 ? 'No existing RA-H nodes mention that topic yet.' : `Found ${nodes.length} node(s) mentioning that topic.` }],
        structuredContent: {
          count: nodes.length,
          nodes: nodes.map((node: any) => ({
            id: node.id,
            title: node.title,
            source: node.source ?? null,
            description: node.description ?? null,
            link: node.link ?? null,
            updated_at: node.updated_at,
          })),
        },
      };
    }
  );

  server.registerTool(
    'rah_retrieve_query_context',
    {
      title: 'Retrieve RA-H query context',
      description: 'Given the raw user query plus optional focused node state, retrieve the most relevant graph context for the current turn. It starts with direct graph search and broadens only if useful. Use this when graph context could help answer or complete a broader task. For explicit node lookup, use rah_search_nodes.',
      inputSchema: {
        query: z.string().min(1).max(1000),
        focused_node_id: z.number().int().positive().nullable().optional(),
        limit: z.number().min(1).max(20).optional(),
      },
    },
    async ({ query, focused_node_id, limit = 6 }) => {
      const payload = await callRaHApi(request, '/api/retrieval/query-context', {
        method: 'POST',
        body: JSON.stringify({
          query,
          focused_node_id: focused_node_id ?? null,
          limit,
        }),
      });

      return {
        content: [{
          type: 'text',
          text: payload.data.shouldRetrieve
            ? `Retrieved ${payload.data.nodes.length} node(s) and ${payload.data.chunks.length} chunk(s) for this turn.`
            : payload.data.reason,
        }],
        structuredContent: payload.data,
      };
    }
  );

  server.registerTool(
    'rah_update_node',
    {
      title: 'Update RA-H node',
      description: 'Update an existing node when it is clearly the same artifact and a net-new node would be redundant. Explicit user-directed updates can proceed once the target node is clear.',
      inputSchema: {
        id: z.number().int().positive(),
        updates: z.object({
          title: z.string().optional(),
          description: z.string().max(500).optional(),
          content: z.string().optional(),
          source: z.string().optional(),
          link: z.string().optional(),
          metadata: z.record(z.any()).optional(),
        }),
      },
    },
    async ({ id, updates }) => {
      if (!updates || Object.keys(updates).length === 0) {
        throw new Error('At least one field must be provided in updates.');
      }

      const mappedUpdates = { ...updates } as Record<string, unknown>;
      if (mappedUpdates.chunk !== undefined && mappedUpdates.source === undefined) {
        mappedUpdates.source = mappedUpdates.chunk;
      }
      if (mappedUpdates.content !== undefined && mappedUpdates.source === undefined) {
        mappedUpdates.source = mappedUpdates.content;
      }
      delete mappedUpdates.content;
      delete mappedUpdates.chunk;

      const payload = await callRaHApi(request, `/api/nodes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(mappedUpdates),
      });

      return {
        content: [{ type: 'text', text: `Updated node #${id}` }],
        structuredContent: {
          success: true,
          nodeId: payload.node?.id || id,
          message: payload.message || `Updated node #${id}`,
        },
      };
    }
  );

  server.registerTool(
    'rah_get_nodes',
    {
      title: 'Get RA-H nodes by ID',
      description: 'Load full node records by their IDs.',
      inputSchema: {
        nodeIds: z.array(z.number().int().positive()).min(1).max(10),
      },
    },
    async ({ nodeIds }) => {
      const uniqueIds = Array.from(new Set(nodeIds.filter((id) => Number.isFinite(id) && id > 0)));
      const nodes: any[] = [];

      for (const id of uniqueIds) {
        try {
          const payload = await callRaHApi(request, `/api/nodes/${id}`);
          if (payload.node) {
            nodes.push({
              id: payload.node.id,
              title: payload.node.title,
              source: payload.node.source ?? null,
              link: payload.node.link ?? null,
              updated_at: payload.node.updated_at,
            });
          }
        } catch {
          // Skip missing nodes.
        }
      }

      return {
        content: [{ type: 'text', text: `Loaded ${nodes.length} of ${uniqueIds.length} nodes.` }],
        structuredContent: {
          count: nodes.length,
          nodes,
        },
      };
    }
  );

  server.registerTool(
    'rah_create_edge',
    {
      title: 'Create RA-H edge',
      description: 'Create a connection between two nodes only after the user has explicitly confirmed the proposed relationship.',
      inputSchema: {
        sourceId: z.number().int().positive(),
        targetId: z.number().int().positive(),
        explanation: z.string().min(1),
        confirmed_by_user: z.boolean(),
      },
    },
    async ({ sourceId, targetId, explanation, confirmed_by_user }) => {
      if (!confirmed_by_user) {
        throw new Error('rah_create_edge requires explicit user confirmation before writing the relationship.');
      }

      const payload = await callRaHApi(request, '/api/edges', {
        method: 'POST',
        body: JSON.stringify({
          from_node_id: sourceId,
          to_node_id: targetId,
          explanation: explanation.trim(),
          source: 'helper_name',
          created_via: 'mcp',
          confirmed_by_user: true,
        }),
      });

      const edge = payload.edge || payload.data;
      return {
        content: [{ type: 'text', text: `Created edge from #${sourceId} to #${targetId}` }],
        structuredContent: {
          success: true,
          edgeId: edge?.id || 0,
          message: payload.message || `Created edge from #${sourceId} to #${targetId}`,
        },
      };
    }
  );

  server.registerTool(
    'rah_query_edges',
    {
      title: 'Query RA-H edges',
      description: 'Find connections between nodes.',
      inputSchema: {
        nodeId: z.number().int().positive().optional(),
        limit: z.number().min(1).max(50).optional(),
      },
    },
    async ({ nodeId, limit = 25 }) => {
      const params = new URLSearchParams();
      if (nodeId) params.set('nodeId', String(nodeId));
      params.set('limit', String(Math.min(Math.max(limit, 1), 50)));

      const payload = await callRaHApi(request, `/api/edges?${params.toString()}`);
      const edges = Array.isArray(payload.data) ? payload.data : [];

      return {
        content: [{ type: 'text', text: `Found ${edges.length} edge(s).` }],
        structuredContent: {
          count: edges.length,
          edges: edges.map((edge: any) => ({
            id: edge.id,
            source_id: edge.from_node_id,
            target_id: edge.to_node_id,
            type: edge.context?.type ?? null,
            weight: typeof edge.context?.confidence === 'number' ? edge.context.confidence : null,
          })),
        },
      };
    }
  );

  server.registerTool(
    'rah_update_edge',
    {
      title: 'Update RA-H edge',
      description: 'Update an existing edge connection only after the user explicitly confirmed the corrected relationship.',
      inputSchema: {
        id: z.number().int().positive(),
        explanation: z.string().min(1),
        confirmed_by_user: z.boolean(),
      },
    },
    async ({ id, explanation, confirmed_by_user }) => {
      if (!confirmed_by_user) {
        throw new Error('rah_update_edge requires explicit user confirmation before writing the corrected relationship.');
      }

      const payload = await callRaHApi(request, `/api/edges/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          context: { explanation: explanation.trim(), created_via: 'mcp' },
          confirmed_by_user: true,
        }),
      });

      return {
        content: [{ type: 'text', text: `Updated edge #${id}` }],
        structuredContent: {
          success: true,
          message: payload.message || `Updated edge #${id}`,
        },
      };
    }
  );

  server.registerTool(
    'rah_search_embeddings',
    {
      title: 'Semantic search RA-H',
      description: 'Search node content using semantic similarity.',
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().min(1).max(20).optional(),
      },
    },
    async ({ query, limit = 10 }) => {
      const params = new URLSearchParams();
      params.set('q', query);
      params.set('limit', String(Math.min(Math.max(limit, 1), 20)));

      const payload = await callRaHApi(request, `/api/nodes/search?${params.toString()}`);
      const results = Array.isArray(payload.data) ? payload.data : [];

      return {
        content: [{ type: 'text', text: `Found ${results.length} semantically similar result(s).` }],
        structuredContent: {
          count: results.length,
          results: results.map((result: any) => ({
            nodeId: result.node_id || result.nodeId || result.id,
            title: result.title || 'Untitled',
            chunkPreview: (result.source || '').slice(0, 200),
            similarity: result.similarity || result.score || 0,
          })),
        },
      };
    }
  );

  server.registerTool(
    'rah_extract_url',
    {
      title: 'Extract URL content',
      description: 'Extract content from a webpage URL.',
      inputSchema: {
        url: z.string().url(),
      },
    },
    async ({ url }) => {
      const payload = await callRaHApi(request, '/api/extract/url', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });

      return {
        content: [{ type: 'text', text: `Extracted content from: ${payload.title || 'webpage'}` }],
        structuredContent: {
          success: true,
          title: payload.title || 'Untitled',
          source: payload.source || '',
          metadata: payload.metadata || {},
        },
      };
    }
  );

  server.registerTool(
    'rah_extract_youtube',
    {
      title: 'Extract YouTube transcript',
      description: 'Extract transcript from a YouTube video.',
      inputSchema: {
        url: z.string(),
      },
    },
    async ({ url }) => {
      const payload = await callRaHApi(request, '/api/extract/youtube', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });

      return {
        content: [{ type: 'text', text: `Extracted transcript from: ${payload.title || 'YouTube video'}` }],
        structuredContent: {
          success: true,
          title: payload.title || 'Untitled',
          channel: payload.channel || 'Unknown',
          source: payload.source || '',
          metadata: payload.metadata || {},
        },
      };
    }
  );

  server.registerTool(
    'rah_extract_pdf',
    {
      title: 'Extract PDF content',
      description: 'Extract content from a PDF file URL.',
      inputSchema: {
        url: z.string().url(),
      },
    },
    async ({ url }) => {
      const payload = await callRaHApi(request, '/api/extract/pdf', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });

      return {
        content: [{ type: 'text', text: `Extracted content from: ${payload.title || 'PDF document'}` }],
        structuredContent: {
          success: true,
          title: payload.title || 'Untitled PDF',
          source: payload.source || '',
          metadata: payload.metadata || {},
        },
      };
    }
  );

  server.registerTool(
    'rah_get_context',
    {
      title: 'Get RA-H context',
      description: 'Get orientation context: high-level graph state, hub nodes, stats, and available guides.',
      inputSchema: {},
    },
    async () => {
      const [hubPayload, guidesPayload, countPayload, edgesPayload] = await Promise.all([
        callRaHApi(request, '/api/nodes?sortBy=edges&limit=10'),
        callRaHApi(request, '/api/guides').catch(() => ({ data: [] })),
        callRaHApi(request, '/api/nodes?limit=1').catch(() => ({ total: 0, count: 0 })),
        callRaHApi(request, '/api/edges?limit=1').catch(() => ({ count: 0, total: 0 })),
      ]);

      const hubNodes = Array.isArray(hubPayload.data) ? hubPayload.data.map((node: any) => ({
        id: node.id,
        title: node.title,
        description: node.description ?? null,
        edgeCount: node.edge_count ?? 0,
      })) : [];

      const guides = Array.isArray(guidesPayload.data) ? guidesPayload.data.map((guide: any) => guide.name) : [];
      const nodeCount = countPayload.total ?? countPayload.count ?? 0;
      const edgeCount = edgesPayload.total ?? edgesPayload.count ?? 0;

      return {
        content: [{ type: 'text', text: `Knowledge graph: ${nodeCount} nodes, ${edgeCount} edges, ${guides.length} guides available.` }],
        structuredContent: {
          stats: {
            nodeCount,
            edgeCount,
          },
          hubNodes,
          guides,
        },
      };
    }
  );

  return server;
}

export async function POST(request: NextRequest) {
  try {
    const server = createServer(request);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    const response = await transport.handleRequest(request);
    await transport.close();
    await server.close();

    return response;
  } catch (error) {
    console.error('MCP request error:', error);
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal MCP error',
        },
      },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id',
    },
  });
}

export async function GET(request: NextRequest) {
  const tools = [
    'rah_add_node',
    'rah_search_nodes',
    'rah_retrieve_query_context',
    'rah_update_node',
    'rah_get_nodes',
    'rah_create_edge',
    'rah_query_edges',
    'rah_update_edge',
    'rah_search_embeddings',
    'rah_extract_url',
    'rah_extract_youtube',
    'rah_extract_pdf',
    'rah_get_context',
  ];

  return NextResponse.json(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      description: 'RA-H Knowledge Graph - Remote MCP Server',
      target: getBaseUrl(request),
      tools,
    },
    {
      headers: { 'Access-Control-Allow-Origin': '*' },
    }
  );
}
