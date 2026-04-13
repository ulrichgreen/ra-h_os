#!/usr/bin/env node
'use strict';

// Check Node version early — better-sqlite3 native bindings don't support bleeding-edge Node
const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
if (nodeVersion >= 24) {
  console.error(`[ra-h-mcp-server] ERROR: Node.js v${process.versions.node} is not supported.`);
  console.error('[ra-h-mcp-server] better-sqlite3 requires Node 18-22 LTS. Install Node 22:');
  console.error('[ra-h-mcp-server]   nvm install 22 && nvm use 22');
  console.error('[ra-h-mcp-server]   or: brew install node@22');
  process.exit(1);
}

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.error('[ra-h-mcp-server] ERROR: Failed to load better-sqlite3 native module.');
  console.error(`[ra-h-mcp-server] Node version: ${process.versions.node}`);
  console.error('[ra-h-mcp-server] This usually means the native bindings need rebuilding:');
  console.error('[ra-h-mcp-server]   npm rebuild better-sqlite3');
  console.error('[ra-h-mcp-server] Or your Node version is too new. Use Node 18-22 LTS.');
  console.error('[ra-h-mcp-server] Original error:', err.message);
  process.exit(1);
}

const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const packageJson = require('./package.json');

const { initDatabase, getDatabasePath, closeDatabase, getDb, query } = require('./services/sqlite-client');
const nodeService = require('./services/nodeService');
const edgeService = require('./services/edgeService');
const contextService = require('./services/contextService');
const skillService = require('./services/skillService');
const retrievalService = require('./services/retrievalService');

// Server info
const serverInfo = {
  name: 'ra-h-standalone',
  version: packageJson.version
};

function buildInstructions() {
  const now = new Date().toISOString().split('T')[0];
  let skillIndex = '- db-operations: Core graph read/write operating policy.';

  try {
    const skills = skillService.listSkills();
    if (Array.isArray(skills) && skills.length > 0) {
      skillIndex = skills
        .map(s => `- ${s.name}: ${s.description}`)
        .join('\n');
    }
  } catch (error) {
    log('Warning: failed to load skill index for instructions:', error.message);
  }

  return `Today's date: ${now}. RA-H is the user's personal knowledge graph — local SQLite, fully on-device.

## Quick start
1. If the user is trying to find a specific existing node, call queryNodes first.
2. If graph context would help with a broader task, call retrieveQueryContext.
3. Call getContext only when orientation about the overall graph would actually help.
4. Do not keep re-running retrieval if you already have enough relevant graph context in play.
5. For simple tasks, tool descriptions have everything you need.
6. For complex tasks, call readSkill("db-operations").

## Context field rule
`context_id` is optional on writes.
Do not include `context_id` unless you already know a real existing context ID that clearly fits.
Omitting `context_id` is the normal default and does not block create or update operations.

## Knowledge capture
Only suggest saving context when it seems unusually durable and valuable.
Keep the ask brief: Add "X" as a node?
Do not pester. Do not keep re-asking if the user says no, ignores it, or moves on.
Never write via writeContext unless the user has explicitly confirmed yes.
Always search or retrieve before creating to avoid duplicates.

## Available skills
${skillIndex}
Load any skill with readSkill("name").

All data stays on this device.`;
}

// Tool schemas
const addNodeInputSchema = {
  title: z.string().min(1).max(160).describe('Clear, descriptive title'),
  content: z.string().max(20000).optional().describe('Legacy alias for source content'),
  source: z.string().max(50000).optional().describe('Canonical source content for embedding'),
  link: z.string().url().optional().describe('Source URL'),
  description: z.string().optional().describe('Strongly recommended. Write the description as natural prose, not labels or a checklist. It should make clear what the artifact is and any surrounding context available. RA-H will accept whatever description is provided and will not block the write.'),
  context_id: z.number().int().positive().nullable().optional().describe('Optional primary context ID. Usually omit this field entirely unless you already know a real matching context.'),
  context_name: z.string().optional().describe('Optional convenience context name.'),
  metadata: z.record(z.any()).optional().describe('Optional metadata. Prefer canonical keys: type, state, captured_method, captured_by, source_metadata.'),
  chunk: z.string().max(50000).optional().describe('Legacy alias for source text')
};

