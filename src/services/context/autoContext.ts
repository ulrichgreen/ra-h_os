import { getSQLiteClient } from '@/services/database/sqlite-client';

export interface AutoContextSummary {
  id: number;
  title: string;
  description: string;
  updatedAt: string;
  edgeCount: number;
}

export interface ContextAnchorSummary {
  id: number;
  title: string;
  description: string;
  updatedAt: string;
  edgeCount: number;
}

export interface PromptContextSummary {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  count: number;
  anchor: ContextAnchorSummary | null;
}

function truncate(value: string | null | undefined, maxChars: number): string {
  const trimmed = (value || '').trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}...`;
}

function fetchAutoContextRows(limit: number): AutoContextSummary[] {
  const db = getSQLiteClient();
  const rows = db
    .query<{
      id: number;
      title: string | null;
      description: string | null;
      updated_at: string;
      edge_count: number | null;
    }>(
      `
        SELECT n.id,
               n.title,
               n.description,
               n.updated_at,
               COUNT(DISTINCT e.id) AS edge_count
          FROM nodes n
          LEFT JOIN edges e
            ON (e.from_node_id = n.id OR e.to_node_id = n.id)
         GROUP BY n.id
         ORDER BY edge_count DESC, n.updated_at DESC, n.id ASC
         LIMIT ?
      `,
      [limit]
    )
    .rows;

  return rows.map((row) => ({
    id: row.id,
    title: row.title || 'Untitled node',
    description: row.description || '',
    updatedAt: row.updated_at,
    edgeCount: Number(row.edge_count ?? 0),
  }));
}

export function getHubNodes(limit = 5): AutoContextSummary[] {
  return fetchAutoContextRows(limit);
}

export function getContextSummaries(limit = 12): PromptContextSummary[] {
  const db = getSQLiteClient();
  const rows = db.query<{
    id: number;
    name: string;
    description: string | null;
    icon: string | null;
    count: number;
    anchor_id: number | null;
    anchor_title: string | null;
    anchor_description: string | null;
    anchor_updated_at: string | null;
    anchor_edge_count: number | null;
  }>(`
    WITH context_counts AS (
      SELECT c.id, c.name, c.description, c.icon, COUNT(n.id) AS count
      FROM contexts c
      LEFT JOIN nodes n ON n.context_id = c.id
      GROUP BY c.id
    ),
    ranked_anchors AS (
      SELECT
        c.id AS context_id,
        n.id AS node_id,
        n.title,
        n.description,
        n.updated_at,
        COUNT(e.id) AS edge_count,
        ROW_NUMBER() OVER (
          PARTITION BY c.id
          ORDER BY COUNT(e.id) DESC, n.updated_at DESC, n.id ASC
        ) AS anchor_rank
      FROM contexts c
      LEFT JOIN nodes n ON n.context_id = c.id
      LEFT JOIN edges e ON (e.from_node_id = n.id OR e.to_node_id = n.id)
      GROUP BY c.id, n.id
    )
    SELECT
      cc.id,
      cc.name,
      cc.description,
      cc.icon,
      cc.count,
      ra.node_id AS anchor_id,
      ra.title AS anchor_title,
      ra.description AS anchor_description,
      ra.updated_at AS anchor_updated_at,
      ra.edge_count AS anchor_edge_count
    FROM context_counts cc
    LEFT JOIN ranked_anchors ra
      ON ra.context_id = cc.id
     AND ra.anchor_rank = 1
    ORDER BY cc.name COLLATE NOCASE ASC
    LIMIT ?
  `, [limit]).rows;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    icon: row.icon ?? null,
    count: Number(row.count ?? 0),
    anchor: row.anchor_id == null ? null : {
      id: Number(row.anchor_id),
      title: row.anchor_title || 'Untitled node',
      description: row.anchor_description || '',
      updatedAt: row.anchor_updated_at || '',
      edgeCount: Number(row.anchor_edge_count ?? 0),
    },
  }));
}

export function buildContextsBlock(limit = 12): string | null {
  const contexts = getContextSummaries(limit);
  if (contexts.length === 0) {
    return null;
  }

  const lines: string[] = [
    'User Contexts',
    'Contexts are optional soft hints. Use them when they are explicit and useful, but rely primarily on title, description, source, edges, and recency.',
    '',
  ];

  contexts.forEach((context, index) => {
    const description = truncate(context.description, 140) || 'No description.';
    const iconPrefix = context.icon ? `${context.icon} ` : '';
    lines.push(`${index + 1}. ${iconPrefix}${context.name} (${context.count} nodes)`);
    lines.push(`   ${description}`);
  });

  return lines.join('\n');
}

export function buildContextAnchorsBlock(limit = 12): string | null {
  const contexts = getContextSummaries(limit).filter((context) => context.anchor);
  if (contexts.length === 0) {
    return null;
  }

  const lines: string[] = [
    'Context Anchors',
    'Each context anchor is the highest-edge node in that context. Use it only as an optional waypoint when that context is already clearly relevant.',
    '',
  ];

  contexts.forEach((context, index) => {
    const anchor = context.anchor!;
    lines.push(`${index + 1}. ${context.name}: [NODE:${anchor.id}:"${anchor.title}"] (${anchor.edgeCount} edges)`);
    if (anchor.description) {
      lines.push(`   ${truncate(anchor.description, 160)}`);
    }
  });

  return lines.join('\n');
}

export function buildHubNodesBlock(limit = 5): string | null {
  const summaries = getHubNodes(limit);
  if (summaries.length === 0) {
    return null;
  }

  const lines: string[] = [
    'Global Hub Diagnostics',
    'These are secondary graph diagnostics only. Do not treat them as the primary grounding mechanism.',
    '',
  ];

  summaries.forEach((summary, i) => {
    lines.push(`${i + 1}. [NODE:${summary.id}:"${summary.title}"] (${summary.edgeCount} edges)`);
    if (summary.description) {
      lines.push(`   ${truncate(summary.description, 140)}`);
    }
  });

  return lines.join('\n');
}

export function getAutoContextSummaries(limit = 5): AutoContextSummary[] {
  return getHubNodes(limit);
}

export function buildAutoContextBlock(limit = 5): string | null {
  return buildContextsBlock(limit);
}
