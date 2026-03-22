'use strict';

const { query, transaction, getDb } = require('./sqlite-client');

function normalizeDimensionName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getUnknownDimensions(dimensions) {
  if (!Array.isArray(dimensions) || dimensions.length === 0) return [];

  const normalized = dimensions
    .map(normalizeDimensionName)
    .filter(Boolean);

  if (normalized.length === 0) return [];

  const placeholders = normalized.map(() => '?').join(', ');
  const rows = query(`SELECT name FROM dimensions WHERE name IN (${placeholders})`, normalized);
  const existing = new Set(rows.map(row => normalizeDimensionName(row.name)));

  return normalized.filter(value => !existing.has(value));
}

function formatUnknownDimensionsError(values) {
  if (values.length === 1) {
    return `Unknown dimension: "${values[0]}". Create it first or use an existing dimension.`;
  }

  return `Unknown dimensions: ${values.map(value => `"${value}"`).join(', ')}. Create them first or use existing dimensions.`;
}

/**
 * Get nodes with optional filtering.
 */
function getNodes(filters = {}) {
  const { dimensions, search, limit = 100, offset = 0 } = filters;

  let sql = `
    SELECT n.id, n.title, n.description, n.source, n.link, n.event_date, n.metadata,
           n.created_at, n.updated_at,
           COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                     FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json
    FROM nodes n
    WHERE 1=1
  `;
  const params = [];

  // Filter by dimensions
  if (dimensions && dimensions.length > 0) {
    sql += ` AND EXISTS (
      SELECT 1 FROM node_dimensions nd
      WHERE nd.node_id = n.id
      AND nd.dimension IN (${dimensions.map(() => '?').join(',')})
    )`;
    params.push(...dimensions);
  }

  // Text search
  if (search) {
    sql += ` AND (n.title LIKE ? COLLATE NOCASE OR n.description LIKE ? COLLATE NOCASE OR n.source LIKE ? COLLATE NOCASE)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
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

  return rows.map(row => ({
    ...row,
    dimensions: JSON.parse(row.dimensions_json || '[]'),
    metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
    dimensions_json: undefined
  }));
}

/**
 * Get a single node by ID.
 */
function getNodeById(id) {
  const sql = `
    SELECT n.id, n.title, n.description, n.source, n.link, n.event_date, n.metadata,
           n.created_at, n.updated_at,
           COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                     FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json
    FROM nodes n
    WHERE n.id = ?
  `;

  const rows = query(sql, [id]);
  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    ...row,
    dimensions: JSON.parse(row.dimensions_json || '[]'),
    metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
    dimensions_json: undefined
  };
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
    dimensions = [],
    metadata = {}
  } = nodeData;

  const title = sanitizeTitle(rawTitle);
  const unknownDimensions = getUnknownDimensions(dimensions);
  if (unknownDimensions.length > 0) {
    throw new Error(formatUnknownDimensionsError(unknownDimensions));
  }

  const now = new Date().toISOString();
  const db = getDb();

  const sourceToStore = source && source.trim()
    ? source
    : [title, description].filter(Boolean).join('\n\n').trim() || null;

  const nodeId = transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO nodes (title, description, source, link, event_date, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      title,
      description ?? null,
      sourceToStore,
      link ?? null,
      event_date ?? null,
      JSON.stringify(metadata),
      now,
      now
    );

    const id = Number(result.lastInsertRowid);

    // Insert dimensions
    if (dimensions.length > 0) {
      const dimStmt = db.prepare(
        'INSERT OR IGNORE INTO node_dimensions (node_id, dimension) VALUES (?, ?)'
      );
      for (const dimension of dimensions) {
        dimStmt.run(id, dimension);
      }
    }

    return id;
  });

  return getNodeById(nodeId);
}

/**
 * Update an existing node.
 * Source-first update path.
 */
function updateNode(id, updates, options = {}) {
  const { title, description, source, link, event_date, dimensions, metadata } = updates;
  const now = new Date().toISOString();
  const db = getDb();

  // Check node exists
  const existing = getNodeById(id);
  if (!existing) {
    throw new Error(`Node with ID ${id} not found. Use rah_search_nodes to find nodes by keyword.`);
  }

  if (Array.isArray(dimensions)) {
    const unknownDimensions = getUnknownDimensions(dimensions);
    if (unknownDimensions.length > 0) {
      throw new Error(formatUnknownDimensionsError(unknownDimensions));
    }
  }

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
    if (metadata !== undefined) {
      setFields.push('metadata = ?');
      params.push(JSON.stringify(metadata));
    }

    // Always update timestamp
    setFields.push('updated_at = ?');
    params.push(now);
    params.push(id);

    if (setFields.length > 1) {
      const stmt = db.prepare(`UPDATE nodes SET ${setFields.join(', ')} WHERE id = ?`);
      stmt.run(...params);
    }

    // Handle dimensions separately
    if (Array.isArray(dimensions)) {
      db.prepare('DELETE FROM node_dimensions WHERE node_id = ?').run(id);
      const dimStmt = db.prepare('INSERT OR IGNORE INTO node_dimensions (node_id, dimension) VALUES (?, ?)');
      for (const dim of dimensions) {
        dimStmt.run(id, dim);
      }
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
 * Returns stats, hub nodes, dimensions, and recent activity.
 */
function getContext() {
  const nodeCount = query('SELECT COUNT(*) as count FROM nodes')[0].count;
  const edgeCount = query('SELECT COUNT(*) as count FROM edges')[0].count;

  const dimensionService = require('./dimensionService');
  const dimensions = dimensionService.getDimensions();

  const recentNodes = query(`
    SELECT n.id, n.title, n.description,
           GROUP_CONCAT(nd.dimension) as dimensions
    FROM nodes n
    LEFT JOIN node_dimensions nd ON n.id = nd.node_id
    GROUP BY n.id
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
    stats: { nodeCount, edgeCount, dimensionCount: dimensions.length },
    dimensions,
    recentNodes,
    hubNodes
  };
}

module.exports = {
  getNodes,
  getNodeById,
  createNode,
  updateNode,
  deleteNode,
  getNodeCount,
  getContext
};