const searchNodesInputSchema = {
  query: z.string().min(1).max(400).describe('Search query'),
  limit: z.number().min(1).max(25).optional().describe('Max results (default 10)'),
  contextId: z.number().int().positive().optional().describe('Optional primary context filter.'),
  created_after: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes created on or after this date.'),
  created_before: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes created before this date.'),
  event_after: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes with event_date on or after this date.'),
  event_before: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes with event_date before this date.')
};

const retrieveQueryContextInputSchema = {
  query: z.string().min(1).max(800).describe('The raw user query for this turn'),
  focused_node_id: z.number().int().positive().nullable().optional().describe('Optional currently focused node ID'),
  active_context_id: z.number().int().positive().nullable().optional().describe('Optional active context ID as a soft hint'),
  limit: z.number().min(1).max(12).optional().describe('Maximum number of nodes to return')
};

const writeContextInputSchema = {
  title: z.string().min(1).max(160).describe('Clear proposed node title'),
  description: z.string().min(1).max(500).describe('Natural description of what this context is and why it matters'),
  source: z.string().max(50000).optional().describe('Optional source or verbatim user wording to preserve'),
  context_id: z.number().int().positive().nullable().optional().describe('Optional primary context ID. Usually omit this field entirely unless you already know a real matching context.'),
  metadata: z.record(z.any()).optional().describe('Optional metadata patch'),
  confirmed_by_user: z.boolean().describe('Must be true before the write is allowed')
};

const getNodesInputSchema = {
  nodeIds: z.array(z.number().int().positive()).min(1).max(10).describe('Node IDs to load')
};

const updateNodeInputSchema = {
  id: z.number().int().positive().describe('Node ID'),
  updates: z.object({
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('Recommended replacement description. Keep it as natural prose that says what this artifact is and any surrounding context available. RA-H will accept whatever description is provided and will not block the write.'),
    content: z.string().optional().describe('Legacy alias for source'),
    source: z.string().optional().describe('Canonical source content for embedding'),
    link: z.string().optional().describe('New link'),
    context_id: z.number().int().positive().nullable().optional().describe('Optional primary context ID. Omit this field to preserve existing context. Only use null when you intentionally want to clear context.'),
    metadata: z.record(z.any()).optional().describe('Metadata patch. It now merges with existing metadata. Prefer canonical keys: type, state, captured_method, captured_by, source_metadata.')
  }).describe('Fields to update')
};

const createEdgeInputSchema = {
  sourceId: z.number().int().positive().describe("The 'subject' node (reads: source [explanation] target)"),
  targetId: z.number().int().positive().describe('Target node ID'),
  explanation: z.string().min(1).describe("Human-readable explanation. Should read as a sentence: 'Alice invented this technique'")
};

const updateEdgeInputSchema = {
  id: z.number().int().positive().describe('Edge ID'),
  explanation: z.string().min(1).describe('Updated explanation for this connection')
};

const queryEdgesInputSchema = {
  nodeId: z.number().int().positive().optional().describe('Find edges for this node'),
  limit: z.number().min(1).max(50).optional().describe('Max edges (default 25)')
};

const queryContextsInputSchema = {
  contextId: z.number().int().positive().optional().describe('Exact context ID lookup'),
  name: z.string().optional().describe('Exact context name lookup'),
  search: z.string().optional().describe('Case-insensitive search across context names and descriptions'),
  limit: z.number().min(1).max(100).optional().describe('Maximum number of contexts to return'),
  includeNodes: z.boolean().optional().describe('Include nodes for an exact single-context lookup')
};

const readSkillInputSchema = {
  name: z.string().min(1).describe('Skill name (e.g. "db-operations", "onboarding", "persona")')
};

