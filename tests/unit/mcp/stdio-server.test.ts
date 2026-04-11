import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type ContextRecord = {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
};

type NodeRecord = {
  id: number;
  title: string;
  description: string | null;
  source: string | null;
  link: string | null;
  context_id: number | null;
  metadata: Record<string, unknown>;
  updated_at: string;
  created_at: string;
  edge_count: number;
};

type RequestLogEntry = {
  method: string;
  pathname: string;
  body: Record<string, unknown> | null;
};

const contexts: ContextRecord[] = [
  { id: 1, name: 'Work', description: 'Work projects and execution context.', icon: 'Briefcase' },
  { id: 2, name: 'Personal', description: 'Personal life and planning context.', icon: 'Heart' },
];

let server: http.Server;
let baseUrl = '';
let nodes: NodeRecord[] = [];
let requestLog: RequestLogEntry[] = [];
let nextNodeId = 1;

function nowIso(): string {
  return new Date().toISOString();
}

function resetState() {
  nodes = [];
  requestLog = [];
  nextNodeId = 1;
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function matchesNode(node: NodeRecord, query: string) {
  const haystack = [node.title, node.description, node.source, node.link]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', baseUrl);
  const pathname = url.pathname;
  const method = req.method || 'GET';
  const body = method === 'POST' || method === 'PUT' ? await readJsonBody(req) : null;

  requestLog.push({ method, pathname, body });

  if (method === 'POST' && pathname === '/api/nodes') {
    const contextId = typeof body?.context_id === 'number' ? body.context_id : null;
    const contextName = typeof body?.context_name === 'string' ? body.context_name.trim() : '';
    const resolvedContextId = contextId
      ?? (contextName ? contexts.find((context) => context.name.toLowerCase() === contextName.toLowerCase())?.id ?? null : null);

    if (contextId && !contexts.some((context) => context.id === contextId)) {
      return sendJson(res, 400, { success: false, error: 'Context not found.' });
    }

    if (contextName && resolvedContextId === null) {
      return sendJson(res, 400, { success: false, error: 'Context not found.' });
    }

    const timestamp = nowIso();
    const node: NodeRecord = {
      id: nextNodeId++,
      title: String(body?.title || '').trim(),
      description: typeof body?.description === 'string' ? body.description : null,
      source: typeof body?.source === 'string' ? body.source : null,
      link: typeof body?.link === 'string' ? body.link : null,
      context_id: resolvedContextId,
      metadata: typeof body?.metadata === 'object' && body.metadata ? body.metadata as Record<string, unknown> : {},
      updated_at: timestamp,
      created_at: timestamp,
      edge_count: 0,
    };
    nodes.unshift(node);
    return sendJson(res, 200, { success: true, data: node, message: `Created node #${node.id}: ${node.title}` });
  }

  if (method === 'GET' && pathname === '/api/nodes') {
    const search = url.searchParams.get('search')?.trim() || '';
    const limit = Number(url.searchParams.get('limit') || '10');
    const contextIdParam = url.searchParams.get('contextId');
    const contextId = contextIdParam ? Number(contextIdParam) : undefined;

    let filtered = nodes.slice();
    if (search) {
      filtered = filtered.filter((node) => matchesNode(node, search));
    }
    if (contextId !== undefined) {
      filtered = filtered.filter((node) => node.context_id === contextId);
    }

    return sendJson(res, 200, {
      success: true,
      total: filtered.length,
      data: filtered.slice(0, Number.isFinite(limit) ? limit : 10),
    });
  }

  if (method === 'GET' && pathname.startsWith('/api/nodes/')) {
    const id = Number(pathname.split('/').pop());
    const node = nodes.find((entry) => entry.id === id);
    if (!node) {
      return sendJson(res, 404, { success: false, error: 'Node not found.' });
    }
    return sendJson(res, 200, { success: true, node });
  }

  if (method === 'GET' && pathname === '/api/contexts') {
    return sendJson(res, 200, {
      success: true,
      data: contexts.map((context) => ({
        ...context,
        count: nodes.filter((node) => node.context_id === context.id).length,
      })),
    });
  }

  if (method === 'GET' && /^\/api\/contexts\/\d+$/.test(pathname)) {
    const id = Number(pathname.split('/').pop());
    const context = contexts.find((entry) => entry.id === id);
    if (!context) {
      return sendJson(res, 404, { success: false, error: 'Context not found.' });
    }
    return sendJson(res, 200, {
      success: true,
      data: {
        ...context,
        count: nodes.filter((node) => node.context_id === context.id).length,
      },
    });
  }

  if (method === 'GET' && /^\/api\/contexts\/\d+\/nodes$/.test(pathname)) {
    const parts = pathname.split('/');
    const id = Number(parts[parts.length - 2]);
    return sendJson(res, 200, {
      success: true,
      data: nodes
        .filter((node) => node.context_id === id)
        .map((node) => ({
          id: node.id,
          title: node.title,
          description: node.description,
          link: node.link,
          context_id: node.context_id,
          updated_at: node.updated_at,
        })),
    });
  }

  if (method === 'GET' && pathname === '/api/guides') {
    return sendJson(res, 200, {
      success: true,
      data: [{ name: 'schema' }, { name: 'creating-nodes' }],
    });
  }

  return sendJson(res, 404, { success: false, error: `Unhandled test route: ${method} ${pathname}` });
}

async function withMcpClient<T>(fn: (client: Client) => Promise<T>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(process.cwd(), 'apps', 'mcp-server', 'stdio-server.js')],
    cwd: process.cwd(),
    env: {
      ...process.env,
      RAH_MCP_TARGET_URL: baseUrl,
    } as Record<string, string>,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'ra-h-mcp-contract-test', version: '1.0.0' });
  await client.connect(transport);

  try {
    return await fn(client);
  } finally {
    await transport.close();
  }
}

