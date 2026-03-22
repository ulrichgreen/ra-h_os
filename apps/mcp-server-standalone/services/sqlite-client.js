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

    // Create core schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY,
        title TEXT,
        description TEXT,
        source TEXT,
        link TEXT,
        event_date TEXT,
        created_at TEXT,
        updated_at TEXT,
        metadata TEXT,
        embedding BLOB,
        embedding_updated_at TEXT,
        embedding_text TEXT,
        chunk_status TEXT DEFAULT 'not_chunked'
      );

      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY,
        from_node_id INTEGER NOT NULL,
        to_node_id INTEGER NOT NULL,
        source TEXT,
        created_at TEXT,
        context TEXT,
        explanation TEXT,
        FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (to_node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id);
      CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node_id);

      CREATE TABLE IF NOT EXISTS node_dimensions (
        node_id INTEGER NOT NULL,
        dimension TEXT NOT NULL,
        PRIMARY KEY (node_id, dimension),
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS idx_dim_by_dimension ON node_dimensions(dimension, node_id);
      CREATE INDEX IF NOT EXISTS idx_dim_by_node ON node_dimensions(node_id, dimension);

      CREATE TABLE IF NOT EXISTS dimensions (
        name TEXT PRIMARY KEY,
        description TEXT,
        icon TEXT,
        is_priority INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Seed default dimensions
      INSERT OR IGNORE INTO dimensions (name, is_priority) VALUES ('research', 1);
      INSERT OR IGNORE INTO dimensions (name, is_priority) VALUES ('ideas', 1);
      INSERT OR IGNORE INTO dimensions (name, is_priority) VALUES ('projects', 1);
      INSERT OR IGNORE INTO dimensions (name, is_priority) VALUES ('memory', 1);
      INSERT OR IGNORE INTO dimensions (name, is_priority) VALUES ('preferences', 1);
    `);

    console.error('[RA-H] Database created successfully');
  } else {
    db = new Database(dbPath);
  }

  // Configure SQLite for performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = 5000');
  db.pragma('busy_timeout = 5000');

  const nodeCols = db.prepare('PRAGMA table_info(nodes)').all().map(c => c.name);
  if (!nodeCols.includes('source')) {
    db.exec('ALTER TABLE nodes ADD COLUMN source TEXT;');
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

  const edgeCols = db.prepare('PRAGMA table_info(edges)').all().map(c => c.name);
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

  return db;
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
