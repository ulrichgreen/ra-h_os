# MCP Surface

RA-H exposes MCP tools for direct graph work against the local database or app API.

## Core MCP Contract

- `queryNodes` is the primary tool for direct node retrieval when the user is trying to find a specific existing node.
- `retrieveQueryContext` is the primary retrieval entrypoint for substantive current-turn work when the agent needs graph context to support a broader answer.
- `getContext` returns graph orientation: stats, contexts, hubs, and skills.
- `createNode` and `updateNode` accept optional `context_id` but do not require context. Omitting `context_id` is the normal default.
- `writeContext` writes one confirmed durable context node and must never be called before explicit user approval.
- `queryNodes` searches title, description, and source, with optional context filters.
- `dimensions` are removed from the MCP contract.

## Main Tools

Read:
- `retrieveQueryContext`
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
- `writeContext`
- `createNode`
- `updateNode`
- `createEdge`
- `updateEdge`
- `writeSkill`
- `deleteSkill`

## Tool Behavior

- Always search before creating.
- If the user is trying to find a specific existing node, use `queryNodes` first.
- If the user is asking a broader question that would benefit from graph context, use `retrieveQueryContext`.
- Prefer explicit context assignment only when the primary scope is clear and a real context is already known.
- Do not send `context_id: null` unless the tool call is intentionally clearing an existing context.
- Do not assume the server will infer a best-fit context.
- Judge graph quality by node quality and edges, not taxonomy completeness.
- Keep writeback prompts terse and selective. The goal is not to ask constantly whether every useful sentence should be saved.
