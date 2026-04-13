import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/database/sqlite-client', () => ({
  getSQLiteClient: vi.fn(),
}));

vi.mock('@/services/database/nodes', () => ({
  nodeService: {
    getNodes: vi.fn(),
  },
}));

import { getSQLiteClient } from '@/services/database/sqlite-client';
import { ContextService, MAX_CONTEXTS_PER_ACCOUNT } from '@/services/database/contextService';

type QueryResult = { rows: Array<Record<string, unknown>> };

describe('ContextService', () => {
  const query = vi.fn<(...args: unknown[]) => QueryResult>();
  const run = vi.fn();
  const prepare = vi.fn(() => ({ run }));
  const sqlite = { query, prepare };

  beforeEach(() => {
    query.mockReset();
    prepare.mockClear();
    run.mockReset();
    vi.mocked(getSQLiteClient).mockReturnValue(sqlite as never);
  });

  it('rejects creating a context once the account reaches the hard cap', async () => {
    query.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('WHERE LOWER(TRIM(name))')) {
        return { rows: [] };
      }
      if (text.includes('SELECT COUNT(*) AS count')) {
        return { rows: [{ count: MAX_CONTEXTS_PER_ACCOUNT }] };
      }
      return { rows: [] };
    });

    const service = new ContextService();

    await expect(
      service.createContext({
        name: 'Health',
        description: 'Health-related items.',
      })
    ).rejects.toThrow(`Maximum ${MAX_CONTEXTS_PER_ACCOUNT} contexts are allowed per account.`);

    expect(prepare).not.toHaveBeenCalled();
  });

  it('creates a context when the account is below the hard cap', async () => {
    run.mockReturnValue({ lastInsertRowid: 11 });
    query.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('WHERE LOWER(TRIM(name))')) {
        return { rows: [] };
      }
      if (text.includes('SELECT COUNT(*) AS count')) {
        return { rows: [{ count: MAX_CONTEXTS_PER_ACCOUNT - 1 }] };
      }
      if (text.includes('WHERE c.id = ?')) {
        return {
          rows: [{
            id: 11,
            name: 'Health',
            description: 'Health-related items.',
            icon: null,
            count: 0,
          }],
        };
      }
      return { rows: [] };
    });

    const service = new ContextService();
    const created = await service.createContext({
      name: 'Health',
      description: 'Health-related items.',
    });

    expect(prepare).toHaveBeenCalledOnce();
    expect(created).toMatchObject({
      id: 11,
      name: 'Health',
      description: 'Health-related items.',
      icon: null,
    });
  });
});
