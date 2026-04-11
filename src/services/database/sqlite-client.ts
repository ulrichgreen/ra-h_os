import Database from 'better-sqlite3';
import { DatabaseError } from '@/types/database';
import {
  ensureDatabaseDirectory,
  getDatabasePath,
  getVecExtensionPath,
  loadVecExtension,
  type VectorCapability,
} from './sqlite-runtime';

export interface SQLiteConfig {
  dbPath: string;
  vecExtensionPath: string;
}

export interface SQLiteQueryResult<T = any> {
  rows: T[];
  changes?: number;
  lastInsertRowid?: number;
}

class SQLiteClient {
  private static instance: SQLiteClient;
  private db: Database.Database;
  private config: SQLiteConfig;
  private readonly readOnly: boolean;
  private readonly vectorCapability: VectorCapability;
  private nodesFtsUsable = true;
  private nodesFtsDisabledReason: string | null = null;

  private constructor() {
    this.config = this.getSQLiteConfig();
    this.readOnly = process.env.SQLITE_READONLY === 'true';
    
    // Initialize database connection
    if (!this.readOnly) {
      ensureDatabaseDirectory(this.config.dbPath);
    }
    this.db = this.readOnly
      ? new Database(this.config.dbPath, { readonly: true, fileMustExist: true })
      : new Database(this.config.dbPath);
    
    // Load sqlite-vec extension
    this.vectorCapability = loadVecExtension(this.db, this.config.vecExtensionPath);
    if (this.vectorCapability.available) {
      console.log('SQLite vector extension loaded successfully');
    } else {
      console.warn(`Warning: ${this.vectorCapability.reason}`);
    }

    // Configure SQLite settings
    if (this.readOnly) {
      try {
        this.db.pragma('query_only = ON');
      } catch (error) {
        console.warn('Failed to enable query_only pragma in read-only mode:', error);
      }
    } else {
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 10000');
      this.db.pragma('temp_store = memory');
      this.db.pragma('busy_timeout = 5000');

      this.ensureCoreSchema();
      // Ensure vector virtual tables are present and healthy
      if (this.vectorCapability.available) {
        this.ensureVectorTables();
        this.healVectorTablesIfCorrupt();
      }

      // Ensure logging schema (rename memory->logs if needed, create triggers/views)
      this.ensureLoggingAndMemorySchema();
      this.ensureContextsSchema();
    }

    console.log('SQLite client initialized successfully');
  }

  private getSQLiteConfig(): SQLiteConfig {
    return {
      dbPath: getDatabasePath(),
      vecExtensionPath: getVecExtensionPath(),
    };
  }

  public static getInstance(): SQLiteClient {
    if (!SQLiteClient.instance) {
      SQLiteClient.instance = new SQLiteClient();
    }
    return SQLiteClient.instance;
  }

  public query<T extends Record<string, any> = any>(
    sql: string, 
    params?: any[]
  ): SQLiteQueryResult<T> {
    try {
      const sqlLower = sql.trim().toLowerCase();
      
      // Handle different query types
      if (sqlLower.startsWith('select') || 
          sqlLower.startsWith('with') ||
          sqlLower.includes('returning')) {
        // SELECT queries and queries with RETURNING clause
        const stmt = this.db.prepare(sql);
        const rows = params ? stmt.all(...params) : stmt.all();
        return { rows: rows as T[] };
      } else {
        // INSERT/UPDATE/DELETE queries without RETURNING
        const stmt = this.db.prepare(sql);
        const result = params ? stmt.run(...params) : stmt.run();
        return { 
          rows: [],
          changes: result.changes,
          lastInsertRowid: Number(result.lastInsertRowid)
        };
      }
    } catch (error) {
      console.error('SQLite query error:', error);
      throw this.handleError(error);
    }
  }

  public prepare(sql: string) {
    return this.db.prepare(sql);
  }

  public transaction<T>(callback: () => T): T {
    if (this.readOnly) {
      throw {
        message: 'SQLite client is read-only',
        code: 'SQLITE_READONLY',
        details: 'Transactions are not allowed in read-only mode'
      } as DatabaseError;
    }
    // Proactively validate/repair vec vtables before any write transaction
    if (this.vectorCapability.available) {
      this.healVectorTablesIfCorrupt();
    }
    const txn = this.db.transaction(callback);
    try {
      return txn();
    } catch (error) {
      throw this.handleError(error);
    }
  }

  public async testConnection(): Promise<boolean> {
    try {
      const result = this.query('SELECT datetime() as current_time');
      return result.rows.length > 0;
    } catch (error) {
      console.error('SQLite connection test failed:', error);
      return false;
    }
  }

  public async checkVectorExtension(): Promise<boolean> {
    return this.vectorCapability.available;
  }

  public getVectorCapability(): VectorCapability {
    return this.vectorCapability;
  }

  public isNodesFtsUsable(): boolean {
    return this.nodesFtsUsable;
  }

  public disableNodesFts(reason: string, error?: unknown): void {
    this.nodesFtsUsable = false;
    if (this.nodesFtsDisabledReason === reason) {
      return;
    }
    this.nodesFtsDisabledReason = reason;

    if (error && !this.isSqliteCorruptError(error)) {
      console.warn(`[SQLite] nodes_fts disabled: ${reason}`, error);
      return;
    }

    console.warn(`[SQLite] nodes_fts disabled: ${reason}. Falling back to LIKE search for this database session.`);
  }

