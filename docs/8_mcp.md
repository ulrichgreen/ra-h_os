# MCP Surface

RA-H exposes MCP tools for direct graph work against the local database or app API.

Important runtime distinction:

- the app MCP surface talks to the running app/API
- the standalone MCP surface talks directly to an existing SQLite DB file
- standalone MCP can read and write nodes/edges without the app running, but it does not own chunking or embedding
- if standalone MCP writes `nodes.source` while the app is closed, the app later processes that node through startup recovery

## Core MCP Contract

- `queryNodes` is the primary tool for direct node retrieval when the user is trying to find a specific existing node.
- `retrieveQueryContext` is the primary retrieval entrypoint for substantive current-turn work when the agent needs graph context to support a broader answer.
- `getContext` returns graph orientation: stats, hubs, and skills.
- `createEdge` is a post-confirmation execution tool. Agents should propose likely edges first and only write them after the user explicitly confirms.
- `queryNodes` searches title, description, and source.
- `dimensions` are removed from the MCP contract.

## Behavior Split

Internal app MCP surfaces:
- talk to the running app/API
- can participate in the live app runtime and UI refresh model

Standalone MCP:
- talks directly to an existing SQLite DB
- can read and write nodes, edges, and skills without the app running
- does not own chunking, vector generation, or schema migration on a live existing DB
- relies on the app to process pending `nodes.source` work later

## Main Tools

Read:
- `retrieveQueryContext`
- `getContext`
- `queryNodes`
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
- If the user is trying to find a specific existing node, use `queryNodes` first.
- If the user is asking a broader question that would benefit from graph context, use `retrieveQueryContext`.
- Optional user memory reinforcement can help, but the MCP tools, instructions, skills, and docs should be enough for the core retrieval and writeback contract to work.
- If the user explicitly asked to save or update something and the target artifact is clear, the agent can write after duplicate/update checks.
- If the agent is only suggesting a save, it should propose the node first and wait for confirmation.
- When obvious relationships appear, propose candidate edges briefly rather than writing them automatically.
- Judge graph quality by node quality and edges, not taxonomy completeness.
- Keep writeback prompts terse and selective. The goal is not to ask constantly whether every useful sentence should be saved.
- Do not assume MCP node creation immediately produces chunks or embeddings. The canonical contract is:
  - write node data first
  - app-owned pipeline later creates chunks, FTS rows, and vectors

## Memory-File Rule

Optional assistant memory files can reinforce good behavior, but they are not supposed to be the hidden dependency that makes RA-H work.

Current rule:
- MCP tools, server instructions, skills, and docs should be enough for the base contract
- optional reinforcement can still improve consistency
- keep one canonical memory file when possible
- avoid contradictory instruction files across `CLAUDE.md`, `AGENTS.md`, and other client-specific memory surfaces

Recommended guidance:
- keep the language short and simple
- focus on graph behavior, not tool micromanagement
- prefer one shared snippet over separate client-specific doctrines

Suggested memory-file snippet:

```md
You are helping build a thoughtful graph of atomic units of context.

- Use `queryNodes` for direct lookup of a specific existing node.
- Use `retrieveQueryContext` when broader graph context would help with the current turn.
- Search before creating. Prefer updating the same artifact when it is clearly the same thing.
- `description` should state plainly what the thing is first, then why it belongs and current status.
- Preserve the user's wording in `source` for user-authored ideas unless they explicitly want a rewrite.
```