function getStructured<T>(result: unknown) {
  return (result as { structuredContent?: unknown }).structuredContent as T;
}

describe('stdio MCP server contract', () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      void handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    resetState();
  });

  it('does not expose dimension tools or dimension fields in the MCP registry', async () => {
    await withMcpClient(async (client) => {
      const result = await client.listTools();
      const toolNames = result.tools.map((tool) => tool.name);

      expect(toolNames).not.toEqual(expect.arrayContaining([
        'rah_query_dimensions',
        'rah_create_dimension',
        'rah_update_dimension',
        'rah_delete_dimension',
        'rah_get_dimension',
      ]));

      const addNodeTool = result.tools.find((tool) => tool.name === 'rah_add_node');
      expect(addNodeTool).toBeDefined();
      expect(addNodeTool?.inputSchema).toBeTruthy();
      expect(JSON.stringify(addNodeTool?.inputSchema)).not.toContain('dimensions');
    });
  });

  it('creates nodes through MCP without context and without legacy taxonomy payloads', async () => {
    await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: 'rah_add_node',
        arguments: {
          title: 'MCP Contract Test Node',
          description: 'Node created through MCP to verify the post-dimensions write contract.',
          source: 'Concrete source text proving rah_add_node works without dimensions or automatic context assignment.',
          metadata: { source: 'mcp-contract-test' },
        },
      });

      const structured = getStructured<{ nodeId: number; title: string }>(result);
      expect(structured.nodeId).toBeGreaterThan(0);
      expect(structured.title).toBe('MCP Contract Test Node');

      const createRequest = requestLog.find((entry) => entry.method === 'POST' && entry.pathname === '/api/nodes');
      expect(createRequest?.body).toMatchObject({
        title: 'MCP Contract Test Node',
        description: 'Node created through MCP to verify the post-dimensions write contract.',
        source: 'Concrete source text proving rah_add_node works without dimensions or automatic context assignment.',
        metadata: { source: 'mcp-contract-test' },
      });
      expect(createRequest?.body).not.toHaveProperty('dimensions');
      expect(createRequest?.body).not.toHaveProperty('context_id');
      expect(nodes[0]?.context_id).toBeNull();

      const searchResult = await client.callTool({
        name: 'rah_search_nodes',
        arguments: {
          query: 'contract test node',
          limit: 5,
        },
      });

      const searchStructured = getStructured<{ count: number; nodes: Array<Record<string, unknown>> }>(searchResult);
      expect(searchStructured.count).toBe(1);
      expect(searchStructured.nodes[0]).toMatchObject({
        id: structured.nodeId,
        title: 'MCP Contract Test Node',
      });
      expect(searchStructured.nodes[0]).not.toHaveProperty('dimensions');
    });
  });

  it('surfaces invalid explicit contexts instead of inferring a fallback context', async () => {
    await withMcpClient(async (client) => {
      const result = await client.callTool({
        name: 'rah_add_node',
        arguments: {
          title: 'Bad Context Node',
          description: 'This should fail because the context does not exist.',
          source: 'Source text for invalid context test.',
          context_id: 999,
        },
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('Context not found');
      expect(nodes).toHaveLength(0);
    });
  });

  it('returns soft-context orientation data without dimension state', async () => {
    nodes.push({
      id: nextNodeId++,
      title: 'Work Hub Node',
      description: 'High-signal work hub used to verify MCP context orientation.',
      source: 'Hub node source',
      link: null,
      context_id: 1,
      metadata: {},
      updated_at: nowIso(),
      created_at: nowIso(),
      edge_count: 7,
    });

    await withMcpClient(async (client) => {
      const contextsResult = await client.callTool({
        name: 'rah_query_contexts',
        arguments: {
          contextId: 1,
          includeNodes: true,
        },
      });

      const contextsStructured = getStructured<{
        count: number;
        contexts: Array<{ id: number; name: string; nodes?: Array<Record<string, unknown>> }>;
      }>(contextsResult);
      expect(contextsStructured.count).toBe(1);
      expect(contextsStructured.contexts[0]).toMatchObject({
        id: 1,
        name: 'Work',
      });
      expect(contextsStructured.contexts[0].nodes?.[0]).toMatchObject({
        title: 'Work Hub Node',
        context_id: 1,
      });
      expect(contextsStructured.contexts[0].nodes?.[0]).not.toHaveProperty('dimensions');

      const graphContextResult = await client.callTool({
        name: 'rah_get_context',
        arguments: {},
      });

      const graphStructured = getStructured<{
        stats: { contextCount: number };
        contexts: Array<{ id: number; name: string }>;
        hubNodes: Array<{ title: string }>;
        guides: string[];
      }>(graphContextResult);

      expect(graphStructured.stats.contextCount).toBe(contexts.length);
      expect(graphStructured.contexts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 1, name: 'Work' }),
          expect.objectContaining({ id: 2, name: 'Personal' }),
        ])
      );
      expect(graphStructured.hubNodes).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: 'Work Hub Node' })])
      );
      expect(graphStructured.guides).toEqual(expect.arrayContaining(['schema', 'creating-nodes']));
      expect(JSON.stringify(graphStructured)).not.toContain('dimensions');
    });
  });
});
