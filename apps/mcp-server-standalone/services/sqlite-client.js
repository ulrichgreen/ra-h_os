'use strict';

const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * Get the database path.
 * Priority: RAH_DB_PATH env var > default app data location
 */
function getDatabasePath() {
  if (process.env.RAH_DB_PATH) {
    return process.env.RAH_DB_PATH;
  }

  // Default: ~/Library/Application Support/RA-H/db/rah.sqlite
  return path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'RA-H',
    'db',
    'rah.sqlite'
  );
}

let db = null;

/**
 * Initialize the database connection.
 * Call this once at startup.
 */
function initDatabase() {
  if (db) {
    return db;
  }

  const dbPath = getDatabasePath();

  // Auto-create database if it doesn't exist
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    console.error('[RA-H] Creating new database at:', dbPath);
    console.error('[RA-H] Database created successfully');
  } else {
    db = new Database(dbPath);
  }

  // Configure SQLite for performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = 5000');
  db.pragma('busy_timeout = 5000');

  ensureCoreSchema(db);

  // Migrations for existing databases
  const edgeCols = db.prepare('PRAGMA table_info(edges)').all().map(c => c.name);
  const nodeCols = db.prepare('PRAGMA table_info(nodes)').all().map(c => c.name);
  const contextCols = db.prepare('PRAGMA table_info(contexts)').all().map(c => c.name);

  let hasSourceColumn = nodeCols.includes('source');
  if (!hasSourceColumn) {
    db.exec('ALTER TABLE nodes ADD COLUMN source TEXT;');
    hasSourceColumn = true;
    console.error('[RA-H] Migrated nodes: added source column');
  }
  if (nodeCols.includes('content')) {
    db.exec(`
      UPDATE nodes
      SET source = content
      WHERE (source IS NULL OR LENGTH(TRIM(source)) = 0)
        AND content IS NOT NULL
        AND LENGTH(TRIM(content)) > 0;
    `);
  }
  if (nodeCols.includes('notes')) {
    db.exec(`
      UPDATE nodes
      SET source = notes
      WHERE (source IS NULL OR LENGTH(TRIM(source)) = 0)
        AND notes IS NOT NULL
        AND LENGTH(TRIM(notes)) > 0;
    `);
  }
  if (nodeCols.includes('chunk')) {
    db.exec(`
      UPDATE nodes
      SET source = chunk
      WHERE (source IS NULL OR LENGTH(TRIM(source)) = 0)
        AND chunk IS NOT NULL
        AND LENGTH(TRIM(chunk)) > 0;
    `);
  }
  if (hasSourceColumn) {
    db.exec(`
      UPDATE nodes
      SET source = title || CASE
        WHEN description IS NOT NULL AND LENGTH(TRIM(description)) > 0
          THEN char(10) || char(10) || description
        ELSE ''
      END
      WHERE source IS NULL OR LENGTH(TRIM(source)) = 0;
    `);
  }
  if (!edgeCols.includes('explanation')) {
    db.exec('ALTER TABLE edges ADD COLUMN explanation TEXT;');
    try {
      db.exec(`
        UPDATE edges SET explanation = json_extract(context, '$.explanation')
        WHERE explanation IS NULL AND json_extract(context, '$.explanation') IS NOT NULL;
      `);
    } catch {}
    console.error('[RA-H] Migrated edges: added explanation column');
  }

  if (!nodeCols.includes('context_id')) {
    db.exec('ALTER TABLE nodes ADD COLUMN context_id INTEGER REFERENCES contexts(id) ON DELETE SET NULL;');
    console.error('[RA-H] Migrated nodes: added context_id column');
  }

  if (!contextCols.includes('description')) {
    db.exec("ALTER TABLE contexts ADD COLUMN description TEXT NOT NULL DEFAULT '';");
  }
  if (!contextCols.includes('icon')) {
    db.exec('ALTER TABLE contexts ADD COLUMN icon TEXT;');
  }
  if (!contextCols.includes('created_at')) {
    db.exec("ALTER TABLE contexts ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
  }
  if (!contextCols.includes('updated_at')) {
    db.exec("ALTER TABLE contexts ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
  }

  db.exec(`
    UPDATE contexts
    SET description = COALESCE(NULLIF(TRIM(description), ''), name)
    WHERE description IS NULL OR LENGTH(TRIM(description)) = 0;
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contexts_name_normalized
      ON contexts(LOWER(TRIM(name)));
    CREATE INDEX IF NOT EXISTS idx_nodes_context_id ON nodes(context_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dimension_migration_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      dimension_count INTEGER NOT NULL,
      assignment_count INTEGER NOT NULL,
      payload TEXT
    );
  `);

  const hasLegacyDimensions = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dimensions'").get();
  const hasLegacyNodeDimensions = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='node_dimensions'").get();
  if (hasLegacyDimensions || hasLegacyNodeDimensions) {
    const snapshotCount = Number((db.prepare('SELECT COUNT(*) as count FROM dimension_migration_snapshots').get() || {}).count || 0);

    if (snapshotCount === 0) {
      const dimensionCount = hasLegacyDimensions
        ? Number((db.prepare('SELECT COUNT(*) as count FROM dimensions').get() || {}).count || 0)
        : 0;
      const assignmentCount = hasLegacyNodeDimensions
        ? Number((db.prepare('SELECT COUNT(*) as count FROM node_dimensions').get() || {}).count || 0)
        : 0;
      const payload = hasLegacyNodeDimensions
        ? ((db.prepare(`
            SELECT COALESCE(
              json_group_array(
                json_object(
                  'node_id', nd.node_id,
                  'dimension', nd.dimension,
                  'description', d.description,
                  'icon', d.icon,
                  'is_priority', d.is_priority
                )
              ),
              '[]'
            ) AS payload
            FROM node_dimensions nd
            LEFT JOIN dimensions d ON d.name = nd.dimension
          `).get() || {}).payload || '[]')
        : '[]';

      db.prepare(`
        INSERT INTO dimension_migration_snapshots (dimension_count, assignment_count, payload)
        VALUES (?, ?, ?)
      `).run(dimensionCount, assignmentCount, payload);
    }

    db.exec(`
      DROP INDEX IF EXISTS idx_dim_by_dimension;
      DROP INDEX IF EXISTS idx_dim_by_node;
      DROP TABLE IF EXISTS node_dimensions;
      DROP TABLE IF EXISTS dimensions;
    `);
  }

  return db;
}

function ensureCoreSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contexts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY,
      title TEXT,
      description TEXT,
      source TEXT,
      link TEXT,
      event_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      embedding BLOB,
      embedding_updated_at TEXT,
      embedding_text TEXT,
      chunk_status TEXT DEFAULT 'not_chunked',
      context_id INTEGER,
      FOREIGN KEY (context_id) REFERENCES contexts(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_contexts_name_normalized
      ON contexts(LOWER(TRIM(name)));
  `);

  ensureEdgesTableSchema(db);
}

function ensureEdgesTableSchema(db) {
  const hasEdgesTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edges'").get();

  if (!hasEdgesTable) {
    db.exec(`
      CREATE TABLE edges (
        id INTEGER PRIMARY KEY,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        source TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        context TEXT,
        explanation TEXT,
        FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (to_node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );
    `);
  } else {
    const edgeColNames = new Set(db.prepare('PRAGMA table_info(edges)').all().map((col) => col.name));
    const needsLegacyRewrite =
      !edgeColNames.has('from_node_id') ||
      !edgeColNames.has('to_node_id') ||
      !edgeColNames.has('source') ||
      !edgeColNames.has('created_at') ||
      !edgeColNames.has('context') ||
      edgeColNames.has('from_id') ||
      edgeColNames.has('to_id') ||
      edgeColNames.has('description') ||
      edgeColNames.has('updated_at');

    if (needsLegacyRewrite) {
      rebuildLegacyEdgesTable(db, edgeColNames);
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node_id);
  `);
}

function rebuildLegacyEdgesTable(db, edgeColNames) {
  const fromExpr = edgeColNames.has('from_node_id')
    ? 'from_node_id'
    : edgeColNames.has('from_id')
      ? 'from_id'
      : 'NULL';
  const toExpr = edgeColNames.has('to_node_id')
    ? 'to_node_id'
    : edgeColNames.has('to_id')
      ? 'to_id'
      : 'NULL';
  const sourceExpr = edgeColNames.has('source') ? 'source' : "'legacy'";
  const createdAtExpr = edgeColNames.has('created_at') ? 'created_at' : 'CURRENT_TIMESTAMP';
  const contextExpr = edgeColNames.has('context') ? 'context' : 'NULL';
  const explanationExpr = edgeColNames.has('explanation')
    ? 'explanation'
    : edgeColNames.has('description')
      ? 'description'
      : edgeColNames.has('context')
        ? "CASE WHEN json_valid(context) THEN json_extract(context, '$.explanation') ELSE NULL END"
        : 'NULL';

  console.error('[RA-H] Migrating legacy edges table to canonical schema');

  let flippedForeignKeys = false;
  try {
    db.exec('PRAGMA foreign_keys=OFF;');
    flippedForeignKeys = true;
  } catch {}

  try {
    db.exec('BEGIN TRANSACTION;');
    db.exec(`
      DROP INDEX IF EXISTS idx_edges_from;
      DROP INDEX IF EXISTS idx_edges_to;
      ALTER TABLE edges RENAME TO edges_legacy_migration;
      CREATE TABLE edges (
        id INTEGER PRIMARY KEY,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        source TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        context TEXT,
        explanation TEXT,
        FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (to_node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );
      INSERT INTO edges (id, from_node_id, to_node_id, source, created_at, context, explanation)
      SELECT
        id,
        ${fromExpr},
        ${toExpr},
        ${sourceExpr},
        COALESCE(${createdAtExpr}, CURRENT_TIMESTAMP),
        ${contextExpr},
        ${explanationExpr}
      FROM edges_legacy_migration
      WHERE ${fromExpr} IS NOT NULL
        AND ${toExpr} IS NOT NULL;
      DROP TABLE edges_legacy_migration;
      COMMIT;
    `);
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {}
    throw error;
  } finally {
    if (flippedForeignKeys) {
      try {
        db.exec('PRAGMA foreign_keys=ON;');
      } catch {}
    }
  }
}

/**
 * Get the database instance.
 * Throws if not initialized.
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Execute a query and return rows.
 */
function query(sql, params = []) {
  const database = getDb();
  const stmt = database.prepare(sql);

  const sqlLower = sql.trim().toLowerCase();
  if (sqlLower.startsWith('select') || sqlLower.startsWith('with') || sqlLower.startsWith('pragma') || sqlLower.includes('returning')) {
    return params.length > 0 ? stmt.all(...params) : stmt.all();
  } else {
    const result = params.length > 0 ? stmt.run(...params) : stmt.run();
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid)
    };
  }
}

/**
 * Execute a query in a transaction.
 */
function transaction(callback) {
  const database = getDb();
  const txn = database.transaction(callback);
  return txn();
}

/**
 * Close the database connection.
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  initDatabase,
  getDb,
  query,
  transaction,
  closeDatabase,
  getDatabasePath
};
