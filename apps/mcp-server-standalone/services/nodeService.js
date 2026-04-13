'use strict';

const { query, transaction, getDb } = require('./sqlite-client');
const contextService = require('./contextService');

function parseMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    } catch {
      return {};
    }
  }
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
}

function normalizeString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildCanonicalMetadata({ existing, metadata }) {
  const prior = parseMetadata(existing);
  const incoming = parseMetadata(metadata);
  const sourceMetadata = {
    ...(prior.source_metadata && typeof prior.source_metadata === 'object' ? prior.source_metadata : {}),
    ...(incoming.source_metadata && typeof incoming.source_metadata === 'object' ? incoming.source_metadata : {}),
  };

  const merged = {
    ...prior,
    ...incoming,
    state: incoming.state === 'processed' ? 'processed' : (prior.state === 'processed' ? 'processed' : 'not_processed'),
    captured_by: incoming.captured_by || prior.captured_by || 'human',
    source_metadata: sourceMetadata,
  };

  const type = normalizeString(incoming.type) || normalizeString(prior.type);
  const capturedMethod = normalizeString(incoming.captured_method) || normalizeString(prior.captured_method);

  if (type) merged.type = type;
  else delete merged.type;

  if (capturedMethod) merged.captured_method = capturedMethod;
  else delete merged.captured_method;

  return merged;
}

function mapNodeRow(row) {
  return {
    ...row,
    metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
    context: row.context_json ? JSON.parse(row.context_json) : null,
    context_json: undefined,
  };
}

/**
 * Get nodes with optional filtering.
 */
