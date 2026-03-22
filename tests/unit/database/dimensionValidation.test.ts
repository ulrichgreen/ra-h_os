import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/database/sqlite-client', () => ({
  getSQLiteClient: vi.fn(),
}));

import { getSQLiteClient } from '@/services/database/sqlite-client';
import { formatUnknownDimensionsError, getUnknownDimensions } from '@/services/database/dimensionValidation';

describe('dimensionValidation', () => {
  it('returns dimensions missing from the canonical dimensions table', () => {
    vi.mocked(getSQLiteClient).mockReturnValue({
      query: vi.fn().mockReturnValue({
        rows: [{ name: 'ra-h' }, { name: 'ai' }],
      }),
    } as unknown as ReturnType<typeof getSQLiteClient>);

    expect(getUnknownDimensions(['ra-h', 'Building RA-H — Personal Knowledge Graph', 'ai'])).toEqual([
      'Building RA-H — Personal Knowledge Graph',
    ]);
  });

  it('formats a clear error for unknown dimensions', () => {
    expect(formatUnknownDimensionsError(['Building RA-H — Personal Knowledge Graph']))
      .toBe('Unknown dimension: "Building RA-H — Personal Knowledge Graph". Create it first or use an existing dimension.');
  });
});