  public async checkTables(): Promise<string[]> {
    try {
      const result = this.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      return result.rows.map(row => row.name);
    } catch (error) {
      console.error('Table check failed:', error);
      return [];
    }
  }

  public ensureVectorExtensions(): void {
    if (!this.vectorCapability.available) {
      return;
    }

    try {
      // Test for vec_nodes and vec_chunks; create them if missing
      const hasVecNodes = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get('vec_nodes');
      if (!hasVecNodes) {
        this.db.exec(`
          CREATE VIRTUAL TABLE vec_nodes USING vec0(
            node_id INTEGER PRIMARY KEY,
            embedding FLOAT[1536]
          );
        `);
        console.log('Created vec_nodes virtual table');
      }

      const hasVecChunks = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get('vec_chunks');
      if (!hasVecChunks) {
        this.db.exec(`
          CREATE VIRTUAL TABLE vec_chunks USING vec0(
            chunk_id INTEGER PRIMARY KEY,
            embedding FLOAT[1536]
          );
        `);
        console.log('Created vec_chunks virtual table');
      }
    } catch (error) {
      console.warn('Vector extension not available:', error);
    }
  }

  private ensureVectorTables(): void {
    if (this.readOnly || !this.vectorCapability.available) {
      return;
    }
    // Wrapper to keep existing public API stable
    this.ensureVectorExtensions();
  }

  private ensureCoreSchema(): void {
    if (this.readOnly) {
      return;
    }

    this.db.exec(`
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

      CREATE TABLE IF NOT EXISTS contexts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        icon TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_contexts_name_normalized
        ON contexts(LOWER(TRIM(name)));

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY,
        node_id INTEGER NOT NULL,
        chunk_idx INTEGER,
        text TEXT NOT NULL,
        embedding BLOB,
        embedding_type TEXT DEFAULT 'openai',
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );

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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT,
        FOREIGN KEY (focused_node_id) REFERENCES nodes(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_updated_at ON nodes(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chunks_node_id ON chunks(node_id);
    `);

    this.ensureEdgesTableSchema();
  }

