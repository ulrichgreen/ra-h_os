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
- `vec_nodes` stores node-level vectors.
- `vec_chunks` stores chunk-level vectors.
- Full-text search and vector search are separate surfaces:
  - FTS uses `nodes_fts` / `chunks_fts`
  - semantic/vector retrieval uses `vec_nodes` / `vec_chunks`
  - retrieval can combine them, but they should not be described as the same thing

## Embedding Lifecycle

- `nodes.source` is the canonical long-form field for chunking and chunk embeddings.
- Creating or changing `nodes.source` must put the node back through the app-owned chunk pipeline so the `chunks` rows, `chunks_fts`, and `vec_chunks` state reflect the latest source.
- Standalone MCP can write `nodes.source`, but it does not directly create `chunks` or vector rows. The app later processes those pending nodes.
- Deleting a node must remove dependent chunk rows and must not leave stale node/chunk search or vector state behind.
- Node-level embeddings are a separate surface from chunk embeddings. The contract for what feeds the node-level embedding must be explicit, and updates to those fields must trigger a fresh node-level embedding run.
- Integrity and degraded-mode checks must cover both search surfaces and embedding-related write surfaces, not just top-level node reads.

## Edge Contract

- `edges.explanation` is now a top-level field and should be treated as the human-readable reason the connection exists.
- `edges.context` still exists as structured JSON for inferred type, confidence, and creation metadata.
- docs should not describe edge context JSON as if it is the only user-facing explanation surface.

## Important Constraints

- `dimensions` and `node_dimensions` are no longer canonical tables.
- New installs should never create them.
- Existing installs migrate by snapshotting old dimension data, then dropping the legacy tables.
- FTS repair and integrity handling are now operational concerns. Do not describe automatic live rebuild behavior as normal product behavior.

## Common Queries

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
