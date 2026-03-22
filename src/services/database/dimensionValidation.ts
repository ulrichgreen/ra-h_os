import { getSQLiteClient } from './sqlite-client';
import { normalizeDimensionName } from './quality';

export function getUnknownDimensions(values: string[]): string[] {
  if (values.length === 0) return [];

  const sqlite = getSQLiteClient();
  const placeholders = values.map(() => '?').join(', ');
  const result = sqlite.query<{ name: string }>(
    `SELECT name FROM dimensions WHERE name IN (${placeholders})`,
    values
  );

  const existing = new Set(
    result.rows
      .map(row => (typeof row.name === 'string' ? normalizeDimensionName(row.name) : ''))
      .filter(Boolean)
  );

  return values.filter(value => !existing.has(normalizeDimensionName(value)));
}

export function formatUnknownDimensionsError(values: string[]): string {
  if (values.length === 1) {
    return `Unknown dimension: "${values[0]}". Create it first or use an existing dimension.`;
  }

  return `Unknown dimensions: ${values.map(value => `"${value}"`).join(', ')}. Create them first or use existing dimensions.`;
}
