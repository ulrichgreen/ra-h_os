import { getSQLiteClient } from './sqlite-client';
import type { Context, ContextSummary, Node } from '@/types/database';
import { nodeService } from './nodes';

type ContextRow = Context;
export const MAX_CONTEXTS_PER_ACCOUNT = 10;

function normalizeContextName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function assertContextName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new Error('Context name is required.');
  }
  const normalized = normalizeContextName(name);
  if (!normalized) {
    throw new Error('Context name is required.');
  }
  return normalized;
}

function assertContextDescription(description: unknown): string {
  if (typeof description !== 'string') {
    throw new Error('Context description is required.');
  }
  const normalized = description.trim();
  if (!normalized) {
    throw new Error('Context description is required.');
  }
  return normalized;
}

function mapContextRow(row: ContextRow): Context {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description ?? null,
    icon: row.icon ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ContextService {
  async listContexts(): Promise<ContextSummary[]> {
    const sqlite = getSQLiteClient();
    const rows = sqlite.query<ContextSummary>(`
      SELECT c.id, c.name, c.description, c.icon, COUNT(n.id) as count
      FROM contexts c
      LEFT JOIN nodes n ON n.context_id = c.id
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE ASC
    `).rows;

    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      description: row.description ?? null,
      icon: row.icon ?? null,
      count: Number(row.count ?? 0),
    }));
  }

  async getContextById(id: number): Promise<ContextSummary | null> {
    const sqlite = getSQLiteClient();
    const row = sqlite.query<ContextSummary>(`
      SELECT c.id, c.name, c.description, c.icon, COUNT(n.id) as count
      FROM contexts c
      LEFT JOIN nodes n ON n.context_id = c.id
      WHERE c.id = ?
      GROUP BY c.id
    `, [id]).rows[0];

    if (!row) return null;

    return {
      id: Number(row.id),
      name: row.name,
      description: row.description ?? null,
      icon: row.icon ?? null,
      count: Number(row.count ?? 0),
    };
  }

  async getContextByName(name: string): Promise<Context | null> {
    const normalized = assertContextName(name);
    const sqlite = getSQLiteClient();
    const row = sqlite.query<ContextRow>(`
      SELECT id, name, description, icon, created_at, updated_at
      FROM contexts
      WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
      LIMIT 1
    `, [normalized]).rows[0];

    return row ? mapContextRow(row) : null;
  }

  async createContext(input: { name: string; description: string; icon?: string | null }): Promise<Context> {
    const name = assertContextName(input.name);
    const description = assertContextDescription(input.description);
    const icon = typeof input.icon === 'string' && input.icon.trim() ? input.icon.trim() : null;
    const sqlite = getSQLiteClient();
    const now = new Date().toISOString();

    const existing = await this.getContextByName(name);
    if (existing) {
      throw new Error(`Context "${name}" already exists.`);
    }

    const contextCountRow = sqlite.query<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM contexts
    `).rows[0];
    const existingCount = Number(contextCountRow?.count ?? 0);
    if (existingCount >= MAX_CONTEXTS_PER_ACCOUNT) {
      throw new Error(`Context limit reached. Maximum ${MAX_CONTEXTS_PER_ACCOUNT} contexts are allowed per account.`);
    }

    const result = sqlite.prepare(`
      INSERT INTO contexts (name, description, icon, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, description, icon, now, now);

    const created = await this.getContextById(Number(result.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to create context.');
    }

    return {
      ...created,
      created_at: now,
      updated_at: now,
    };
  }

  async updateContext(input: { id: number; name?: string; description?: string; icon?: string | null }): Promise<Context> {
    const sqlite = getSQLiteClient();
    const existing = sqlite.query<ContextRow>(`
      SELECT id, name, description, icon, created_at, updated_at
      FROM contexts
      WHERE id = ?
    `, [input.id]).rows[0];

    if (!existing) {
      throw new Error(`Context ${input.id} not found.`);
    }

    const nextName = input.name !== undefined ? assertContextName(input.name) : existing.name;
    const nextDescription = input.description !== undefined
      ? assertContextDescription(input.description)
      : existing.description;
    const nextIcon = input.icon !== undefined
      ? (typeof input.icon === 'string' && input.icon.trim() ? input.icon.trim() : null)
      : existing.icon;

    const conflicting = sqlite.query<{ id: number }>(`
      SELECT id FROM contexts
      WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
        AND id != ?
      LIMIT 1
    `, [nextName, input.id]).rows[0];

    if (conflicting) {
      throw new Error(`Context "${nextName}" already exists.`);
    }

    const now = new Date().toISOString();
    sqlite.prepare(`
      UPDATE contexts
      SET name = ?, description = ?, icon = ?, updated_at = ?
      WHERE id = ?
    `).run(nextName, nextDescription, nextIcon, now, input.id);

    return {
      id: input.id,
      name: nextName,
      description: nextDescription ?? null,
      icon: nextIcon ?? null,
      created_at: existing.created_at,
      updated_at: now,
    };
  }

  async getNodesForContext(id: number): Promise<Node[]> {
    return nodeService.getNodes({ contextId: id, limit: 500 });
  }

  async resolveContextId(input: { context_id?: number | null; context_name?: string | null }): Promise<number | null | undefined> {
    const hasContextId =
      Object.prototype.hasOwnProperty.call(input, 'context_id') &&
      input.context_id !== undefined;
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

    let resolvedById: Context | null = null;
    if (hasContextId) {
      if (typeof input.context_id !== 'number' || !Number.isInteger(input.context_id) || input.context_id <= 0) {
        throw new Error('context_id must be a positive integer or null.');
      }
      const byId = await this.getContextById(input.context_id);
      if (!byId) {
        throw new Error(`Context ${input.context_id} not found.`);
      }
      resolvedById = {
        ...byId,
        created_at: '',
        updated_at: '',
      };
    }

    if (hasContextName) {
      const byName = await this.getContextByName(input.context_name!);
      if (!byName) {
        throw new Error(`Context "${input.context_name}" not found.`);
      }
      if (resolvedById && resolvedById.id !== byName.id) {
        throw new Error('context_id and context_name refer to different contexts.');
      }
      return byName.id;
    }

    return resolvedById?.id;
  }
}

export const contextService = new ContextService();
