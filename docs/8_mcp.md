# MCP Surface

RA-H exposes MCP tools for direct graph work against the local database or app API.

## Core MCP Contract

- `getContext` returns graph orientation: stats, contexts, hubs, and skills.
- `createNode` and `updateNode` accept optional `context_id` but do not require context.
- `queryNodes` searches title, description, and source, with optional context filters.
- `dimensions` are removed from the MCP contract.

## Main Tools

Read:
- `getContext`
- `queryNodes`
- `queryContexts`
- `getNodesById`
- `queryEdge`
- `listSkills`
- `readSkill`
- `searchContentEmbeddings`
- `sqliteQuery`

Write:
- `createNode`
- `updateNode`
- `createEdge`
- `updateEdge`
- `writeSkill`
- `deleteSkill`

## Tool Behavior

- Always search before creating.
- Prefer explicit context assignment when the primary scope is clear.
- Do not expect automatic context assignment.
- Judge graph quality by node quality and edges, not taxonomy completeness.
