#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const repoDir = process.cwd();
const envTemplate = path.join(repoDir, '.env.example');
const targetEnv = path.join(repoDir, '.env.local');

function log(message) {
  console.log(`[bootstrap-local] ${message}`);
}

function getDefaultDbPath() {
  const homeDir = os.homedir();

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, 'RA-H', 'db', 'rah.sqlite');
  }

  if (process.platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'RA-H', 'db', 'rah.sqlite');
  }

  return path.join(
    process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'),
    'RA-H',
    'db',
    'rah.sqlite'
  );
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) return acc;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

function expandPath(rawPath) {
  let value = rawPath;

  if (value.startsWith('~')) {
    value = path.join(os.homedir(), value.slice(1));
  }

  value = value.replace(/\$HOME/g, os.homedir());
  value = value.replace(/%APPDATA%/g, process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'));

  return path.resolve(value);
}

function ensureEnvFile() {
  if (!fs.existsSync(envTemplate)) {
    throw new Error(`Missing ${envTemplate}`);
  }

  if (fs.existsSync(targetEnv)) {
    log('.env.local already exists; leaving it untouched.');
    return;
  }

  fs.copyFileSync(envTemplate, targetEnv);
  log('Created .env.local from .env.example');
}

function ensureCoreSchema(db) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'executor',
      system_prompt TEXT NOT NULL,
      available_tools TEXT NOT NULL,
      model TEXT NOT NULL,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      memory TEXT,
      prompts TEXT
    );

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

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      node_id INTEGER NOT NULL,
      chunk_idx INTEGER,
      text TEXT,
      created_at TEXT,
      embedding_type TEXT DEFAULT 'text-embedding-3-small',
      metadata TEXT,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_by_node ON chunks(node_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_by_node_idx ON chunks(node_id, chunk_idx);

    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY,
      from_node_id INTEGER NOT NULL,
      to_node_id INTEGER NOT NULL,
      source TEXT,
      created_at TEXT,
      context TEXT,
      FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node_id);

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY,
      chat_type TEXT,
      helper_name TEXT,
      agent_type TEXT DEFAULT 'orchestrator',
      delegation_id INTEGER,
      user_message TEXT,
      assistant_message TEXT,
      thread_id TEXT,
      focused_node_id INTEGER,
      created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
      metadata TEXT,
      FOREIGN KEY (focused_node_id) REFERENCES nodes(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chats_thread ON chats(thread_id);

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

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY,
      ts TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      table_name TEXT NOT NULL,
      action TEXT NOT NULL,
      row_id INTEGER NOT NULL,
      summary TEXT,
      enriched_summary TEXT,
      snapshot_json TEXT
    );

    CREATE TABLE IF NOT EXISTS voice_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER,
      session_id TEXT,
      helper_name TEXT,
      request_id TEXT,
      message_id TEXT,
      voice TEXT,
      model TEXT,
      chars INTEGER,
      cost_usd REAL,
      duration_ms INTEGER,
      text_preview TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_voice_usage_session ON voice_usage(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_voice_usage_chat ON voice_usage(chat_id);
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
      title,
      source,
      description,
      content='nodes',
      content_rowid='id'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      content='chunks',
      content_rowid='id'
    );
  `);

  const now = new Date().toISOString();
  const lockedDimensions = ['research', 'ideas', 'projects', 'memory', 'preferences'];
  const insertDimension = db.prepare(`
    INSERT INTO dimensions (name, is_priority, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(name) DO UPDATE SET is_priority = 1, updated_at = excluded.updated_at
  `);
  for (const dimension of lockedDimensions) {
    insertDimension.run(dimension, now);
  }

  const agentCount = Number(db.prepare('SELECT COUNT(*) as count FROM agents').get().count || 0);
  if (agentCount === 0) {
    db.prepare(`
      INSERT INTO agents (
        key, display_name, role, system_prompt, available_tools, model, description, enabled, created_at, updated_at, prompts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      'ra-h',
      'ra-h',
      'orchestrator',
      "You are ra-h, the main orchestrator for RA-H. Coordinate work, delegate to mini ra-hs when tasks can be isolated, and keep the conversation focused on the user's goals.",
      '["queryNodes","createNode","updateNode","createEdge","queryEdge","updateEdge","searchContentEmbeddings","webSearch","think","delegateToMiniRAH"]',
      'anthropic/claude-sonnet-4.5',
      'Opinionated orchestrator agent',
      now,
      now,
      '[{"id":"p_seed_0","name":"Summary of Focus","content":"Summarize the primary focused node clearly. Include 3–5 key points and cite [NODE:id:\\"title\\"]."},{"id":"p_seed_1","name":"Next Steps","content":"Propose 3 concrete next actions based on the focused nodes with references to [NODE:id:\\"title\\"]."}]'
    );
  }
}

function tryInitVectorTables(db, dbPath) {
  const extension = process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so';
  const extensionPath = process.env.SQLITE_VEC_EXTENSION_PATH || path.join(repoDir, 'vendor', 'sqlite-extensions', `vec0.${extension}`);

  try {
    db.loadExtension(extensionPath);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(
        node_id INTEGER PRIMARY KEY,
        embedding FLOAT[1536]
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding FLOAT[1536]
      );
    `);
    log(`Initialized sqlite-vec tables using ${extensionPath}`);
  } catch (error) {
    log(`sqlite-vec unavailable for bootstrap (${dbPath}). Continuing without vector tables.`);
  }
}

function main() {
  const major = Number(process.versions.node.split('.')[0] || '0');
  if (major < 20) {
    throw new Error(`Node.js 20+ required (found ${process.version})`);
  }

  ensureEnvFile();

  const env = parseEnvFile(targetEnv);
  const dbPath = expandPath(env.SQLITE_DB_PATH || getDefaultDbPath());
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.closeSync(fs.openSync(dbPath, 'w'));
  }

  const db = new Database(dbPath);
  try {
    ensureCoreSchema(db);
    tryInitVectorTables(db, dbPath);
  } finally {
    db.close();
  }

  log(`Bootstrap complete. Database ready at ${dbPath}`);
  log("Run 'npm run dev' to start the app.");
}

try {
  main();
} catch (error) {
  console.error(`[bootstrap-local] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
