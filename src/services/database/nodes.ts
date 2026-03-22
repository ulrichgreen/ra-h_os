import { getSQLiteClient } from './sqlite-client';
import { Node, NodeFilters } from '@/types/database';
import { eventBroadcaster } from '../events';
import { EmbeddingService } from '@/services/embeddings';

type NodeRow = Node & { dimensions_json: string };
type NodeSearchRow = NodeRow & { rank?: number; similarity?: number };

function sanitizeFtsQuery(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0 && !/^(AND|OR|NOT|NEAR)$/i.test(word))
    .join(' ');
}

function extractRelaxedSearchTerms(query: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'find',
    'for', 'from', 'hello', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on',
    'or', 'recent', 'stuff', 'term', 'that', 'the', 'this', 'to', 'with', 'you'
  ]);

  const rawTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map(term => term.trim())
    .filter(Boolean);

  const expanded = new Set<string>();

  for (const term of rawTerms) {
    if (!stopWords.has(term) && term.length >= 3) {
      expanded.add(term);
    }

    const alphaParts = term.replace(/\d+/g, ' ').split(/\s+/).filter(Boolean);
    for (const part of alphaParts) {
      if (!stopWords.has(part) && part.length >= 3) {
        expanded.add(part);
      }
    }
  }

  return Array.from(expanded).slice(0, 8);
}

function reciprocalRankFuse<T extends { id: number }>(
  rankedLists: T[][],
  limit: number,
): T[] {
  const scores = new Map<number, { score: number; item: T }>();
  const k = 60;

  rankedLists.forEach((list) => {
    list.forEach((item, index) => {
      const existing = scores.get(item.id);
      const score = 1 / (k + index + 1);
      if (existing) {
        existing.score += score;
      } else {
        scores.set(item.id, { score, item });
      }
    });
  });

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.item);
}

export class NodeService {
  async getNodes(filters: NodeFilters = {}): Promise<Node[]> {
    return this.getNodesSQLite(filters);
  }