function getNodes(filters = {}) {
  const { search, limit = 100, offset = 0, contextId } = filters;

  let sql = `
    SELECT n.id, n.title, n.description, n.source, n.link, n.event_date, n.metadata,
           n.created_at, n.updated_at, n.context_id,
           CASE
             WHEN c.id IS NULL THEN NULL
             ELSE json_object('id', c.id, 'name', c.name, 'description', c.description, 'icon', c.icon)
           END as context_json
    FROM nodes n
    LEFT JOIN contexts c ON c.id = n.context_id
    WHERE 1=1
  `;
  const params = [];

  // Text search
  if (search) {
    sql += ` AND (n.title LIKE ? COLLATE NOCASE OR n.description LIKE ? COLLATE NOCASE OR n.source LIKE ? COLLATE NOCASE)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (contextId !== undefined) {
    sql += ' AND n.context_id = ?';
    params.push(contextId);
  }

  // Sort by search relevance or updated_at
  if (search) {
    sql += ` ORDER BY
      CASE WHEN LOWER(n.title) = LOWER(?) THEN 1 ELSE 6 END,
      CASE WHEN LOWER(n.title) LIKE LOWER(?) THEN 2 ELSE 6 END,
      CASE WHEN n.title LIKE ? COLLATE NOCASE THEN 3 ELSE 6 END,
      CASE WHEN n.description LIKE ? COLLATE NOCASE THEN 4 ELSE 6 END,
      n.updated_at DESC`;
    params.push(search, `${search}%`, `%${search}%`, `%${search}%`);
  } else {
    sql += ' ORDER BY n.updated_at DESC';
  }

  sql += ` LIMIT ?`;
  params.push(limit);

  if (offset > 0) {
    sql += ` OFFSET ?`;
    params.push(offset);
  }

  const rows = query(sql, params);

  return rows.map(mapNodeRow);
}

/**
 * Search nodes using the same filter object as getNodes.
 */
function searchNodes(filters = {}) {
  if (typeof filters === 'string') {
    return getNodes({ search: filters });
  }
  return getNodes(filters);
}

/**
 * Get a single node by ID.
 */
function getNodeById(id) {
  const sql = `
    SELECT n.id, n.title, n.description, n.source, n.link, n.event_date, n.metadata,
           n.created_at, n.updated_at, n.context_id,
           CASE
             WHEN c.id IS NULL THEN NULL
             ELSE json_object('id', c.id, 'name', c.name, 'description', c.description, 'icon', c.icon)
           END as context_json
    FROM nodes n
    LEFT JOIN contexts c ON c.id = n.context_id
    WHERE n.id = ?
  `;

  const rows = query(sql, [id]);
  if (rows.length === 0) return null;

  const row = rows[0];
  return mapNodeRow(row);
}

/**
 * Sanitize title — strip extraction artifacts.
 */
function sanitizeTitle(title) {
  let clean = title.trim();
  if (clean.startsWith('Title: ')) clean = clean.slice(7);
  if (clean.endsWith(' / X')) clean = clean.slice(0, -4);
  clean = clean.replace(/\s+/g, ' ');
  return clean.slice(0, 160);
}

/**
 * Create a new node.
 */
function createNode(nodeData) {
  const {
    title: rawTitle,
    description,
    source,
    link,
    event_date,
    metadata = {},
    context_id
  } = nodeData;

  const title = sanitizeTitle(rawTitle);

  const canonicalMetadata = buildCanonicalMetadata({ metadata });
  const now = new Date().toISOString();
  const db = getDb();

  const sourceToStore = source ?? ([title, description].filter(Boolean).join('\n\n').trim() || null);
  const effectiveContextId = context_id ?? null;

  const nodeId = transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO nodes (title, description, source, link, event_date, metadata, context_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      title,
      description ?? null,
      sourceToStore,
      link ?? null,
      event_date ?? null,
      JSON.stringify(canonicalMetadata),
      effectiveContextId ?? null,
      now,
      now
    );

    const id = Number(result.lastInsertRowid);

    return id;
  });

  return getNodeById(nodeId);
}

/**
 * Update an existing node.
 */
function updateNode(id, updates, options = {}) {
  const { title, description, source, link, event_date, metadata } = updates;
  const now = new Date().toISOString();
  const db = getDb();

  // Check node exists
  const existing = getNodeById(id);
  if (!existing) {
    throw new Error(`Node with ID ${id} not found. Use rah_search_nodes to find nodes by keyword.`);
  }

  const mergedMetadata = metadata !== undefined
    ? buildCanonicalMetadata({ existing: existing.metadata, metadata })
    : undefined;

  transaction(() => {
    const setFields = [];
    const params = [];

    if (title !== undefined) {
      setFields.push('title = ?');
      params.push(title);
    }
    if (description !== undefined) {
      setFields.push('description = ?');
      params.push(description);
    }
    if (source !== undefined) {
      setFields.push('source = ?');
      params.push(source);
    }
    if (link !== undefined) {
      setFields.push('link = ?');
      params.push(link);
    }
    if (event_date !== undefined) {
      setFields.push('event_date = ?');
      params.push(event_date);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'context_id')) {
      setFields.push('context_id = ?');
      params.push(updates.context_id ?? null);
    }
    if (mergedMetadata !== undefined) {
      setFields.push('metadata = ?');
      params.push(JSON.stringify(mergedMetadata));
    }

    // Always update timestamp
    setFields.push('updated_at = ?');
    params.push(now);
    params.push(id);

    if (setFields.length > 1) {
      const stmt = db.prepare(`UPDATE nodes SET ${setFields.join(', ')} WHERE id = ?`);
      stmt.run(...params);
    }

  });

  return getNodeById(id);
}

/**
 * Delete a node.
 */
function deleteNode(id) {
  const result = query('DELETE FROM nodes WHERE id = ?', [id]);
  if (result.changes === 0) {
    throw new Error(`Node with ID ${id} not found. Use rah_search_nodes to find nodes by keyword.`);
  }
  return true;
}

/**
 * Get node count.
 */
function getNodeCount() {
  const rows = query('SELECT COUNT(*) as count FROM nodes');
  return Number(rows[0].count);
}

/**
 * Get knowledge graph context overview.
 * Returns stats, contexts, hub nodes, and recent activity.
 */
function getContext() {
  const nodeCount = query('SELECT COUNT(*) as count FROM nodes')[0].count;
  const edgeCount = query('SELECT COUNT(*) as count FROM edges')[0].count;

  const recentNodes = query(`
    SELECT n.id, n.title, n.description
    FROM nodes n
    ORDER BY n.created_at DESC
    LIMIT 5
  `);

  const hubNodes = query(`
    SELECT n.id, n.title, n.description, COUNT(e.id) as edge_count
    FROM nodes n
    LEFT JOIN edges e ON n.id = e.from_node_id OR n.id = e.to_node_id
    GROUP BY n.id
    ORDER BY edge_count DESC
    LIMIT 5
  `);

  return {
    stats: { nodeCount, edgeCount, dimensionCount: 0, contextCount: contextService.listContexts().length },
    contexts: contextService.listContexts(),
    recentNodes,
    hubNodes
  };
}

module.exports = {
  getNodes,
  searchNodes,
  getNodeById,
  createNode,
  updateNode,
  deleteNode,
  getNodeCount,
  getContext
};
