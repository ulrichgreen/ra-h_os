# RA-H Schema

## Core Tables

### `nodes`
- `id`
- `title`
- `description`
- `source`
- `link`
- `metadata`
- `chunk_status`
- `event_date`
- `context_id` nullable FK to `contexts.id`
- `created_at`
- `updated_at`

### `contexts`
- `id`
- `name`
- `description`
- `icon`
- `created_at`
- `updated_at`

### `edges`
- `id`
- `from_node_id`
- `to_node_id`
- `explanation`
- `context`
- `source`
- `created_at`

### `chunks`
- `id`
- `node_id`
- `chunk_idx`
- `text`
- `embedding_type`
- `metadata`
- `created_at`

### `dimension_migration_snapshots`
- Stores one-time snapshots of legacy dimension data before dropping the old tables.
- Exists for auditability and migration verification only.

## Search / Retrieval

- `nodes_fts` indexes title, description, and source for full-text lookup.
- `chunks_fts` indexes chunk text.
- Vector tables store node and chunk embeddings.

## Important Constraints

- `dimensions` and `node_dimensions` are no longer canonical tables.
- New installs should never create them.
- Existing installs migrate by snapshotting old dimension data, then dropping the legacy tables.
- `contexts` are optional. `nodes.context_id` must allow `NULL`.

## Common Queries

Nodes in a context:

```sql
SELECT *
FROM nodes
WHERE context_id = ?
ORDER BY updated_at DESC;
```

Most connected nodes:

```sql
SELECT n.id, n.title, COUNT(DISTINCT e.id) AS edge_count
FROM nodes n
LEFT JOIN edges e ON (e.from_node_id = n.id OR e.to_node_id = n.id)
GROUP BY n.id
ORDER BY edge_count DESC, n.updated_at DESC
LIMIT 10;
```

Recently updated nodes:

```sql
SELECT id, title, updated_at
FROM nodes
ORDER BY updated_at DESC
LIMIT 25;
```