const writeSkillInputSchema = {
  name: z.string().min(1).describe('Skill name (lowercase, no spaces)'),
  content: z.string().min(1).describe('Full markdown content including YAML frontmatter (name, description)')
};

const deleteSkillInputSchema = {
  name: z.string().min(1).describe('Skill name to delete')
};

const searchContentInputSchema = {
  query: z.string().min(1).max(400).describe('Search text'),
  node_id: z.number().int().positive().optional().describe('Scope to a specific node\'s chunks'),
  limit: z.number().min(1).max(20).optional().describe('Max results (default 5)')
};

const sqliteQueryInputSchema = {
  sql: z.string().min(1).describe('The SQL query to execute. Must be a SELECT, WITH, or PRAGMA statement.'),
  format: z.enum(['json', 'table']).optional().describe('Output format (default json)')
};

// FTS5 helpers
function sanitizeFtsQuery(input) {
  return input
    .replace(/['"()*:^~{}[\]]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0 && !/^(AND|OR|NOT|NEAR)$/i.test(w))
    .join(' ');
}

let _ftsAvailability = null;

function checkFtsAvailability() {
  if (_ftsAvailability !== null) return _ftsAvailability;
  try {
    const db = getDb();
    const nodesFts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes_fts'").get();
    const chunksFts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'").get();
    _ftsAvailability = { nodes: !!nodesFts, chunks: !!chunksFts };
  } catch {
    _ftsAvailability = { nodes: false, chunks: false };
  }
  return _ftsAvailability;
}

function rebuildFtsIndexes() {
  const fts = checkFtsAvailability();
  if (!fts.nodes && !fts.chunks) return;

  const db = getDb();
  if (fts.nodes) {
    try {
      db.exec("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')");
      log('Rebuilt nodes_fts index');
    } catch (err) {
      log('Warning: Failed to rebuild nodes_fts:', err.message);
      _ftsAvailability.nodes = false;
    }
  }
  if (fts.chunks) {
    try {
      db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");
      log('Rebuilt chunks_fts index');
    } catch (err) {
      log('Warning: Failed to rebuild chunks_fts:', err.message);
      _ftsAvailability.chunks = false;
    }
  }
}

// Security: Only allow read-only SQL statements
function isReadOnlyQuery(sql) {
  const normalized = sql.trim().toLowerCase();

  const allowedPrefixes = ['select', 'with', 'pragma'];
  const startsWithAllowed = allowedPrefixes.some(prefix =>
    normalized.startsWith(prefix)
  );

  if (!startsWithAllowed) return false;

  const dangerousPatterns = [
    /\binsert\b/i,
    /\bupdate\b/i,
    /\bdelete\b/i,
    /\bdrop\b/i,
    /\bcreate\b/i,
    /\balter\b/i,
    /\battach\b/i,
    /\bdetach\b/i,
    /\breindex\b/i,
    /\bvacuum\b/i,
    /\banalyze\b/i,
  ];

  return !dangerousPatterns.some(pattern => pattern.test(sql));
}

// Log to stderr (stdout is reserved for MCP protocol)
function log(...args) {
  console.error('[ra-h-standalone]', ...args);
}

async function main() {
  // Initialize database
  try {
    initDatabase();
    log('Database connected:', getDatabasePath());
    rebuildFtsIndexes();
  } catch (error) {
    log('ERROR:', error.message);
    process.exit(1);
  }

  const instructions = buildInstructions();
  const server = new McpServer(serverInfo, { instructions });

  function registerToolWithAliases(name, config, handler) {
    server.registerTool(name, config, handler);
  }

  // ========== CONTEXT TOOL ==========

  registerToolWithAliases(
    'getContext',
    {
      title: 'Get RA-H context',
      description: 'Get knowledge graph overview: stats, contexts, hub nodes (secondary diagnostics), recent activity, and available skills. Use this for orientation only, not as the default retrieval path for substantive requests. For deeper operating policy, follow up with readSkill("db-operations").',
      inputSchema: {}
    },
    async () => {
      const context = nodeService.getContext();
      const skills = skillService.listSkills();
      context.skills = skills.map(s => ({ name: s.name, description: s.description, immutable: s.immutable }));
      context.guides = context.skills;

      // First-run welcome message
      if (context.stats.nodeCount === 0) {
        return {
          content: [{ type: 'text', text: 'Empty knowledge graph. This is a fresh start. Ask what matters right now and help create the first useful node. Contexts are optional and can wait until one is obviously helpful.' }],
          structuredContent: {
            ...context,
            welcome: true,
            suggestion: 'Ask what matters right now, create the first useful node, and leave contexts empty unless one is an obvious fit.'
          }
        };
      }

      const summary = `Graph: ${context.stats.contextCount || 0} contexts, ${context.stats.nodeCount} nodes, ${context.stats.edgeCount} edges, ${skills.length} skills.`;
      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: context
      };
    }
  );

  // ========== NODE TOOLS ==========

  registerToolWithAliases(
    'retrieveQueryContext',
    {
      title: 'Retrieve RA-H query context',
      description: 'Given the raw user query plus optional focused node state, retrieve the most relevant graph context for the current turn. It starts with direct graph search and broadens only if useful. Use this when graph context could help answer or complete a broader task. For explicit node lookup, use queryNodes.',
      inputSchema: retrieveQueryContextInputSchema
    },
    async ({ query: rawQuery, focused_node_id, active_context_id, limit = 6 }) => {
      const result = retrievalService.retrieveQueryContext({
        query: rawQuery,
        focused_node_id: focused_node_id ?? null,
        active_context_id: active_context_id ?? null,
        limit,
      });

      const summary = result.shouldRetrieve
        ? `Retrieved ${result.nodes.length} node(s) and ${result.chunks.length} chunk(s) for this turn.`
        : result.reason;

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: result
      };
    }
  );

  registerToolWithAliases(
    'createNode',
    {
      title: 'Add RA-H node',
      description: 'Create a new node. Always search first (queryNodes) to avoid duplicates. `context_id` is optional and should usually be omitted entirely unless one obvious existing context clearly fits. Title: max 160 chars, clear and descriptive. Description is strongly recommended and should explicitly describe what the thing is and any surrounding context available, but the write will never be blocked over description quality. Use "link" ONLY for external content (URL, video, article) — omit for synthesis/ideas derived from existing nodes. "source" = verbatim or canonical content for embedding. Legacy "content" and "chunk" are mapped to source for compatibility.',
      inputSchema: addNodeInputSchema
    },
    async ({ title, content, source, link, description, context_id, context_name, metadata, chunk }) => {
      const sourceText = source?.trim() || content?.trim() || chunk?.trim();
      const normalizedDescription = typeof description === 'string' ? description.trim() : description;

      let resolvedContextId;
      try {
        resolvedContextId = contextService.resolveContextId({ context_id, context_name });
      } catch (error) {
        throw new Error(error.message);
      }

      const node = nodeService.createNode({
        title: title.trim(),
        source: sourceText,
        link: link?.trim(),
        description: normalizedDescription,
        context_id: resolvedContextId,
        metadata: metadata || {}
      });

      const summary = `Created node #${node.id}: ${node.title}`;

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: {
          nodeId: node.id,
          title: node.title,
          message: summary
        }
      };
    }
  );

  registerToolWithAliases(
    'queryNodes',
    {
      title: 'Search RA-H nodes',
      description: 'Search nodes by keyword across title, description, and source fields using the same indexed search path as the app search UI. Use this for direct node lookup or duplicate checks. For full current-turn grounding of a substantive query, prefer retrieveQueryContext. NOT for searching source documents (transcripts, articles) — use searchContentEmbeddings for that.',
      inputSchema: searchNodesInputSchema
    },
    async ({ query: searchQuery, limit = 10, contextId, created_after, created_before, event_after, event_before }) => {
      const safeLimit = Math.min(Math.max(limit, 1), 25);
      const trimmedQuery = searchQuery.trim();
      const nodes = nodeService.getNodes({
        search: trimmedQuery,
        limit: safeLimit,
        contextId,
        createdAfter: created_after,
        createdBefore: created_before,
        eventAfter: event_after,
        eventBefore: event_before,
      });

      const summary = nodes.length === 0
        ? 'No nodes found matching that query.'
        : `Found ${nodes.length} node(s).`;

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
            context_id: node.context_id ?? null,
            created_at: node.created_at,
            updated_at: node.updated_at,
            event_date: node.event_date ?? null,
          }))
        }
      };
    }
  );

  registerToolWithAliases(
    'writeContext',
    {
      title: 'Write RA-H context node',
      description: 'Write one atomic durable context node to the graph only after the user has explicitly approved the save. Use this sparingly for unusually valuable context. Never call it unless the user has clearly said yes.',
      inputSchema: writeContextInputSchema
    },
    async ({ title, description, source, context_id, metadata, confirmed_by_user }) => {
      if (!confirmed_by_user) {
        throw new Error('writeContext requires explicit user confirmation before writing to the graph.');
      }

      const node = nodeService.createNode({
        title: title.trim(),
        description: description.trim(),
        source: source?.trim(),
        context_id: context_id ?? null,
        metadata: {
          captured_by: 'human',
          captured_method: 'write_context',
          ...(metadata || {})
        }
      });

      const summary = `Saved context as node #${node.id}: ${node.title}`;
      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: {
          success: true,
          nodeId: node.id,
          title: node.title,
          message: summary
        }
      };
    }
  );

  registerToolWithAliases(
    'getNodesById',
    {
      title: 'Get RA-H nodes by ID',
      description: 'Load full node records by their IDs (max 10 per call). Chunks over 10K chars are truncated — check chunk_truncated and chunk_length fields. For full text, use searchContentEmbeddings to search or sqliteQuery with substr() to read sections.',
      inputSchema: getNodesInputSchema
    },
    async ({ nodeIds }) => {
      const uniqueIds = [...new Set(nodeIds.filter(id => Number.isFinite(id) && id > 0))];
      if (uniqueIds.length === 0) {
        throw new Error('No valid node IDs provided.');
      }

      const CHUNK_LIMIT = 10000;
      const nodes = [];
      for (const id of uniqueIds) {
        const node = nodeService.getNodeById(id);
        if (node) {
          const rawSource = node.source ?? null;
          const sourceTruncated = rawSource ? rawSource.length > CHUNK_LIMIT : false;

          nodes.push({
            id: node.id,
            title: node.title,
            source: node.source ?? null,
            description: node.description ?? null,
            link: node.link ?? null,
            chunk: sourceTruncated ? rawSource.substring(0, CHUNK_LIMIT) : rawSource,
            chunk_truncated: sourceTruncated,
            chunk_length: rawSource ? rawSource.length : 0,
            metadata: node.metadata ?? null,
            created_at: node.created_at,
            updated_at: node.updated_at,
            event_date: node.event_date ?? null
          });
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

  registerToolWithAliases(
    'updateNode',
    {
      title: 'Update RA-H node',
      description: 'Update an existing node. `context_id` is optional and should usually be omitted entirely unless you are intentionally setting or clearing a real context. Description updates should explicitly state what this thing is and any surrounding context available, but the write will never be blocked over description quality. Source content lives in "source". Legacy "content" is mapped to source for compatibility. Title, description, and link are overwritten. Call getNodesById first to verify current state before updating.',
      inputSchema: updateNodeInputSchema
    },
    async ({ id, updates }) => {
      if (!updates || Object.keys(updates).length === 0) {
        throw new Error('At least one field must be provided in updates.');
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

      if (Object.prototype.hasOwnProperty.call(mappedUpdates, 'description')) {
        mappedUpdates.description = typeof mappedUpdates.description === 'string'
          ? mappedUpdates.description.trim()
          : mappedUpdates.description;
      }

      if (Object.prototype.hasOwnProperty.call(mappedUpdates, 'context_id')) {
        mappedUpdates.context_id = contextService.resolveContextId({ context_id: mappedUpdates.context_id });
      }

      const node = nodeService.updateNode(id, mappedUpdates);
      const message = `Updated node #${id}`;

      return {
        content: [{ type: 'text', text: message }],
        structuredContent: {
          success: true,
          nodeId: node.id,
          message
        }
      };
    }
  );

  // ========== EDGE TOOLS ==========

  registerToolWithAliases(
    'createEdge',
    {
      title: 'Create RA-H edge',
      description: 'Connect two nodes with an edge. Edges are the most valuable part of the graph — they represent understanding, not proximity. Direction matters: reads as sourceId → [explanation] → targetId. The explanation should read as a sentence (e.g. "invented this technique", "contradicts the claim in"). Call queryEdge first to check if a connection already exists between the two nodes.',
      inputSchema: createEdgeInputSchema
    },
    async ({ sourceId, targetId, explanation }) => {
      const edge = edgeService.createEdge({
        from_node_id: sourceId,
        to_node_id: targetId,
        explanation: explanation.trim(),
        source: 'mcp'
      });

      return {
        content: [{ type: 'text', text: `Created edge from #${sourceId} to #${targetId}` }],
        structuredContent: {
          success: true,
          edgeId: edge.id,
          message: `Created edge from #${sourceId} to #${targetId}`
        }
      };
    }
  );

  registerToolWithAliases(
    'updateEdge',
    {
      title: 'Update RA-H edge',
      description: 'Update an edge explanation. Use when a connection needs a better or corrected explanation.',
      inputSchema: updateEdgeInputSchema
    },
    async ({ id, explanation }) => {
      const edge = edgeService.updateEdge(id, { explanation: explanation.trim() });

      return {
        content: [{ type: 'text', text: `Updated edge #${id}` }],
        structuredContent: {
          success: true,
          edgeId: edge.id,
          message: `Updated edge #${id}`
        }
      };
    }
  );

  registerToolWithAliases(
    'queryEdge',
    {
      title: 'Query RA-H edges',
      description: 'Find edges/connections. Optionally filter by nodeId to see all connections for a specific node. Returns up to 50 edges (default 25) with edge IDs, connected node IDs, and explanations. Use when exploring how nodes relate, checking for existing connections before creating edges, or traversing the graph from a hub node.',
      inputSchema: queryEdgesInputSchema
    },
    async ({ nodeId, limit = 25 }) => {
      const edges = edgeService.getEdges({
        nodeId,
        limit: Math.min(Math.max(limit, 1), 50)
      });

      return {
        content: [{ type: 'text', text: `Found ${edges.length} edge(s).` }],
        structuredContent: {
          count: edges.length,
          edges: edges.map(e => ({
            id: e.id,
            from_node_id: e.from_node_id,
            to_node_id: e.to_node_id,
            type: e.context?.type ?? null,
            explanation: e.context?.explanation ?? null
          }))
        }
      };
    }
  );

  // ========== DIMENSION TOOLS ==========

  registerToolWithAliases(
    'queryContexts',
    {
      title: 'List RA-H contexts',
      description: 'List or inspect optional contexts. Use this only when a context is already obviously relevant or the user asks for it.',
      inputSchema: queryContextsInputSchema
    },
    async ({ contextId, name, search, limit = 50, includeNodes = false }) => {
      const normalizedName = typeof name === 'string' ? name.trim() : '';
      const normalizedSearch = typeof search === 'string' ? search.trim().toLowerCase() : '';

      let contexts = [];

      if (contextId) {
        const context = contextService.getContextById(contextId);
        contexts = context ? [context] : [];
      } else {
        contexts = contextService.listContexts();
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
      const structuredContexts = contexts.map((context) => {
        if (!includeContextNodes) {
          return context;
        }

        const nodes = nodeService.getNodes({ contextId: context.id, limit: 500 });
        return {
          ...context,
          nodes: nodes.map((node) => ({
            id: node.id,
            title: node.title,
            description: node.description ?? null,
            link: node.link ?? null,
            context_id: node.context_id ?? null,
            updated_at: node.updated_at,
          })),
        };
      });

      const summary = structuredContexts.length === 0
        ? 'No contexts found.'
        : `Found ${structuredContexts.length} context(s).`;

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: {
          count: structuredContexts.length,
          contexts: structuredContexts,
        },
      };
    }
  );

  // ========== SKILL TOOLS ==========

  registerToolWithAliases(
    'listSkills',
    {
      title: 'List RA-H skills',
      description: 'List all skills available in this workspace. Read "db-operations" first for core graph operating policy.',
      inputSchema: {}
    },
    async () => {
      const skills = skillService.listSkills();

      return {
        content: [{ type: 'text', text: `Found ${skills.length} skill(s).` }],
        structuredContent: {
          count: skills.length,
          skills,
          guides: skills
        }
      };
    }
  );

  registerToolWithAliases(
    'readSkill',
    {
      title: 'Read RA-H skill',
      description: 'Read a skill by name. Returns full markdown with procedural instructions. Read "db-operations" for core policy. Call listSkills to see all available skills.',
      inputSchema: readSkillInputSchema
    },
    async ({ name }) => {
      const skill = skillService.readSkill(name);

      if (!skill) {
        throw new Error(`Skill "${name}" not found. Call listSkills to see available skills.`);
      }

      return {
        content: [{ type: 'text', text: skill.content }],
        structuredContent: skill
      };
    }
  );

  registerToolWithAliases(
    'writeSkill',
    {
      title: 'Write RA-H skill',
      description: 'Create or update a skill. Content should be markdown with YAML frontmatter (name, description).',
      inputSchema: writeSkillInputSchema
    },
    async ({ name, content }) => {
      const result = skillService.writeSkill(name, content);

      if (!result.success) {
        throw new Error(result.error);
      }

      return {
        content: [{ type: 'text', text: `Skill "${name}" saved.` }],
        structuredContent: {
          success: true,
          name,
          message: `Skill "${name}" saved.`
        }
      };
    }
  );

  registerToolWithAliases(
    'deleteSkill',
    {
      title: 'Delete RA-H skill',
      description: 'Delete a skill.',
      inputSchema: deleteSkillInputSchema
    },
    async ({ name }) => {
      const result = skillService.deleteSkill(name);

      if (!result.success) {
        throw new Error(result.error);
      }

      return {
        content: [{ type: 'text', text: `Skill "${name}" deleted.` }],
        structuredContent: {
          success: true,
          name,
          message: `Skill "${name}" deleted.`
        }
      };
    }
  );

  // ========== CONTENT SEARCH TOOL ==========

  registerToolWithAliases(
    'searchContentEmbeddings',
    {
      title: 'Search RA-H source content',
      description: 'Search through source content (transcripts, books, articles) stored as chunks. Use when you need to find specific text within a node\'s full source material. For node-level search (titles, descriptions), use queryNodes instead.',
      inputSchema: searchContentInputSchema
    },
    async ({ query: searchQuery, node_id, limit = 5 }) => {
      const db = getDb();

      // Check if chunks table exists
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'").get();
      if (!tableCheck) {
        return {
          content: [{ type: 'text', text: 'No chunks table found. Source content has not been chunked yet. Use getNodesById to read the raw source text instead.' }],
          structuredContent: { count: 0, chunks: [], note: 'chunks table does not exist' }
        };
      }

      const safeLimit = Math.min(Math.max(limit, 1), 20);
      const trimmedQuery = searchQuery.trim();
      const fts = checkFtsAvailability();

      let results = null;

      // Try FTS5 first (handles multi-word, relevance ranked)
      if (fts.chunks) {
        const ftsQuery = sanitizeFtsQuery(trimmedQuery);
        if (ftsQuery) {
          try {
            let sql, params;

            if (node_id) {
              sql = `
                SELECT c.id, c.node_id, c.chunk_idx, c.text, n.title as node_title
                FROM chunks c
                JOIN nodes n ON c.node_id = n.id
                WHERE c.node_id = ?
                AND c.id IN (SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?)
                ORDER BY c.chunk_idx ASC
                LIMIT ?
              `;
              params = [node_id, ftsQuery, safeLimit];
            } else {
              sql = `
                WITH fts_matches AS (
                  SELECT rowid, rank FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT ?
                )
                SELECT c.id, c.node_id, c.chunk_idx, c.text, n.title as node_title
                FROM fts_matches fm
                JOIN chunks c ON c.id = fm.rowid
                JOIN nodes n ON c.node_id = n.id
                ORDER BY fm.rank
              `;
              params = [ftsQuery, safeLimit];
            }

            results = query(sql, params);
          } catch (err) {
            log('FTS content search failed, falling back to LIKE:', err.message);
            results = null;
          }
        }
      }

      // Fallback: LIKE with word splitting
      if (results === null) {
        const words = trimmedQuery.split(/\s+/).filter(w => w.length > 0);

        let sql = `
          SELECT c.id, c.node_id, c.chunk_idx, c.text, n.title as node_title
          FROM chunks c
          JOIN nodes n ON c.node_id = n.id
          WHERE 1=1
        `;
        const params = [];

        if (node_id) {
          sql += ` AND c.node_id = ?`;
          params.push(node_id);
        }

        for (const word of words) {
          sql += ` AND c.text LIKE ? COLLATE NOCASE`;
          params.push(`%${word}%`);
        }

        sql += ` ORDER BY n.updated_at DESC, c.chunk_idx ASC LIMIT ?`;
        params.push(safeLimit);

        results = query(sql, params);
      }

      const summary = results.length === 0
        ? 'No matching content found in chunks.'
        : `Found ${results.length} chunk(s) matching "${trimmedQuery}".`;

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: {
          count: results.length,
          chunks: results.map(r => ({
            id: r.id,
            node_id: r.node_id,
            chunk_idx: r.chunk_idx,
            text: r.text,
            node_title: r.node_title
          }))
        }
      };
    }
  );

  // ========== SQL QUERY TOOL ==========

  registerToolWithAliases(
    'sqliteQuery',
    {
      title: 'Execute read-only SQL',
      description: 'Execute read-only SQL queries against the knowledge graph database. Tables: nodes, contexts, edges, chunks, and migration snapshots. Use PRAGMA table_info(tablename) for schema. Only SELECT/WITH/PRAGMA allowed. Use when structured tools are insufficient — e.g., complex JOINs, aggregations, or custom filtering. Read readSkill("schema") for table definitions and query patterns.',
      inputSchema: sqliteQueryInputSchema
    },
    async ({ sql: userSql, format = 'json' }) => {
      if (!isReadOnlyQuery(userSql)) {
        throw new Error('Only SELECT, WITH, and PRAGMA statements are allowed. Write operations must use dedicated tools.');
      }

      try {
        const rows = query(userSql);
        const rowCount = Array.isArray(rows) ? rows.length : 0;

        if (format === 'table' && Array.isArray(rows) && rows.length > 0) {
          // Simple table format
          const cols = Object.keys(rows[0]);
          const header = cols.join(' | ');
          const separator = cols.map(c => '-'.repeat(c.length)).join(' | ');
          const body = rows.map(r => cols.map(c => String(r[c] ?? '')).join(' | ')).join('\n');
          const tableStr = `${header}\n${separator}\n${body}`;

          return {
            content: [{ type: 'text', text: `${rowCount} row(s).\n\n${tableStr}` }],
            structuredContent: { count: rowCount, rows }
          };
        }

        return {
          content: [{ type: 'text', text: `${rowCount} row(s).` }],
          structuredContent: { count: rowCount, rows: Array.isArray(rows) ? rows : [rows] }
        };
      } catch (err) {
        throw new Error(`SQL error: ${err.message}`);
      }
    }
  );

  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server ready');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('Shutting down...');
    closeDatabase();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('Shutting down...');
    closeDatabase();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[ra-h-standalone] Fatal error:', error);
  process.exit(1);
});
