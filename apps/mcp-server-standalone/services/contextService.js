'use strict';

const { getDb } = require('./sqlite-client');
const MAX_CONTEXTS_PER_ACCOUNT = 10;

function mapContext(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    icon: row.icon ?? null,
    count: Number(row.count ?? 0),
  };
}

function listContexts() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.id, c.name, c.description, c.icon, COUNT(n.id) AS count
    FROM contexts c
    LEFT JOIN nodes n ON n.context_id = c.id
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE ASC
  `).all();
  return rows.map(mapContext);
}

function getContextById(id) {
  const db = getDb();
  const row = db.prepare(`
    SELECT c.id, c.name, c.description, c.icon, COUNT(n.id) AS count
    FROM contexts c
    LEFT JOIN nodes n ON n.context_id = c.id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(id);
  return mapContext(row);
}

function getContextByName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return null;
  const db = getDb();
  const row = db.prepare(`
    SELECT c.id, c.name, c.description, c.icon, COUNT(n.id) AS count
    FROM contexts c
    LEFT JOIN nodes n ON n.context_id = c.id
    WHERE lower(c.name) = lower(?)
    GROUP BY c.id
  `).get(trimmed);
  return mapContext(row);
}

function createContext({ name, description = null, icon = null }) {
  const db = getDb();
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    throw new Error('Context name is required.');
  }
  const existingCount = Number(db.prepare('SELECT COUNT(*) AS count FROM contexts').get()?.count ?? 0);
  if (existingCount >= MAX_CONTEXTS_PER_ACCOUNT) {
    throw new Error(`Context limit reached. Maximum ${MAX_CONTEXTS_PER_ACCOUNT} contexts are allowed per account.`);
  }

  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO contexts (name, description, icon, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(trimmedName, description ?? null, icon ?? null, now, now);

  return getContextById(Number(info.lastInsertRowid));
}

function updateContext({ id, name, description, icon }) {
  const db = getDb();
  const existing = getContextById(id);
  if (!existing) {
    throw new Error(`Context ${id} not found.`);
  }

  const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
  const nextDescription = description === undefined ? existing.description : description;
  const nextIcon = icon === undefined ? existing.icon : icon;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE contexts
    SET name = ?, description = ?, icon = ?, updated_at = ?
    WHERE id = ?
  `).run(nextName, nextDescription ?? null, nextIcon ?? null, now, id);

  return getContextById(id);
}

function resolveContextId(input = {}) {
  const hasContextId = Object.prototype.hasOwnProperty.call(input, 'context_id');
  const hasContextName = typeof input.context_name === 'string' && input.context_name.trim().length > 0;

  if (!hasContextId && !hasContextName) {
    return undefined;
  }

  if (hasContextId && input.context_id === null) {
    if (hasContextName) {
      throw new Error('context_name cannot be combined with context_id: null.');
    }
    return null;
  }

  let resolvedById = null;
  if (hasContextId) {
    resolvedById = getContextById(input.context_id);
    if (!resolvedById) {
      throw new Error(`Context ${input.context_id} not found.`);
    }
  }

  if (!hasContextName) {
    return resolvedById ? resolvedById.id : undefined;
  }

  const byName = getContextByName(input.context_name);
  if (!byName) {
    throw new Error(`Context "${input.context_name}" not found.`);
  }
  if (resolvedById && resolvedById.id !== byName.id) {
    throw new Error('context_id and context_name refer to different contexts.');
  }
  return byName.id;
}

module.exports = {
  MAX_CONTEXTS_PER_ACCOUNT,
  listContexts,
  getContextById,
  getContextByName,
  createContext,
  updateContext,
  resolveContextId,
};
