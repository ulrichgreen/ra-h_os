# MCP Surface

RA-H exposes MCP tools for direct graph work against the local database or app API.

## Core MCP Contract

- `queryNodes` is the primary tool for direct node retrieval when the user is trying to find a specific existing node.
- `retrieveQueryContext` is the primary retrieval entrypoint for substantive current-turn work when the agent needs graph context to support a broader answer.
- `getContext` returns graph orientation: stats, contexts, hubs, and skills.
- `createNode`, `updateNode`, and `queryNodes` leave context blank by default.
- If context is intentionally provided, prefer `context_name`.
- `context_id` is an internal implementation detail, not the normal agent-facing field.
- `writeContext` writes one confirmed durable context node and must never be called before explicit user approval.
- `createEdge` is a post-confirmation execution tool. Agents should propose likely edges first and only write them after the user explicitly confirms.
- `updateEdge` is also a post-confirmation execution tool. Agents should only correct an edge after the user explicitly confirms the corrected relationship.
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
- Optional user memory reinforcement can help, but the MCP tools, instructions, skills, and docs should be enough for the core retrieval and writeback contract to work.
- Prefer explicit context assignment only when the user clearly wants it and a real context is already known.
- Use `context_name` when context is intentionally provided.
- Do not assume the agent needs to think about context during normal node creation, lookup, or update flows.
- Do not assume the server will infer a best-fit context.
- If the user explicitly asked to save or update something and the target artifact is clear, the agent can write after duplicate/update checks.
- If the agent is only suggesting a save, it should propose the node first and wait for confirmation.
- When obvious relationships appear, propose candidate edges briefly rather than writing them automatically.
- Judge graph quality by node quality and edges, not taxonomy completeness.
- Keep writeback prompts terse and selective. The goal is not to ask constantly whether every useful sentence should be saved.