  private ensureEdgesTableSchema(): void {
    const hasEdgesTable = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edges'")
      .get();

    if (!hasEdgesTable) {
      this.db.exec(`
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
      const edgeCols = this.db.prepare('PRAGMA table_info(edges)').all() as Array<{ name: string }>;
      const edgeColNames = new Set(edgeCols.map((col) => col.name));
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
        this.rebuildLegacyEdgesTable(edgeColNames);
      }
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id);
      CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node_id);
    `);
  }

  private rebuildLegacyEdgesTable(edgeColNames: Set<string>): void {
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

    console.log('Migrating legacy edges table to canonical schema');

    let flippedForeignKeys = false;
    try {
      this.db.exec('PRAGMA foreign_keys=OFF;');
      flippedForeignKeys = true;
    } catch {}

    try {
      this.db.exec('BEGIN TRANSACTION;');
      this.db.exec(`
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
        this.db.exec('ROLLBACK;');
      } catch {}
      throw error;
    } finally {
      if (flippedForeignKeys) {
        try {
          this.db.exec('PRAGMA foreign_keys=ON;');
        } catch {}
      }
    }
  }

  private rebuildLegacyChatsTable(chatColNames: Set<string>): void {
    const chatTypeExpr = chatColNames.has('chat_type') ? 'chat_type' : 'NULL';
    const helperNameExpr = chatColNames.has('helper_name')
      ? 'helper_name'
      : chatColNames.has('title')
        ? 'title'
        : 'NULL';
    const agentTypeExpr = chatColNames.has('agent_type')
      ? "COALESCE(agent_type, 'orchestrator')"
      : "'orchestrator'";
    const delegationIdExpr = chatColNames.has('delegation_id') ? 'delegation_id' : 'NULL';
    const userMessageExpr = chatColNames.has('user_message') ? 'user_message' : 'NULL';
    const assistantMessageExpr = chatColNames.has('assistant_message') ? 'assistant_message' : 'NULL';
    const threadIdExpr = chatColNames.has('thread_id') ? 'thread_id' : 'NULL';
    const focusedNodeIdExpr = chatColNames.has('focused_node_id') ? 'focused_node_id' : 'NULL';
    const createdAtExpr = chatColNames.has('created_at') ? 'created_at' : 'CURRENT_TIMESTAMP';
    const metadataExpr = chatColNames.has('metadata') ? 'metadata' : 'NULL';

    console.log('Migrating legacy chats table to canonical schema');

    let flippedForeignKeys = false;
    try {
      this.db.exec('PRAGMA foreign_keys=OFF;');
      flippedForeignKeys = true;
    } catch {}

    try {
      this.db.exec('BEGIN TRANSACTION;');
      this.db.exec(`
        DROP INDEX IF EXISTS idx_chats_thread;
        ALTER TABLE chats RENAME TO chats_legacy_cleanup;
        CREATE TABLE chats (
          id INTEGER PRIMARY KEY,
          chat_type TEXT,
          helper_name TEXT,
          agent_type TEXT DEFAULT 'orchestrator',
          delegation_id INTEGER,
          user_message TEXT,
          assistant_message TEXT,
          thread_id TEXT,
          focused_node_id INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          metadata TEXT,
          FOREIGN KEY (focused_node_id) REFERENCES nodes(id) ON DELETE SET NULL
        );
        INSERT INTO chats (
          id, chat_type, helper_name, agent_type, delegation_id,
          user_message, assistant_message, thread_id, focused_node_id,
          created_at, metadata
        )
        SELECT
          id,
          ${chatTypeExpr},
          ${helperNameExpr},
          ${agentTypeExpr},
          ${delegationIdExpr},
          ${userMessageExpr},
          ${assistantMessageExpr},
          ${threadIdExpr},
          ${focusedNodeIdExpr},
          COALESCE(${createdAtExpr}, CURRENT_TIMESTAMP),
          ${metadataExpr}
        FROM chats_legacy_cleanup;
        DROP TABLE chats_legacy_cleanup;
        COMMIT;
      `);
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {}
      throw error;
    } finally {
      if (flippedForeignKeys) {
        try {
          this.db.exec('PRAGMA foreign_keys=ON;');
        } catch {}
      }
    }
  }

  private ensureLoggingAndMemorySchema(): void {
    if (this.readOnly) {
      return;
    }
    try {
      // Existing installs may already have logs but still need the idempotent schema pass below.
      // Only skip the legacy memory rename step when logs already exists.
      const hasLogs = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='logs'").get();
      const hasLegacyMemory = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory'").get();
      if (!hasLogs && hasLegacyMemory) {
        // Drop old view to release dependency
        this.db.exec(`DROP VIEW IF EXISTS memory_v;`);
        this.db.exec(`ALTER TABLE memory RENAME TO logs;`);
      }

      // 2) Ensure logs table exists (fresh install)
      const hasLogsNow = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='logs'").get();
      if (!hasLogsNow) {
        this.db.exec(`
          CREATE TABLE logs (
            id INTEGER PRIMARY KEY,
            ts TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
            table_name TEXT NOT NULL,
            action TEXT NOT NULL,
            row_id INTEGER NOT NULL,
            summary TEXT,
            snapshot_json TEXT
          );
        `);
      }

      // Ensure nodes table has expected columns for memory nodes
      try {
        const nodeCols = this.db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>;
        const ensureNodeCol = (name: string, ddl: string) => {
          if (!nodeCols.some(col => col.name === name)) {
            try {
              this.db.exec(ddl);
            } catch (colErr) {
              console.warn(`Failed to add nodes.${name}`, colErr);
            }
          }
        };
        ensureNodeCol('description', "ALTER TABLE nodes ADD COLUMN description TEXT;");
        ensureNodeCol('link', 'ALTER TABLE nodes ADD COLUMN link TEXT;');
        ensureNodeCol('source', 'ALTER TABLE nodes ADD COLUMN source TEXT;');
        ensureNodeCol('metadata', 'ALTER TABLE nodes ADD COLUMN metadata TEXT;');
        ensureNodeCol('created_at', "ALTER TABLE nodes ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP;");
        ensureNodeCol('updated_at', "ALTER TABLE nodes ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP;");
      } catch (nodeErr) {
        console.warn('Failed to ensure nodes columns:', nodeErr);
      }

      // Ensure chats table tracks creation timestamp for ordering
      try {
        const chatCols = this.db.prepare('PRAGMA table_info(chats)').all() as Array<{ name: string }>;
        if (chatCols.some(col => col.name === 'created_at')) {
          // no-op, column exists
        } else if (chatCols.length > 0) {
          this.db.exec("ALTER TABLE chats ADD COLUMN created_at TEXT DEFAULT (CURRENT_TIMESTAMP);");
        }
      } catch (chatErr) {
        console.warn('Failed to ensure chats.created_at column:', chatErr);
      }

      // Normalize legacy chats table before creating chat triggers or views that reference modern columns.
      try {
        const hasChatsTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chats'").get();
        if (hasChatsTable) {
          const chatCols = this.db.prepare('PRAGMA table_info(chats)').all() as Array<{ name: string }>;
          const chatColNames = new Set(chatCols.map((col) => col.name));
          const needsChatRewrite =
            chatColNames.has('focused_memory_id') ||
            ['chat_type', 'helper_name', 'agent_type', 'delegation_id', 'user_message', 'assistant_message', 'thread_id', 'focused_node_id', 'created_at', 'metadata']
              .some((name) => !chatColNames.has(name));

          if (needsChatRewrite) {
            this.rebuildLegacyChatsTable(chatColNames);
          }
        }
      } catch (chatSchemaErr) {
        console.warn('Failed to normalize chats schema before log setup:', chatSchemaErr);
      }

      // 3) Helpful indexes on logs (clean up old names first)
      this.db.exec(`
        DROP INDEX IF EXISTS idx_memory_ts;
        DROP INDEX IF EXISTS idx_memory_table_ts;
        DROP INDEX IF EXISTS idx_memory_table_row;
        CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
        CREATE INDEX IF NOT EXISTS idx_logs_table_ts ON logs(table_name, ts);
        CREATE INDEX IF NOT EXISTS idx_logs_table_row ON logs(table_name, row_id);
      `);

      // 4) Recreate triggers to write to logs (use CREATE IF NOT EXISTS)
      const hasChats = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chats'").get();
      this.db.exec(`
        DROP TRIGGER IF EXISTS trg_nodes_ai;
        DROP TRIGGER IF EXISTS trg_nodes_au;
        CREATE TRIGGER IF NOT EXISTS trg_nodes_ai AFTER INSERT ON nodes BEGIN
          INSERT INTO logs(table_name, action, row_id, summary, snapshot_json)
          VALUES('nodes', 'insert', NEW.id,
                 printf('node created: %s', COALESCE(NEW.title,'')),
                 json_object('id', NEW.id, 'title', NEW.title, 'link', NEW.link));
        END;
        CREATE TRIGGER IF NOT EXISTS trg_nodes_au AFTER UPDATE ON nodes BEGIN
          INSERT INTO logs(table_name, action, row_id, summary, snapshot_json)
          VALUES('nodes', 'update', NEW.id,
                 printf('node updated: %s', COALESCE(NEW.title,'')),
                 json_object('id', NEW.id, 'title', NEW.title, 'link', NEW.link));
        END;

        DROP TRIGGER IF EXISTS trg_edges_ai;
        DROP TRIGGER IF EXISTS trg_edges_au;
        CREATE TRIGGER IF NOT EXISTS trg_edges_ai AFTER INSERT ON edges BEGIN
          INSERT INTO logs(table_name, action, row_id, summary, snapshot_json)
          VALUES('edges', 'insert', NEW.id,
                 printf('edge %d→%d (%s)', NEW.from_node_id, NEW.to_node_id, COALESCE(NEW.source,'')),
                 json_object(
                   'id', NEW.id,
                   'from', NEW.from_node_id,
                   'to', NEW.to_node_id,
                   'source', NEW.source,
                   'from_title', substr((SELECT title FROM nodes WHERE id = NEW.from_node_id), 1, 120),
                   'to_title', substr((SELECT title FROM nodes WHERE id = NEW.to_node_id), 1, 120)
                 ));
        END;
        CREATE TRIGGER IF NOT EXISTS trg_edges_au AFTER UPDATE ON edges BEGIN
          INSERT INTO logs(table_name, action, row_id, summary, snapshot_json)
          VALUES('edges', 'update', NEW.id,
                 printf('edge updated %d→%d', NEW.from_node_id, NEW.to_node_id),
                 json_object(
                   'id', NEW.id,
                   'from', NEW.from_node_id,
                   'to', NEW.to_node_id,
                   'source', NEW.source,
                   'from_title', substr((SELECT title FROM nodes WHERE id = NEW.from_node_id), 1, 120),
                   'to_title', substr((SELECT title FROM nodes WHERE id = NEW.to_node_id), 1, 120)
                 ));
        END;
      `);

      if (hasChats) {
        this.db.exec(`
          DROP TRIGGER IF EXISTS trg_chats_ai;
          CREATE TRIGGER IF NOT EXISTS trg_chats_ai AFTER INSERT ON chats BEGIN
            INSERT INTO logs(table_name, action, row_id, summary, snapshot_json)
            VALUES('chats', 'insert', NEW.id,
                   printf('chat: %s (%s)', COALESCE(NEW.helper_name,''), COALESCE(NEW.thread_id,'')),
                   json_object(
                     'id', NEW.id,
                     'helper', NEW.helper_name,
                     'thread', NEW.thread_id,
                     'user_message', COALESCE(NEW.user_message,''),
                     'assistant_message', COALESCE(NEW.assistant_message,''),
                     'user_preview', substr(COALESCE(NEW.user_message,''), 1, 120),
                     'assistant_preview', substr(COALESCE(NEW.assistant_message,''), 1, 120),
                     'system_message', COALESCE(json_extract(NEW.metadata, '$.system_message'), ''),
                     'input_tokens', COALESCE(json_extract(NEW.metadata, '$.input_tokens'), 0),
                     'output_tokens', COALESCE(json_extract(NEW.metadata, '$.output_tokens'), 0),
                     'cost_usd', COALESCE(json_extract(NEW.metadata, '$.estimated_cost_usd'), 0.0),
                     'cache_hit', COALESCE(json_extract(NEW.metadata, '$.cache_hit'), 0),
                     'model', COALESCE(json_extract(NEW.metadata, '$.model_used'), ''),
                     'tools_count', COALESCE(json_extract(NEW.metadata, '$.tool_calls_count'), 0),
                     'tools_used', COALESCE(json_extract(NEW.metadata, '$.tools_used'), json('[]')),
                     'latency_ms', COALESCE(json_extract(NEW.metadata, '$.latency_ms'), 0),
                     'prompt_build_ms', COALESCE(json_extract(NEW.metadata, '$.timing_breakdown.promptBuildMs'), 0),
                     'tools_build_ms', COALESCE(json_extract(NEW.metadata, '$.timing_breakdown.toolsBuildMs'), 0),
                     'model_resolve_ms', COALESCE(json_extract(NEW.metadata, '$.timing_breakdown.modelResolveMs'), 0),
                     'message_assembly_ms', COALESCE(json_extract(NEW.metadata, '$.timing_breakdown.messageAssemblyMs'), 0),
                     'stream_setup_ms', COALESCE(json_extract(NEW.metadata, '$.timing_breakdown.streamSetupMs'), 0),
                     'tool_loop_ms', COALESCE(json_extract(NEW.metadata, '$.timing_breakdown.toolLoopMs'), 0),
                     'first_token_latency_ms', COALESCE(json_extract(NEW.metadata, '$.first_token_latency_ms'), 0),
                     'first_chunk_latency_ms', COALESCE(json_extract(NEW.metadata, '$.first_chunk_latency_ms'), 0),
                     'tool_timings', COALESCE(json_extract(NEW.metadata, '$.tool_timings'), json('[]')),
                     'trace_id', COALESCE(json_extract(NEW.metadata, '$.trace_id'), ''),
                     'voice_tts_chars', COALESCE(json_extract(NEW.metadata, '$.voice_tts_chars'), 0),
                     'voice_tts_cost_usd', COALESCE(json_extract(NEW.metadata, '$.voice_tts_cost_usd'), 0),
                     'voice_tts_chars_total', COALESCE(json_extract(NEW.metadata, '$.voice_tts_chars_total'), 0),
                     'voice_tts_cost_usd_total', COALESCE(json_extract(NEW.metadata, '$.voice_tts_cost_usd_total'), 0),
                     'voice_request_id', COALESCE(json_extract(NEW.metadata, '$.voice_request_id'), ''),
                     'voice_tts_request_count', COALESCE(json_extract(NEW.metadata, '$.voice_tts_request_count'), 0)
                   ));
          END;
        `);
      }

      this.db.exec(`
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

      // 5) Views: logs_v (drop any legacy memory_v alias)
      this.db.exec(`DROP VIEW IF EXISTS logs_v; DROP VIEW IF EXISTS memory_v;`);
      try {
        this.db.exec(`
        CREATE VIEW logs_v AS
        SELECT 
          m.id,
          m.ts,
          m.table_name,
          m.action,
          m.row_id,
          m.summary,
          m.enriched_summary,
          m.snapshot_json,
          CASE WHEN m.table_name='nodes' THEN n.title END AS node_title,
          CASE WHEN m.table_name='edges' THEN nf.title END AS edge_from_title,
          CASE WHEN m.table_name='edges' THEN nt.title END AS edge_to_title,
          CASE WHEN m.table_name='chats' THEN c.helper_name END AS chat_helper,
          CASE WHEN m.table_name='chats' THEN substr(c.user_message,1,120) END AS chat_user_preview,
          CASE WHEN m.table_name='chats' THEN substr(c.assistant_message,1,120) END AS chat_assistant_preview,
          CASE WHEN m.table_name='chats' THEN c.user_message END AS chat_user_full,
          CASE WHEN m.table_name='chats' THEN c.assistant_message END AS chat_assistant_full
        FROM logs m
        LEFT JOIN nodes n ON (m.table_name='nodes' AND m.row_id = n.id)
        LEFT JOIN edges e ON (m.table_name='edges' AND m.row_id = e.id)
        LEFT JOIN nodes nf ON e.from_node_id = nf.id
        LEFT JOIN nodes nt ON e.to_node_id = nt.id
        LEFT JOIN chats c ON (m.table_name='chats' AND m.row_id = c.id);
      `);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/already exists/i.test(error.message || '')
        ) {
          throw error;
        }
      }
      // Do not recreate memory_v; alias has been removed.

      // 6) Clean up removed chat_memory_state table
      try {
        this.db.exec(`DROP TABLE IF EXISTS chat_memory_state;`);
      } catch (e) {
        // Ignore if table doesn't exist
      }

      // Clean up removed agent_delegations table
      try {
        this.db.exec(`DROP TABLE IF EXISTS agent_delegations;`);
      } catch (e) {
        console.warn('Failed to drop agent_delegations table:', e);
      }

      // 8) Logs retention trigger (~10k most recent rows)
      try {
        this.db.exec(`
          DROP TRIGGER IF EXISTS trg_logs_prune;
          CREATE TRIGGER IF NOT EXISTS trg_logs_prune AFTER INSERT ON logs BEGIN
            DELETE FROM logs WHERE id < NEW.id - 10000;
          END;
        `);
      } catch {}

      // 7) Ensure agents table schema (backward compatibility)
      try {
        const agentCols = this.db.prepare('PRAGMA table_info(agents)').all() as any[];
        if (agentCols.length) {
          const hasKey = agentCols.some(col => col.name === 'key');
          const hasComponentKey = agentCols.some(col => col.name === 'component_key');
          if (!hasKey && hasComponentKey) {
            try { this.db.exec('ALTER TABLE agents RENAME COLUMN component_key TO key;'); } catch {}
          }

          if (!agentCols.some(col => col.name === 'role')) {
            try { this.db.exec("ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'executor';"); } catch {}
          }
          if (!agentCols.some(col => col.name === 'memory')) {
            try { this.db.exec('ALTER TABLE agents ADD COLUMN memory TEXT;'); } catch {}
          }
          if (!agentCols.some(col => col.name === 'prompts')) {
            try { this.db.exec("ALTER TABLE agents ADD COLUMN prompts TEXT DEFAULT '[]';"); } catch {}
          }
        }
      } catch (e) {
        console.warn('Agent schema ensure failed:', e);
      }

      // 8) Ensure chats schema (remove legacy focused_memory_id, ensure agent columns)
      if (hasChats) {
        try {
          let chatCols = this.db.prepare('PRAGMA table_info(chats)').all() as any[];
          const chatColNames = new Set(chatCols.map((c: any) => c.name));
          const needsChatRewrite =
            chatColNames.has('focused_memory_id') ||
            ['chat_type', 'helper_name', 'agent_type', 'delegation_id', 'user_message', 'assistant_message', 'thread_id', 'focused_node_id', 'created_at', 'metadata']
              .some((name) => !chatColNames.has(name));

          if (needsChatRewrite) {
            this.rebuildLegacyChatsTable(chatColNames);
            chatCols = this.db.prepare('PRAGMA table_info(chats)').all() as any[];
          }

          if (chatCols.some((c: any) => c.name === 'thread_id')) {
            this.db.exec("CREATE INDEX IF NOT EXISTS idx_chats_thread ON chats(thread_id);");
          }

          const ensureCol = (name: string, ddl: string) => {
            if (!chatCols.some((c: any) => c.name === name)) {
              try { this.db.exec(ddl); } catch (colErr) { console.warn(`Failed to add chats.${name}`, colErr); }
            }
          };
          ensureCol('agent_type', "ALTER TABLE chats ADD COLUMN agent_type TEXT DEFAULT 'orchestrator';");
          ensureCol('delegation_id', 'ALTER TABLE chats ADD COLUMN delegation_id INTEGER;');
        } catch (e) {
          console.warn('Failed to update chats schema:', e);
        }
      }

      try {
        const chatColsPost = hasChats
          ? this.db.prepare('PRAGMA table_info(chats)').all() as any[]
          : [];
        const stillHasFocusedMemoryId = chatColsPost.some((c: any) => c.name === 'focused_memory_id');
        if (stillHasFocusedMemoryId) {
          console.warn('Skipping legacy memory table drop because chats.focused_memory_id is still present.');
        } else {
          this.db.exec(`
            DROP TRIGGER IF EXISTS trg_episodic_prune;
            DROP TABLE IF EXISTS episodic_memory;
            DROP TABLE IF EXISTS episodic_pipeline_state;
            DROP TABLE IF EXISTS semantic_memory;
            DROP TABLE IF EXISTS semantic_pipeline_state;
            DROP TABLE IF EXISTS memory_pipeline_state;
            DROP TABLE IF EXISTS memory;
          `);
        }
      } catch (dropLegacyErr) {
        console.warn('Failed to drop legacy memory pipeline tables:', dropLegacyErr);
      }

      // 9) Final schema pass migrations (source-first backfill, event_date, soft contexts, drop dimensions)
      try {
        let nodeCols2 = this.db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>;
        let nodeColNames = nodeCols2.map(c => c.name);

        if (!nodeColNames.includes('source')) {
          console.log('Adding nodes.source column...');
          this.db.exec('ALTER TABLE nodes ADD COLUMN source TEXT;');
          nodeCols2 = this.db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>;
          nodeColNames = nodeCols2.map(c => c.name);
        }

        if (!nodeColNames.includes('chunk_status')) {
          this.db.exec("ALTER TABLE nodes ADD COLUMN chunk_status TEXT DEFAULT 'not_chunked';");
          nodeCols2 = this.db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>;
          nodeColNames = nodeCols2.map(c => c.name);
        }

        if (nodeColNames.includes('source')) {
          if (nodeColNames.includes('content')) {
            this.db.exec(`
              UPDATE nodes
              SET source = content,
                  chunk_status = 'not_chunked'
              WHERE (source IS NULL OR LENGTH(TRIM(source)) = 0)
                AND content IS NOT NULL
                AND LENGTH(TRIM(content)) > 0;
            `);
          }

          if (nodeColNames.includes('notes')) {
            this.db.exec(`
              UPDATE nodes
              SET source = notes,
                  chunk_status = 'not_chunked'
              WHERE (source IS NULL OR LENGTH(TRIM(source)) = 0)
                AND notes IS NOT NULL
                AND LENGTH(TRIM(notes)) > 0;
            `);
          }

          if (nodeColNames.includes('chunk')) {
            this.db.exec(`
              UPDATE nodes
              SET source = chunk,
                  chunk_status = 'not_chunked'
              WHERE (source IS NULL OR LENGTH(TRIM(source)) = 0)
                AND chunk IS NOT NULL
                AND LENGTH(TRIM(chunk)) > 0;
            `);
          }

          this.db.exec(`
            UPDATE nodes
            SET source = title || CASE
              WHEN description IS NOT NULL AND LENGTH(TRIM(description)) > 0
                THEN char(10) || char(10) || description
              ELSE ''
            END,
            chunk_status = 'not_chunked'
            WHERE source IS NULL OR LENGTH(TRIM(source)) = 0;
          `);

          this.db.exec(`
            UPDATE nodes
            SET chunk_status = 'not_chunked'
            WHERE source IS NOT NULL
              AND LENGTH(TRIM(source)) > 0
              AND (chunk_status IS NULL OR chunk_status != 'chunked');
          `);
        }

        // Add event_date
        if (!nodeColNames.includes('event_date')) {
          this.db.exec('ALTER TABLE nodes ADD COLUMN event_date TEXT;');
          // Backfill from metadata.published_date or metadata.source_metadata.published_date where available
          try {
            this.db.exec(`
              UPDATE nodes
              SET event_date = COALESCE(
                json_extract(metadata, '$.source_metadata.published_date'),
                json_extract(metadata, '$.published_date')
              )
              WHERE event_date IS NULL
                AND COALESCE(
                  json_extract(metadata, '$.source_metadata.published_date'),
                  json_extract(metadata, '$.published_date')
                ) IS NOT NULL;
            `);
          } catch {}
        }

        if (!nodeColNames.includes('context_id')) {
          this.db.exec('ALTER TABLE nodes ADD COLUMN context_id INTEGER REFERENCES contexts(id) ON DELETE SET NULL;');
        }

        const hasContexts = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contexts'").get();
        if (!hasContexts) {
          this.db.exec(`
            CREATE TABLE contexts (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT NOT NULL,
              icon TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
          `);
        }

        const contextCols = this.db.prepare('PRAGMA table_info(contexts)').all() as Array<{ name: string }>;
        const ensureContextCol = (name: string, ddl: string) => {
          if (!contextCols.some(col => col.name === name)) {
            this.db.exec(ddl);
          }
        };
        ensureContextCol('description', "ALTER TABLE contexts ADD COLUMN description TEXT NOT NULL DEFAULT '';");
        ensureContextCol('icon', 'ALTER TABLE contexts ADD COLUMN icon TEXT;');
        ensureContextCol('created_at', "ALTER TABLE contexts ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
        ensureContextCol('updated_at', "ALTER TABLE contexts ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");

        this.db.exec(`
          UPDATE contexts
          SET description = COALESCE(NULLIF(TRIM(description), ''), name)
          WHERE description IS NULL OR LENGTH(TRIM(description)) = 0;
        `);

        this.db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_contexts_name_normalized
            ON contexts(LOWER(TRIM(name)));
          CREATE INDEX IF NOT EXISTS idx_nodes_context_id ON nodes(context_id);
        `);

        const hasLegacyDimensions = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dimensions'").get();
        const hasLegacyNodeDimensions = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='node_dimensions'").get();
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS dimension_migration_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            dimension_count INTEGER NOT NULL,
            assignment_count INTEGER NOT NULL,
            payload TEXT
          );
        `);

        if (hasLegacyDimensions || hasLegacyNodeDimensions) {
          const existingSnapshotCount = Number(
            (this.db.prepare('SELECT COUNT(*) as count FROM dimension_migration_snapshots').get() as { count?: number } | undefined)?.count ?? 0
          );

          if (existingSnapshotCount === 0) {
            const dimensionCount = hasLegacyDimensions
              ? Number((this.db.prepare('SELECT COUNT(*) as count FROM dimensions').get() as { count?: number } | undefined)?.count ?? 0)
              : 0;
            const assignmentCount = hasLegacyNodeDimensions
              ? Number((this.db.prepare('SELECT COUNT(*) as count FROM node_dimensions').get() as { count?: number } | undefined)?.count ?? 0)
              : 0;
            const payload = hasLegacyNodeDimensions
              ? (
                  this.db.prepare(`
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
                  `).get() as { payload?: string } | undefined
                )?.payload ?? '[]'
              : '[]';

            this.db.prepare(`
              INSERT INTO dimension_migration_snapshots (dimension_count, assignment_count, payload)
              VALUES (?, ?, ?)
            `).run(dimensionCount, assignmentCount, payload);
          }

          this.db.exec(`
            DROP INDEX IF EXISTS idx_dim_by_dimension;
            DROP INDEX IF EXISTS idx_dim_by_node;
            DROP TABLE IF EXISTS node_dimensions;
            DROP TABLE IF EXISTS dimensions;
          `);
        }

        // Drop dead columns (requires SQLite 3.35+)
        // nodes.type
        if (nodeColNames.includes('type')) {
          try { this.db.exec('ALTER TABLE nodes DROP COLUMN type;'); } catch {}
        }
        // nodes.is_pinned
        if (nodeColNames.includes('is_pinned')) {
          try { this.db.exec('ALTER TABLE nodes DROP COLUMN is_pinned;'); } catch {}
        }
        // edges.user_feedback
        const edgeCols = this.db.prepare('PRAGMA table_info(edges)').all() as Array<{ name: string }>;
        if (edgeCols.some(c => c.name === 'user_feedback')) {
          try { this.db.exec('ALTER TABLE edges DROP COLUMN user_feedback;'); } catch {}
        }
        // edges.explanation (top-level column added alongside context JSON)
        if (!edgeCols.some(c => c.name === 'explanation')) {
          this.db.exec('ALTER TABLE edges ADD COLUMN explanation TEXT;');
          // Backfill from context JSON where available
          try {
            this.db.exec(`
              UPDATE edges SET explanation = json_extract(context, '$.explanation')
              WHERE explanation IS NULL AND json_extract(context, '$.explanation') IS NOT NULL;
            `);
          } catch {}
        }

        // Recreate nodes_fts to index title + source + description
        try {
          const ftsCheck = this.db.prepare("SELECT sql FROM sqlite_master WHERE name='nodes_fts'").get() as { sql?: string } | undefined;
          const needsRebuild = !ftsCheck?.sql || !ftsCheck.sql.includes('source') || ftsCheck.sql.includes('notes') || ftsCheck.sql.includes('content');
          if (needsRebuild) {
            this.db.exec('DROP TABLE IF EXISTS nodes_fts;');
            this.db.exec("CREATE VIRTUAL TABLE nodes_fts USING fts5(title, source, description, content='nodes', content_rowid='id');");
            this.db.exec("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild');");
          }
        } catch (ftsErr) {
          if (this.isSqliteCorruptError(ftsErr)) {
            this.disableNodesFts('existing nodes_fts is corrupt and could not be rebuilt', ftsErr);
          } else {
            console.warn('Failed to rebuild nodes_fts:', ftsErr);
          }
        }
      } catch (schemaErr) {
        console.warn('Final schema pass migration error:', schemaErr);
      }

      console.log('Logging + memory schema ensured');
    } catch (error) {
      console.error('Failed to ensure logging/memory schema:', error);
    }
  }

  private ensureContextsSchema(): void {
    if (this.readOnly) {
      return;
    }

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS contexts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          icon TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const nodeCols = this.db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>;
      const nodeColNames = nodeCols.map((column) => column.name);
      if (!nodeColNames.includes('context_id')) {
        this.db.exec('ALTER TABLE nodes ADD COLUMN context_id INTEGER REFERENCES contexts(id) ON DELETE SET NULL;');
      }

      const contextCols = this.db.prepare('PRAGMA table_info(contexts)').all() as Array<{ name: string }>;
      const contextColNames = contextCols.map((column) => column.name);
      if (!contextColNames.includes('description')) {
        this.db.exec("ALTER TABLE contexts ADD COLUMN description TEXT NOT NULL DEFAULT '';");
      }
      if (!contextColNames.includes('icon')) {
        this.db.exec('ALTER TABLE contexts ADD COLUMN icon TEXT;');
      }
      if (!contextColNames.includes('created_at')) {
        this.db.exec("ALTER TABLE contexts ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
      }
      if (!contextColNames.includes('updated_at')) {
        this.db.exec("ALTER TABLE contexts ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
      }

      this.db.exec(`
        UPDATE contexts
        SET description = COALESCE(NULLIF(TRIM(description), ''), name)
        WHERE description IS NULL OR LENGTH(TRIM(description)) = 0;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_contexts_name_normalized
          ON contexts(LOWER(TRIM(name)));
        CREATE INDEX IF NOT EXISTS idx_nodes_context_id ON nodes(context_id);
      `);
    } catch (error) {
      console.warn('Failed to ensure contexts schema:', error);
    }
  }

  private healVectorTablesIfCorrupt(): void {
    if (this.readOnly || !this.vectorCapability.available) {
      return;
    }
    // Attempt lightweight reads to detect CORRUPT_VTAB; if detected, drop/recreate vtables
    const tryRead = (table: string) => {
      try {
        this.db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get();
      } catch (e: any) {
        const msg = String(e?.message || '');
        const code = (e && e.code) ? String(e.code) : '';
        if (code === 'SQLITE_CORRUPT_VTAB' || msg.includes('database disk image is malformed') || msg.includes('CORRUPT_VTAB')) {
          console.warn(`Detected corrupted virtual table ${table} (${code || 'error'}). Recreating...`);
          try {
            this.db.exec(`DROP TABLE IF EXISTS ${table};`);
          } catch {}
          const ddl = table === 'vec_nodes'
            ? `CREATE VIRTUAL TABLE vec_nodes USING vec0(node_id INTEGER PRIMARY KEY, embedding FLOAT[1536]);`
            : `CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id INTEGER PRIMARY KEY, embedding FLOAT[1536]);`;
          try {
            this.db.exec(ddl);
            console.log(`Recreated ${table} virtual table`);
          } catch (re) {
            console.error(`Failed to recreate ${table}:`, re);
          }
        } else {
          // Other errors should bubble up normally
          // eslint-disable-next-line no-unsafe-finally
          throw e;
        }
      }
    };

    tryRead('vec_nodes');
    tryRead('vec_chunks');
  }

  private handleError(error: any): DatabaseError {
    return {
      message: error.message || 'SQLite operation failed',
      code: error.code || 'SQLITE_ERROR',
      details: error
    };
  }

  public close(): void {
    this.db.close();
  }

  private isSqliteCorruptError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const sqliteError = error as Error & { code?: string };
    return sqliteError.code === 'SQLITE_CORRUPT' || /database disk image is malformed/i.test(sqliteError.message || '');
  }
}

// Export singleton instance (similar to PostgreSQL client interface)
export const sqliteDb = SQLiteClient.getInstance();

// Export function to get client instance
export const getSQLiteClient = () => sqliteDb;

// Export class for testing
export { SQLiteClient };
