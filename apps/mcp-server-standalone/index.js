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

const { initDatabase, getDatabasePath, closeDatabase, getDb, query } = require('./services/sqlite-client');
const nodeService = require('./services/nodeService');
const edgeService = require('./services/edgeService');
const dimensionService = require('./services/dimensionService');
const skillService = require('./services/skillService');

// Server info
const serverInfo = {
  name: 'ra-h-standalone',
  version: '1.8.0'
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
1. Call getContext for orientation (stats, hubs, dimensions).
2. For simple tasks, tool descriptions have everything you need.
3. For complex tasks, call readSkill("db-operations").

## Knowledge capture
Proactively offer to save valuable information when insights, decisions, or references surface.
Propose: "I'd add this as: [title] in [dimensions] — want me to?"
Always search before creating to avoid duplicates.

## Available skills
${skillIndex}
Load any skill with readSkill("name").

All data stays on this device.`;
}

// Tool schemas
const addNodeInputSchema = {
  title: z.string().min(1).max(160).describe('Clear, descriptive title'),
  content: z.string().max(20000).optional().describe('Legacy content field; mapped to source'),
  source: z.string().max(50000).optional().describe('Full source text'),
  link: z.string().url().optional().describe('Source URL'),
  description: z.string().min(24).max(280).describe('REQUIRED. One-sentence summary: WHAT this is (explicit, concrete) + WHY it matters. No weak verbs (discusses, explores, examines). Example: "Podcast — Lex Fridman interviews Sam Altman on AGI timelines. First public comments since board drama."'),
  dimensions: z.array(z.string()).min(1).max(5).describe('1-5 categories. Call queryDimensions first to use existing ones.'),
  metadata: z.record(z.any()).optional().describe('Additional metadata'),
  chunk: z.string().max(50000).optional().describe('Full source text')
};

const searchNodesInputSchema = {
  query: z.string().min(1).max(400).describe('Search query'),
  limit: z.number().min(1).max(25).optional().describe('Max results (default 10)'),
  dimensions: z.array(z.string()).max(5).optional().describe('Filter by dimensions'),
  created_after: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes created on or after this date.'),
  created_before: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes created before this date.'),
  event_after: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes with event_date on or after this date.'),
  event_before: z.string().optional().describe('ISO date (YYYY-MM-DD). Only return nodes with event_date before this date.')
};

const getNodesInputSchema = {
  nodeIds: z.array(z.number().int().positive()).min(1).max(10).describe('Node IDs to load')
};

const updateNodeInputSchema = {
  id: z.number().int().positive().describe('Node ID'),
  updates: z.object({
    title: z.string().optional().describe('New title'),
    description: z.string().min(24).max(280).describe('REQUIRED. Explicitly state WHAT this is (podcast, conversation summary, user insight, etc.) + WHY it matters for context grounding. No vague verbs like "discusses/explores/examines".'),
    content: z.string().optional().describe('Content to APPEND'),
    link: z.string().optional().describe('New link'),
    dimensions: z.array(z.string()).optional().describe('New dimensions (replaces existing)'),
    metadata: z.record(z.any()).optional().describe('New metadata')
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

const listDimensionsInputSchema = {};

const createDimensionInputSchema = {
  name: z.string().min(1).describe('Dimension name'),
  description: z.string().max(500).optional().describe('Description'),
  isPriority: z.boolean().optional().describe('Lock for auto-assignment')
};

const updateDimensionInputSchema = {
  name: z.string().min(1).describe('Current dimension name'),
  newName: z.string().optional().describe('New name (for renaming)'),
  description: z.string().max(500).optional().describe('New description'),
  isPriority: z.boolean().optional().describe('Lock/unlock dimension')
};

const deleteDimensionInputSchema = {
  name: z.string().min(1).describe('Dimension name to delete')
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

// Helper to sanitize dimensions
function sanitizeDimensions(raw) {
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
}

function validateExplicitDescription(description) {
  if (typeof description !== 'string') {
    return 'Description is required and must be a string.';
  }
  const text = description.trim();
  if (text.length < 24) {
    return 'Description must be explicit and substantial (at least 24 characters).';
  }
  const weakPatterns = /\b(discusses|explores|examines|talks about|is about|delves into)\b/i;
  const explicitEntityPatterns = /\b(article|artifact|book|brief|claim|company|concept|conversation|dataset|decision|dimension|document|episode|essay|event|guide|idea|insight|interview|lesson|link|node|note|paper|person|plan|placeholder|podcast|post|presentation|project|question|record|research|resource|skill|source|status|summary|talk|target|test node|thread|tool|transcript|tweet|update|video|website|workflow)\b/i;
  const uncertaintyPatterns = /\b(likely|probably|possibly|appears to be|seems to be|unclear|uncertain)\b/i;
  if (weakPatterns.test(text)) {
    return 'Description is too vague. State exactly what this is and why it matters.';
  }
  if (!explicitEntityPatterns.test(text) && !uncertaintyPatterns.test(text)) {
    return 'Description must explicitly identify what this thing is, or state uncertainty explicitly.';
  }
  return null;
}

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
      description: 'Get knowledge graph overview: stats, hub nodes (most connected), dimensions, recent activity, and available skills. Call this first to orient yourself. For deeper operating policy, follow up with readSkill("db-operations").',
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
          content: [{ type: 'text', text: 'Empty knowledge graph. This is a fresh start! Suggest adding the first node about something the user is working on or interested in.' }],
          structuredContent: {
            ...context,
            welcome: true,
            suggestion: 'Ask the user what they\'re working on or interested in, then create the first node.'
          }
        };
      }

      const summary = `Graph: ${context.stats.nodeCount} nodes, ${context.stats.edgeCount} edges, ${context.stats.dimensionCount} dimensions, ${skills.length} skills.`;
      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: context
      };
    }
  );

  // ========== NODE TOOLS ==========

  registerToolWithAliases(
    'createNode',
    {
      title: 'Add RA-H node',
      description: 'Create a new node. Always search first (queryNodes) to avoid duplicates. Title: max 160 chars, clear and descriptive. Description is REQUIRED and must be explicit about what the thing is and why it matters for contextual grounding. Use "link" ONLY for external content (URL, video, article) — omit for synthesis/ideas derived from existing nodes. "source" = verbatim or canonical content for embedding. Legacy "content" and "chunk" are mapped to source for compatibility. Assign 1-5 dimensions — call queryDimensions first to use existing ones.',
      inputSchema: addNodeInputSchema
    },
    async ({ title, content, source, link, description, dimensions, metadata, chunk }) => {
      const normalizedDimensions = sanitizeDimensions(dimensions);
      if (normalizedDimensions.length === 0) {
        throw new Error('At least one dimension is required.');
      }
      const descriptionError = validateExplicitDescription(description);
      if (descriptionError) {
        throw new Error(descriptionError);
      }

      const node = nodeService.createNode({
        title: title.trim(),
        source: source?.trim() || chunk?.trim() || content?.trim(),
        link: link?.trim(),
        description: description?.trim(),
        dimensions: normalizedDimensions,
        metadata: metadata || {}
      });

      const summary = `Created node #${node.id}: ${node.title} [${node.dimensions.join(', ')}]`;

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: {
          nodeId: node.id,
          title: node.title,
          dimensions: node.dimensions,
          message: summary
        }
      };
    }
  );

  registerToolWithAliases(
    'queryNodes',
    {
      title: 'Search RA-H nodes',
      description: 'Search nodes by keyword across title, description, and source fields. Multi-word queries find nodes containing all words (not exact phrases). Returns up to 25 results (default 10). Call before creating nodes to check for duplicates. Optionally filter by dimensions. NOT for searching source documents (transcripts, articles) — use searchContentEmbeddings for that.',
      inputSchema: searchNodesInputSchema
    },
    async ({ query: searchQuery, limit = 10, dimensions, created_after, created_before, event_after, event_before }) => {
      const normalizedDimensions = sanitizeDimensions(dimensions || []);
      const safeLimit = Math.min(Math.max(limit, 1), 25);
      const trimmedQuery = searchQuery.trim();
      const fts = checkFtsAvailability();

      // Build temporal filter clauses
      const temporalClauses = [];
      const temporalParams = [];
      if (created_after) { temporalClauses.push('n.created_at >= ?'); temporalParams.push(created_after); }
      if (created_before) { temporalClauses.push('n.created_at < ?'); temporalParams.push(created_before); }
      if (event_after) { temporalClauses.push('n.event_date >= ?'); temporalParams.push(event_after); }
      if (event_before) { temporalClauses.push('n.event_date < ?'); temporalParams.push(event_before); }
      const temporalSQL = temporalClauses.length > 0 ? temporalClauses.map(c => `AND ${c}`).join(' ') : '';

      let nodes = null;

      // Try FTS5 first (handles multi-word queries naturally)
      if (fts.nodes) {
        const ftsQuery = sanitizeFtsQuery(trimmedQuery);
        if (ftsQuery) {
          try {
            let sql, params;

            if (normalizedDimensions.length > 0) {
              sql = `
                WITH fts_matches AS (
                  SELECT rowid, rank FROM nodes_fts WHERE nodes_fts MATCH ? LIMIT 100
                )
                SELECT n.id, n.title, n.description, n.source, n.link,
                       n.created_at, n.updated_at, n.event_date,
                       COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                                 FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json
                FROM fts_matches fm
                JOIN nodes n ON n.id = fm.rowid
                WHERE EXISTS (
                  SELECT 1 FROM node_dimensions nd
                  WHERE nd.node_id = n.id
                  AND nd.dimension IN (${normalizedDimensions.map(() => '?').join(',')})
                )
                ${temporalSQL}
                ORDER BY fm.rank
                LIMIT ?
              `;
              params = [ftsQuery, ...normalizedDimensions, ...temporalParams, safeLimit];
            } else {
              sql = `
                WITH fts_matches AS (
                  SELECT rowid, rank FROM nodes_fts WHERE nodes_fts MATCH ? LIMIT ?
                )
                SELECT n.id, n.title, n.description, n.source, n.link,
                       n.created_at, n.updated_at, n.event_date,
                       COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                                 FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json
                FROM fts_matches fm
                JOIN nodes n ON n.id = fm.rowid
                ${temporalSQL ? 'WHERE ' + temporalClauses.join(' AND ') : ''}
                ORDER BY fm.rank
              `;
              params = [ftsQuery, safeLimit, ...temporalParams];
            }

            const rows = query(sql, params);
            nodes = rows.map(row => ({
              id: row.id,
              title: row.title,
              source: row.source ?? null,
              description: row.description ?? null,
              link: row.link ?? null,
              dimensions: JSON.parse(row.dimensions_json || '[]'),
              created_at: row.created_at,
              updated_at: row.updated_at,
              event_date: row.event_date ?? null
            }));
          } catch (err) {
            log('FTS search failed, falling back to LIKE:', err.message);
            nodes = null;
          }
        }
      }

      // Fallback: LIKE with word splitting (each word must appear somewhere)
      if (nodes === null) {
        const words = trimmedQuery.split(/\s+/).filter(w => w.length > 0);

        let sql = `
          SELECT n.id, n.title, n.description, n.source, n.link,
                 n.created_at, n.updated_at, n.event_date,
                 COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                           FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json
          FROM nodes n
          WHERE 1=1
        `;
        const params = [];

        for (const word of words) {
          sql += ` AND (n.title LIKE ? COLLATE NOCASE OR n.description LIKE ? COLLATE NOCASE OR n.source LIKE ? COLLATE NOCASE)`;
          params.push(`%${word}%`, `%${word}%`, `%${word}%`);
        }

        if (normalizedDimensions.length > 0) {
          sql += ` AND EXISTS (
            SELECT 1 FROM node_dimensions nd
            WHERE nd.node_id = n.id
            AND nd.dimension IN (${normalizedDimensions.map(() => '?').join(',')})
          )`;
          params.push(...normalizedDimensions);
        }

        // Temporal filters
        if (temporalSQL) {
          sql += ` ${temporalSQL}`;
          params.push(...temporalParams);
        }

        sql += ` ORDER BY n.updated_at DESC LIMIT ?`;
        params.push(safeLimit);

        const rows = query(sql, params);
        nodes = rows.map(row => ({
          id: row.id,
          title: row.title,
          source: row.source ?? null,
          description: row.description ?? null,
          link: row.link ?? null,
          dimensions: JSON.parse(row.dimensions_json || '[]'),
          created_at: row.created_at,
          updated_at: row.updated_at,
          event_date: row.event_date ?? null
        }));
      }

      const summary = nodes.length === 0
        ? 'No nodes found matching that query.'
        : `Found ${nodes.length} node(s).`;

      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: {
          count: nodes.length,
          nodes
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
          const rawChunk = node.source ?? null;
          const chunkTruncated = rawChunk ? rawChunk.length > CHUNK_LIMIT : false;

          nodes.push({
            id: node.id,
            title: node.title,
            source: node.source ?? null,
            description: node.description ?? null,
            link: node.link ?? null,
            chunk: chunkTruncated ? rawChunk.substring(0, CHUNK_LIMIT) : rawChunk,
            chunk_truncated: chunkTruncated,
            chunk_length: rawChunk ? rawChunk.length : 0,
            dimensions: node.dimensions || [],
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
      description: 'Update an existing node. Description is REQUIRED on every update and must explicitly state WHAT this thing is + WHY it matters for contextual grounding. Source content lives in "source". Legacy "content" and "chunk" are mapped to source for compatibility. Dimensions are REPLACED entirely with the new array. Title, description, and link are overwritten. Call getNodesById first to verify current state before updating.',
      inputSchema: updateNodeInputSchema
    },
    async ({ id, updates }) => {
      if (!updates || Object.keys(updates).length === 0) {
        throw new Error('At least one field must be provided in updates.');
      }
      if (!updates.description) {
        throw new Error('Every node update requires an explicit description (WHAT this is + WHY it matters).');
      }
      const descriptionError = validateExplicitDescription(updates.description);
      if (descriptionError) {
        throw new Error(descriptionError);
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

      const node = nodeService.updateNode(id, mappedUpdates);

      return {
        content: [{ type: 'text', text: `Updated node #${id}` }],
        structuredContent: {
          success: true,
          nodeId: node.id,
          message: `Updated node #${id}`
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
    'queryDimensions',
    {
      title: 'List RA-H dimensions',
      description: 'Get all dimensions with node counts. Call before creating nodes (to assign existing dimensions) or before creating new dimensions (to avoid duplicates). Shows priority/locked status.',
      inputSchema: listDimensionsInputSchema
    },
    async () => {
      const dimensions = dimensionService.getDimensions();

      return {
        content: [{ type: 'text', text: `Found ${dimensions.length} dimension(s).` }],
        structuredContent: {
          count: dimensions.length,
          dimensions
        }
      };
    }
  );

  registerToolWithAliases(
    'createDimension',
    {
      title: 'Create RA-H dimension',
      description: 'Create a new dimension/category. Use lowercase, singular form (e.g. "biology" not "Biology" or "biologies"). Set isPriority=true to lock it for automatic assignment to new nodes. Always include a description.',
      inputSchema: createDimensionInputSchema
    },
    async ({ name, description, isPriority }) => {
      const dimension = dimensionService.createDimension({
        name,
        description,
        isPriority
      });

      return {
        content: [{ type: 'text', text: `Created dimension: ${dimension.dimension}` }],
        structuredContent: {
          success: true,
          dimension: dimension.dimension,
          message: `Created dimension: ${dimension.dimension}`
        }
      };
    }
  );

  registerToolWithAliases(
    'updateDimension',
    {
      title: 'Update RA-H dimension',
      description: 'Update or rename a dimension.',
      inputSchema: updateDimensionInputSchema
    },
    async ({ name, newName, description, isPriority }) => {
      const result = dimensionService.updateDimension({
        name,
        currentName: name,
        newName,
        description,
        isPriority
      });

      return {
        content: [{ type: 'text', text: `Updated dimension: ${result.dimension}` }],
        structuredContent: {
          success: true,
          dimension: result.dimension,
          message: `Updated dimension: ${result.dimension}`
        }
      };
    }
  );

  registerToolWithAliases(
    'deleteDimension',
    {
      title: 'Delete RA-H dimension',
      description: 'Delete a dimension and remove it from all nodes. WARNING: This is destructive — the dimension will be removed from ALL nodes that use it. Consider checking node counts with queryDimensions first.',
      inputSchema: deleteDimensionInputSchema
    },
    async ({ name }) => {
      const result = dimensionService.deleteDimension(name);

      return {
        content: [{ type: 'text', text: `Deleted dimension: ${name}` }],
        structuredContent: {
          success: true,
          message: `Deleted dimension: ${name}`
        }
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
      description: 'Execute read-only SQL queries against the knowledge graph database. Tables: nodes, edges, dimensions, node_dimensions, chunks. Use PRAGMA table_info(tablename) for schema. Only SELECT/WITH/PRAGMA allowed. Use when structured tools are insufficient — e.g., complex JOINs, aggregations, or custom filtering. Read readSkill("db-operations") for table definitions and query patterns.',
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