  async countNodes(filters: NodeFilters = {}): Promise<number> {
    const { dimensions, search, dimensionsMatch = 'any',
            createdAfter, createdBefore, eventAfter, eventBefore, chunkStatus } = filters;

    if (search?.trim()) {
      return this.countSearchNodesSQLite(filters);
    }

    const sqlite = getSQLiteClient();

    let query = `SELECT COUNT(*) as total FROM nodes n WHERE 1=1`;
    const params: any[] = [];

    if (dimensions && dimensions.length > 0) {
      if (dimensionsMatch === 'all' && dimensions.length > 1) {
        query += ` AND (
          SELECT COUNT(DISTINCT nd.dimension) FROM node_dimensions nd
          WHERE nd.node_id = n.id
          AND nd.dimension IN (${dimensions.map(() => '?').join(',')})
        ) = ?`;
        params.push(...dimensions, dimensions.length);
      } else {
        query += ` AND EXISTS (
          SELECT 1 FROM node_dimensions nd
          WHERE nd.node_id = n.id
          AND nd.dimension IN (${dimensions.map(() => '?').join(',')})
        )`;
        params.push(...dimensions);
      }
    }

    if (search) {
      query += ` AND (n.title LIKE ? COLLATE NOCASE OR n.description LIKE ? COLLATE NOCASE OR n.source LIKE ? COLLATE NOCASE)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (createdAfter) { query += ` AND n.created_at >= ?`; params.push(createdAfter); }
    if (createdBefore) { query += ` AND n.created_at < ?`; params.push(createdBefore); }
    if (eventAfter) { query += ` AND n.event_date >= ?`; params.push(eventAfter); }
    if (eventBefore) { query += ` AND n.event_date < ?`; params.push(eventBefore); }
    if (chunkStatus) { query += ` AND n.chunk_status = ?`; params.push(chunkStatus); }

    const result = sqlite.query<{ total: number }>(query, params);
    return result.rows[0]?.total ?? 0;
  }

  // PostgreSQL path removed in SQLite-only consolidation

  private async getNodesSQLite(filters: NodeFilters = {}): Promise<Node[]> {
    const { dimensions, search, limit = 100, offset = 0, sortBy, dimensionsMatch = 'any',
            createdAfter, createdBefore, eventAfter, eventBefore, chunkStatus } = filters;

    if (search?.trim()) {
      return this.searchNodesSQLite(filters);
    }

    const sqlite = getSQLiteClient();
    
    // Use nodes_v view for array-like dimensions behavior (exclude embedding BLOB for performance)
    let query = `
      SELECT n.id, n.title, n.description, n.source, n.link, n.event_date, n.metadata,
             n.chunk_status, n.embedding_updated_at, n.embedding_text,
             n.created_at, n.updated_at,
             COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                       FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json,
             (SELECT COUNT(*) FROM edges WHERE from_node_id = n.id OR to_node_id = n.id) as edge_count
      FROM nodes n
      WHERE 1=1
    `;
    const params: any[] = [];

    // Filter by dimensions (SQLite JOIN with node_dimensions)
    if (dimensions && dimensions.length > 0) {
      if (dimensionsMatch === 'all' && dimensions.length > 1) {
        // AND logic: node must have ALL specified dimensions
        query += ` AND (
          SELECT COUNT(DISTINCT nd.dimension) FROM node_dimensions nd
          WHERE nd.node_id = n.id
          AND nd.dimension IN (${dimensions.map(() => '?').join(',')})
        ) = ?`;
        params.push(...dimensions, dimensions.length);
      } else {
        // OR logic: node must have at least one of the specified dimensions
        query += ` AND EXISTS (
          SELECT 1 FROM node_dimensions nd
          WHERE nd.node_id = n.id
          AND nd.dimension IN (${dimensions.map(() => '?').join(',')})
        )`;
        params.push(...dimensions);
      }
    }

    // Text search in title, description, and source (SQLite LIKE with COLLATE NOCASE)
    if (search) {
      query += ` AND (n.title LIKE ? COLLATE NOCASE OR n.description LIKE ? COLLATE NOCASE OR n.source LIKE ? COLLATE NOCASE)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Temporal filters
    if (createdAfter) {
      query += ` AND n.created_at >= ?`;
      params.push(createdAfter);
    }
    if (createdBefore) {
      query += ` AND n.created_at < ?`;
      params.push(createdBefore);
    }
    if (eventAfter) {
      query += ` AND n.event_date >= ?`;
      params.push(eventAfter);
    }
    if (eventBefore) {
      query += ` AND n.event_date < ?`;
      params.push(eventBefore);
    }
    if (chunkStatus) {
      query += ` AND n.chunk_status = ?`;
      params.push(chunkStatus);
    }

    // Sorting logic
    if (search) {
      // For search queries, prioritize by relevance: exact title → starts with → contains in title → description → source
      query += ` ORDER BY
        CASE WHEN LOWER(n.title) = LOWER(?) THEN 1 ELSE 6 END,
        CASE WHEN LOWER(n.title) LIKE LOWER(?) THEN 2 ELSE 6 END,
        CASE WHEN n.title LIKE ? COLLATE NOCASE THEN 3 ELSE 6 END,
        CASE WHEN n.description LIKE ? COLLATE NOCASE THEN 4 ELSE 6 END,
        CASE WHEN n.source LIKE ? COLLATE NOCASE THEN 5 ELSE 6 END,
        n.updated_at DESC`;
      params.push(
        search,           // Exact match (case-insensitive)
        `${search}%`,     // Starts with search term
        `%${search}%`,    // Contains in title
        `%${search}%`,    // Contains in description
        `%${search}%`     // Contains in source
      );
    } else if (sortBy === 'edges') {
      // Sort by edge count (most connected first)
      query += ' ORDER BY edge_count DESC, n.updated_at DESC';
    } else if (sortBy === 'created') {
      query += ' ORDER BY n.created_at DESC';
    } else if (sortBy === 'event_date') {
      // Nodes with event_date first (DESC), then by updated_at for nulls
      query += ' ORDER BY n.event_date IS NULL, n.event_date DESC, n.updated_at DESC';
    } else {
      query += ' ORDER BY n.updated_at DESC';
    }

    if (limit) {
      query += ` LIMIT ?`;
      params.push(limit);
    }

    if (offset > 0) {
      query += ` OFFSET ?`;
      params.push(offset);
    }

    const result = sqlite.query<NodeRow>(query, params);
    
    // Parse dimensions_json and metadata back for compatibility
    return result.rows.map(row => this.mapNodeRow(row));
  }

  async getNodeById(id: number): Promise<Node | null> {
    return this.getNodeByIdSQLite(id);
  }

  // PostgreSQL path removed in SQLite-only consolidation

  private async getNodeByIdSQLite(id: number): Promise<Node | null> {
    const sqlite = getSQLiteClient();
    const query = `
      SELECT n.id, n.title, n.description, n.source, n.link, n.event_date, n.metadata,
             n.chunk_status, n.embedding_updated_at, n.embedding_text,
             n.created_at, n.updated_at,
             COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension) 
                       FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json
      FROM nodes n
      WHERE n.id = ?
    `;
    const result = sqlite.query<NodeRow>(query, [id]);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return this.mapNodeRow(row);
  }

  async createNode(nodeData: Partial<Node>): Promise<Node> {
    return this.createNodeSQLite(nodeData);
  }

  // PostgreSQL path removed in SQLite-only consolidation

  private async createNodeSQLite(nodeData: Partial<Node>): Promise<Node> {
    const {
      title,
      description,
      source,
      link,
      event_date,
      dimensions = [],
      chunk_status,
      metadata = {}
    } = nodeData;
    const now = new Date().toISOString();
    const sqlite = getSQLiteClient();

    const nodeId = sqlite.transaction(() => {
      // Insert node using prepare/run for lastInsertRowid access
      const nodeResult = sqlite.prepare(`
        INSERT INTO nodes (title, description, source, link, event_date, metadata, chunk_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        title,
        description ?? null,
        source ?? null,
        link ?? null,
        event_date ?? null,
        JSON.stringify(metadata),
        chunk_status ?? null,
        now,
        now
      );

      const id = Number(nodeResult.lastInsertRowid);

      // Insert dimensions separately with INSERT OR IGNORE for safety
      if (dimensions.length > 0) {
        const stmt = sqlite.prepare(
          "INSERT OR IGNORE INTO node_dimensions (node_id, dimension) VALUES (?, ?)"
        );
        for (const dimension of dimensions) {
          stmt.run(id, dimension);
        }
      }

      return id; // Returns number directly
    });

    // Get the created node with dimensions (outside transaction)
    const createdNode = await this.getNodeByIdSQLite(nodeId);
    if (!createdNode) {
      throw new Error('Failed to create node');
    }

    // Broadcast node creation event
    console.log('🚀 Broadcasting NODE_CREATED event for:', createdNode.title);
    eventBroadcaster.broadcast({
      type: 'NODE_CREATED',
      data: { node: createdNode }
    });

    return createdNode;
  }

  async updateNode(id: number, updates: Partial<Node>): Promise<Node> {
    return this.updateNodeSQLite(id, updates);
  }

  // PostgreSQL path removed in SQLite-only consolidation

  private async updateNodeSQLite(id: number, updates: Partial<Node>): Promise<Node> {
    const { title, description, source, link, event_date, dimensions, metadata } = updates;
    const now = new Date().toISOString();
    const sqlite = getSQLiteClient();

    const existingRow = sqlite
      .query<{ id: number }>('SELECT id FROM nodes WHERE id = ?', [id])
      .rows[0];

    if (!existingRow) {
      throw new Error(`Node with ID ${id} not found`);
    }

    sqlite.transaction(() => {
      // Update node columns (only update provided fields)
      const setFields: string[] = [];
      const params: any[] = [];
      
      if (title !== undefined) { setFields.push('title = ?'); params.push(title); }
      if (description !== undefined) { setFields.push('description = ?'); params.push(description); }
      if (source !== undefined) { setFields.push('source = ?'); params.push(source); }
      if (link !== undefined) { setFields.push('link = ?'); params.push(link); }
      if (event_date !== undefined) { setFields.push('event_date = ?'); params.push(event_date); }
      if (Object.prototype.hasOwnProperty.call(updates, 'chunk_status')) {
        setFields.push('chunk_status = ?');
        params.push(updates.chunk_status ?? null);
      }
      if (metadata !== undefined) { 
        setFields.push('metadata = ?'); 
        params.push(JSON.stringify(metadata)); 
      }
      
      // Always update timestamp
      setFields.push('updated_at = ?');
      params.push(now, id); // id for WHERE clause

      if (setFields.length > 1) { // More than just updated_at
        const stmt = sqlite.prepare(`UPDATE nodes SET ${setFields.join(', ')} WHERE id = ?`);
        stmt.run(...params);
      }

      // Handle dimensions separately
      if (Array.isArray(dimensions)) {
        sqlite.prepare('DELETE FROM node_dimensions WHERE node_id = ?').run(id);
        const dimStmt = sqlite.prepare('INSERT OR IGNORE INTO node_dimensions (node_id, dimension) VALUES (?, ?)');
        for (const dim of dimensions) {
          dimStmt.run(id, dim);
        }
      }
    });

    // Get updated node
    const updatedNode = await this.getNodeByIdSQLite(id);
    if (!updatedNode) {
      throw new Error(`Node with ID ${id} not found`);
    }

    // Broadcast node update event
    eventBroadcaster.broadcast({
      type: 'NODE_UPDATED',
      data: { nodeId: id, node: updatedNode }
    });

    return updatedNode;
  }

  async deleteNode(id: number): Promise<void> {
    return this.deleteNodeSQLite(id);
  }

  // PostgreSQL path removed in SQLite-only consolidation

  private async deleteNodeSQLite(id: number): Promise<void> {
    const sqlite = getSQLiteClient();
    
    const result = sqlite.query('DELETE FROM nodes WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      throw new Error(`Node with ID ${id} not found`);
    }

    // Broadcast node deletion event
    eventBroadcaster.broadcast({
      type: 'NODE_DELETED',
      data: { nodeId: id }
    });
  }

  // Dimension-based filtering methods
  async getNodesByDimension(dimension: string): Promise<Node[]> {
    return this.getNodes({ dimensions: [dimension] });
  }

  async searchNodes(searchTerm: string, limit = 50): Promise<Node[]> {
    return this.getNodes({ search: searchTerm, limit });
  }

  private mapNodeRow(row: NodeRow): Node {
    return {
      ...row,
      dimensions: JSON.parse(row.dimensions_json || '[]'),
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
    };
  }

  private buildNodeFilterClauses(filters: NodeFilters, alias = 'n'): { clauses: string[]; params: any[] } {
    const {
      dimensions,
      dimensionsMatch = 'any',
      createdAfter,
      createdBefore,
      eventAfter,
      eventBefore,
    } = filters;

    const clauses: string[] = [];
    const params: any[] = [];

    if (dimensions && dimensions.length > 0) {
      if (dimensionsMatch === 'all' && dimensions.length > 1) {
        clauses.push(`(
          SELECT COUNT(DISTINCT nd.dimension) FROM node_dimensions nd
          WHERE nd.node_id = ${alias}.id
          AND nd.dimension IN (${dimensions.map(() => '?').join(',')})
        ) = ?`);
        params.push(...dimensions, dimensions.length);
      } else {
        clauses.push(`EXISTS (
          SELECT 1 FROM node_dimensions nd
          WHERE nd.node_id = ${alias}.id
          AND nd.dimension IN (${dimensions.map(() => '?').join(',')})
        )`);
        params.push(...dimensions);
      }
    }

    if (createdAfter) { clauses.push(`${alias}.created_at >= ?`); params.push(createdAfter); }
    if (createdBefore) { clauses.push(`${alias}.created_at < ?`); params.push(createdBefore); }
    if (eventAfter) { clauses.push(`${alias}.event_date >= ?`); params.push(eventAfter); }
    if (eventBefore) { clauses.push(`${alias}.event_date < ?`); params.push(eventBefore); }

    return { clauses, params };
  }

  private async searchNodesSQLite(filters: NodeFilters): Promise<Node[]> {
    const sqlite = getSQLiteClient();
    const search = filters.search?.trim();
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 100);
    const offset = Math.max(filters.offset ?? 0, 0);

    if (!search) {
      return [];
    }

    const searchLimit = Math.max(limit + offset, Math.min(limit * 5, 100));
    let rankedRows = this.searchNodesFts(sqlite, search, filters, searchLimit);

    if (rankedRows.length === 0) {
      rankedRows = this.searchNodesLike(sqlite, search, filters, searchLimit);
    }

    if (rankedRows.length === 0) {
      rankedRows = this.searchNodesLikeRelaxed(sqlite, search, filters, searchLimit);
    }

    if ((filters.searchMode ?? 'standard') === 'hybrid') {
      const vectorRows = await this.searchNodesVector(sqlite, search, filters, searchLimit);
      if (vectorRows.length > 0) {
        rankedRows = reciprocalRankFuse<NodeSearchRow>([rankedRows, vectorRows], searchLimit);
      }
    }

    return rankedRows
      .slice(offset, offset + limit)
      .map(row => this.mapNodeRow(row));
  }

  private countSearchNodesSQLite(filters: NodeFilters): number {
    const sqlite = getSQLiteClient();
    const search = filters.search?.trim();
    if (!search) return 0;

    const ftsQuery = sanitizeFtsQuery(search);
    const ftsExists = sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='nodes_fts'"
    ).get();
    const { clauses, params } = this.buildNodeFilterClauses(filters);

    if (ftsExists && ftsQuery) {
      const whereClauses = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const result = sqlite.query<{ total: number }>(`
        WITH matched_nodes AS (
          SELECT rowid
          FROM nodes_fts
          WHERE nodes_fts MATCH ?
        )
        SELECT COUNT(*) as total
        FROM matched_nodes mn
        JOIN nodes n ON n.id = mn.rowid
        ${whereClauses}
      `, [ftsQuery, ...params]);

      return Number(result.rows[0]?.total ?? 0);
    }

    const words = search.split(/\s+/).filter(Boolean);
    let query = `SELECT COUNT(*) as total FROM nodes n WHERE 1=1`;
    const queryParams = [...params];

    if (clauses.length > 0) {
      query += ` AND ${clauses.join(' AND ')}`;
    }

    for (const word of words) {
      query += ` AND (n.title LIKE ? COLLATE NOCASE OR n.description LIKE ? COLLATE NOCASE OR n.source LIKE ? COLLATE NOCASE)`;
      queryParams.push(`%${word}%`, `%${word}%`, `%${word}%`);
    }

    const result = sqlite.query<{ total: number }>(query, queryParams);
    return Number(result.rows[0]?.total ?? 0);
  }

  private searchNodesFts(
    sqlite: ReturnType<typeof getSQLiteClient>,
    search: string,
    filters: NodeFilters,
    limit: number,
  ): NodeSearchRow[] {
    const ftsQuery = sanitizeFtsQuery(search);
    if (!ftsQuery) return [];

    const ftsExists = sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='nodes_fts'"
    ).get();
    if (!ftsExists) return [];

    const { clauses, params } = this.buildNodeFilterClauses(filters);
    const whereClauses = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    try {
      const result = sqlite.query<NodeSearchRow>(`
        WITH fts_matches AS (
          SELECT rowid, rank
          FROM nodes_fts
          WHERE nodes_fts MATCH ?
          LIMIT ?
        )
        SELECT n.id, n.title, n.description, n.source, n.link, n.event_date, n.metadata,
               n.chunk_status, n.embedding_updated_at, n.embedding_text,
               n.created_at, n.updated_at,
               COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                         FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json,
               fm.rank
        FROM fts_matches fm
        JOIN nodes n ON n.id = fm.rowid
        ${whereClauses}
        ORDER BY fm.rank
        LIMIT ?
      `, [ftsQuery, Math.max(limit * 2, 50), ...params, limit]);

      return result.rows;
    } catch (error) {
      console.warn('[NodeSearch] FTS search failed, falling back to LIKE:', error);
      return [];
    }
  }

  private searchNodesLike(
    sqlite: ReturnType<typeof getSQLiteClient>,
    search: string,
    filters: NodeFilters,
    limit: number,
  ): NodeSearchRow[] {
    const words = search.split(/\s+/).filter(Boolean);
    const { clauses, params } = this.buildNodeFilterClauses(filters);
    let query = `
      SELECT n.id, n.title, n.description, n.source, n.link, n.event_date, n.metadata,
             n.chunk_status, n.embedding_updated_at, n.embedding_text,
             n.created_at, n.updated_at,
             COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                       FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json
      FROM nodes n
      WHERE 1=1
    `;
    const queryParams = [...params];

    if (clauses.length > 0) {
      query += ` AND ${clauses.join(' AND ')}`;
    }

    for (const word of words) {
      query += ` AND (n.title LIKE ? COLLATE NOCASE OR n.description LIKE ? COLLATE NOCASE OR n.source LIKE ? COLLATE NOCASE)`;
      queryParams.push(`%${word}%`, `%${word}%`, `%${word}%`);
    }

    query += ` ORDER BY
      CASE WHEN LOWER(n.title) = LOWER(?) THEN 1 ELSE 6 END,
      CASE WHEN LOWER(n.title) LIKE LOWER(?) THEN 2 ELSE 6 END,
      CASE WHEN n.title LIKE ? COLLATE NOCASE THEN 3 ELSE 6 END,
      CASE WHEN n.description LIKE ? COLLATE NOCASE THEN 4 ELSE 6 END,
      CASE WHEN n.source LIKE ? COLLATE NOCASE THEN 5 ELSE 6 END,
      n.updated_at DESC
      LIMIT ?`;

    queryParams.push(search, `${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, limit);

    const result = sqlite.query<NodeSearchRow>(query, queryParams);
    return result.rows;
  }

  private searchNodesLikeRelaxed(
    sqlite: ReturnType<typeof getSQLiteClient>,
    search: string,
    filters: NodeFilters,
    limit: number,
  ): NodeSearchRow[] {
    const terms = extractRelaxedSearchTerms(search);
    if (terms.length === 0) return [];

    const { clauses, params } = this.buildNodeFilterClauses(filters);
    let query = `
      SELECT n.id, n.title, n.description, n.source, n.link, n.event_date, n.metadata,
             n.chunk_status, n.embedding_updated_at, n.embedding_text,
             n.created_at, n.updated_at,
             COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                       FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json
      FROM nodes n
      WHERE 1=1
    `;
    const queryParams = [...params];

    if (clauses.length > 0) {
      query += ` AND ${clauses.join(' AND ')}`;
    }

    const termClauses: string[] = [];
    for (const term of terms) {
      termClauses.push(`n.title LIKE ? COLLATE NOCASE`);
      termClauses.push(`n.description LIKE ? COLLATE NOCASE`);
      termClauses.push(`n.source LIKE ? COLLATE NOCASE`);
      queryParams.push(`%${term}%`, `%${term}%`, `%${term}%`);
    }

    query += ` AND (${termClauses.join(' OR ')})`;

    const scoreClauses: string[] = [];
    const scoreParams: string[] = [];
    for (const term of terms) {
      scoreClauses.push(`CASE WHEN n.title LIKE ? COLLATE NOCASE THEN 3 ELSE 0 END`);
      scoreClauses.push(`CASE WHEN n.description LIKE ? COLLATE NOCASE THEN 2 ELSE 0 END`);
      scoreClauses.push(`CASE WHEN n.source LIKE ? COLLATE NOCASE THEN 1 ELSE 0 END`);
      scoreParams.push(`%${term}%`, `%${term}%`, `%${term}%`);
    }

    query += ` ORDER BY
      (${scoreClauses.join(' + ')}) DESC,
      CASE WHEN LOWER(n.title) LIKE LOWER(?) THEN 0 ELSE 1 END,
      n.updated_at DESC
      LIMIT ?`;

    queryParams.push(...scoreParams, `%${search}%`, limit);

    const result = sqlite.query<NodeSearchRow>(query, queryParams);
    return result.rows;
  }

  private async searchNodesVector(
    sqlite: ReturnType<typeof getSQLiteClient>,
    search: string,
    filters: NodeFilters,
    limit: number,
  ): Promise<NodeSearchRow[]> {
    try {
      const embedding = await EmbeddingService.generateQueryEmbedding(search);
      if (!EmbeddingService.validateEmbedding(embedding)) {
        return [];
      }

      const vecExists = sqlite.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='vec_nodes'"
      ).get();
      if (!vecExists) return [];

      const vectorString = `[${embedding.join(',')}]`;
      const { clauses, params } = this.buildNodeFilterClauses(filters);
      const whereClauses = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

      const result = sqlite.query<NodeSearchRow>(`
        WITH vector_matches AS (
          SELECT node_id, distance
          FROM vec_nodes
          WHERE embedding MATCH ?
          ORDER BY distance
          LIMIT ?
        )
        SELECT n.id, n.title, n.description, n.source, n.link, n.event_date, n.metadata,
               n.chunk_status, n.embedding_updated_at, n.embedding_text,
               n.created_at, n.updated_at,
               COALESCE((SELECT JSON_GROUP_ARRAY(d.dimension)
                         FROM node_dimensions d WHERE d.node_id = n.id), '[]') as dimensions_json,
               (1.0 / (1.0 + vm.distance)) AS similarity
        FROM vector_matches vm
        JOIN nodes n ON n.id = vm.node_id
        ${whereClauses}
        ORDER BY vm.distance
        LIMIT ?
      `, [vectorString, Math.max(limit * 2, 50), ...params, limit]);

      return result.rows;
    } catch (error) {
      console.warn('[NodeSearch] Vector search unavailable, continuing without it:', error);
      return [];
    }
  }

  async getNodeCount(): Promise<number> {
    const sqlite = getSQLiteClient();
    const result = sqlite.query('SELECT COUNT(*) as count FROM nodes');
    return Number(result.rows[0].count);
  }

  async bulkUpdateNodes(ids: number[], updates: Partial<Node>): Promise<Node[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.bulkUpdateNodesSQLite(ids, updates);
  }

  // PostgreSQL path removed in SQLite-only consolidation

  private async bulkUpdateNodesSQLite(ids: number[], updates: Partial<Node>): Promise<Node[]> {
    // For SQLite, use IN (SELECT value FROM json_each(?)) for safety
    const sqlite = getSQLiteClient();
    const idsJson = JSON.stringify(ids);
    
    // For now, just update one by one - could optimize later
    const updatedNodes: Node[] = [];
    for (const id of ids) {
      const updated = await this.updateNodeSQLite(id, updates);
      updatedNodes.push(updated);
    }
    return updatedNodes;
  }

  // Get all unique dimensions for UI filtering
  async getAllDimensions(): Promise<string[]> {
    const sqlite = getSQLiteClient();
    const query = `
      SELECT DISTINCT dimension 
      FROM node_dimensions 
      ORDER BY dimension
    `;
    const result = sqlite.query<{dimension: string}>(query);
    return result.rows.map(row => row.dimension);
  }

  // Get dimension usage statistics
  async getDimensionStats(): Promise<{dimension: string, count: number}[]> {
    const sqlite = getSQLiteClient();
    const query = `
      SELECT dimension, COUNT(*) as count
      FROM node_dimensions 
      GROUP BY dimension
      ORDER BY count DESC
    `;
    const result = sqlite.query<{dimension: string, count: number}>(query);
    return result.rows;
  }

}

// Export singleton instance
export const nodeService = new NodeService();

// Legacy export for backwards compatibility during migration
export const itemService = nodeService;
export const ItemService = NodeService;
