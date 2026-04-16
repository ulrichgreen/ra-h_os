# MCP Surface

This is the full practical setup page for the standalone open-source MCP path.

## 1. What MCP Gives You In RA-H OS

MCP lets an external agent:
- search your existing graph
- ground a broader task in relevant graph context
- create or update nodes
- propose and confirm edges
- read and write shared skills

The graph contract is:
- no runtime `dimensions`
- optional `contexts`
- direct lookup first
- broader retrieval only when useful
- confirmation-gated durable writeback and edge changes

## 2. Choose Your Assistant / Client

Best-supported path:
- Claude Code
- Claude Desktop

Also reasonable:
- Cursor and similar MCP-capable coding assistants

Prefer a client that:
- supports local stdio MCP servers well
- reliably restarts after config changes
- lets you pin one package version in config

## 3. Install The Standalone MCP Server

Requirements:
- Node.js 18-22 LTS recommended
- existing RA-H DB created by running the app once
- pinned package version in client config

Package:

```bash
npx --yes ra-h-mcp-server@2.1.2
```

If `better-sqlite3` fails to load:
- use Node 18-22 LTS
- rebuild native modules if you are developing locally

## 4. Configure The Assistant With A Pinned Version

Claude config example:

```json
{
  "mcpServers": {
    "ra-h": {
      "command": "npx",
      "args": ["--yes", "ra-h-mcp-server@2.1.2"]
    }
  }
}
```

Contributor local-path example:

```json
{
  "mcpServers": {
    "ra-h": {
      "command": "node",
      "args": ["/absolute/path/to/ra-h_os/apps/mcp-server-standalone/index.js"]
    }
  }
}
```

## 5. Restart And Verify The Tools Are Available

After editing config:
- fully restart the client
- do not trust a soft window close
- ask the assistant whether RA-H tools are available

Healthy verification usually means you can see tools like:
- `queryNodes`
- `retrieveQueryContext`
- `createNode`
- `readSkill`

## Core MCP Contract

- `queryNodes` is the primary tool for direct node retrieval when the user is trying to find a specific existing node.
- `retrieveQueryContext` is the primary retrieval entrypoint for substantive current-turn work when the agent needs graph context to support a broader answer.
- `getContext` returns graph orientation: stats, contexts, hubs, and skills.
- `createNode`, `updateNode`, and `queryNodes` leave context blank by default.
- If context is intentionally provided, prefer `context_name`.
- `context_id` is an internal implementation detail, not the normal agent-facing field.
- `writeContext` writes one confirmed durable context node and must never be called before explicit user approval.
- `createEdge` is a post-confirmation execution tool.
- `updateEdge` is also post-confirmation only.
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

## 6. How The Agent Should Behave With RA-H

- always search before creating
- use `queryNodes` first for specific-node intent
- use `retrieveQueryContext` when broader graph grounding would help
- keep context optional by default
- use `context_name` only when context is intentionally provided
- do not assume the server will infer a best-fit context
- if the user explicitly asked to save or update something and the target artifact is clear, the agent can write after duplicate/update checks
- if the agent is only suggesting a save, it should propose the node first and wait for confirmation
- when obvious relationships appear, propose candidate edges briefly rather than writing them automatically
- keep writeback prompts terse and selective

Do not assume MCP node creation immediately produces chunks or embeddings. The canonical contract is:
- write node data first
- app-owned pipeline later creates chunks, FTS rows, and vectors

## 7. Optional Memory-File Reinforcement

Important distinction:
- `CLAUDE.md` is an assistant-native memory/instruction file for Claude Code
- `AGENTS.md` is a repo-local instruction file many teams already use
- other clients may have their own memory or instruction surfaces

Rules:
- the MCP/tool/docs contract should work without user prompt surgery
- optional reinforcement can still improve consistency
- do not create contradictory instruction files

Short recommended reinforcement pattern:

```md
Retrieve relevant RA-H context before substantive work, search before creating, and keep durable writeback prompts brief and confirmation-gated.
```

## 8. Troubleshooting And Common Failure Cases

`Tools not found`
- fully restart the client
- verify the config path is the one your client actually uses
- run the pinned package manually once

`Database not found`
- run the RA-H app once first so the DB exists
- confirm `RAH_DB_PATH` if using a custom path

`Node writes land but embeddings/chunks are missing`
- this is usually expected when the app is closed
- standalone MCP writes node data first
- the app later processes pending `nodes.source` work

`Native module load failure`
- use Node 18-22 LTS
- rebuild `better-sqlite3` if needed for local development

`Version drift`
- pin the package version in client config
- bump the pinned version intentionally when testing a new release
