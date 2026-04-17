# RA-H MCP Server

Connect Claude Code and Claude Desktop to your RA-H knowledge base. This package talks directly to an existing RA-H SQLite database.

## Install

```bash
npx --yes ra-h-mcp-server@2.1.2
```

Run RA-H once first so the database exists, then use the MCP server from any client.

Important contract:
- pinned package version recommended
- standalone MCP reads and writes node data directly
- standalone MCP does not own chunking, embeddings, or live schema migration on an existing DB

## Configure Claude Code / Claude Desktop

Add to your Claude config (`~/.claude.json` or Claude Desktop settings):

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

Restart Claude fully. Done.

If you publish a newer MCP release and need this client to pick it up immediately, bump the pinned version here and restart Claude. Do not assume plain `npx ra-h-mcp-server` always refreshes instantly.

## Requirements

- Node.js 18-22 LTS recommended
- an existing RA-H database at `~/Library/Application Support/RA-H/db/rah.sqlite`
- run the RA-H app at least once before using the standalone MCP server

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RAH_DB_PATH` | `~/Library/Application Support/RA-H/db/rah.sqlite` | Database path |

## What To Expect

Once connected, the agent should:
- use `queryNodes` for explicit node lookup when the user is trying to find a specific existing thing
- use `retrieveQueryContext` when graph context is helpful for a broader task, question, or request
- use `getContext` only for orientation when high-level graph state would actually help
- treat context as optional by default
- search before creating to avoid duplicates
- propose likely edges first, then create them only after explicit confirmation
- read skills for more complex tasks

## Source Processing

- the standalone MCP server stores source text on the node
- it does **not** split source into chunks or generate embeddings itself
- the RA-H app owns chunking and embedding when the app is running
- if the app is closed, writes still land in `nodes.source`, and the app processes them later

## Recommended Agent Memory Line

If you use external agents through this MCP server, you may add one short instruction line to your agent memory file (`AGENTS.md`, `CLAUDE.md`, etc.) as optional reinforcement:

```md
Retrieve relevant RA-H context before substantive work, search before creating, and keep durable writeback prompts brief and confirmation-gated.
```

RA-H should still work well without this line. The MCP tools, server instructions, skills, and docs are meant to carry the core behavior on their own.

Do not create contradictory instruction files. Prefer one short reinforcement line over a pile of overlapping guidance.

## Available Tools

| Tool | Description |
|------|-------------|
| `getContext` | Get graph overview - stats, hub nodes, recent activity |
| `retrieveQueryContext` | Pull relevant graph context for a broader current-turn task |
| `createNode` | Create a new node |
| `queryNodes` | Search nodes by keyword |
| `getNodesById` | Load nodes by ID |
| `updateNode` | Update an existing node |
| `createEdge` | Create a confirmed connection between nodes |
| `updateEdge` | Update an edge explanation after explicit confirmation |
| `queryEdge` | Find edges for a node |
| `listSkills` | List available skills |
| `readSkill` | Read a skill by name |
| `writeSkill` | Create or update a skill |
| `deleteSkill` | Delete a skill |
| `searchContentEmbeddings` | Search through source content |
| `sqliteQuery` | Execute read-only SQL queries (`SELECT` / `WITH` / `PRAGMA`) |

Verification tip:
- after config changes, fully restart the client and confirm you can see tools like `queryNodes`, `retrieveQueryContext`, and `createNode`

## Node Metadata Contract

When `createNode` or `updateNode` includes metadata, prefer the canonical shape:

```json
{
  "type": "website | youtube | pdf | tweet | note | chat | ...",
  "state": "processed | not_processed",
  "captured_method": "quick_add_note | website_extract | ...",
  "captured_by": "human | agent",
  "source_metadata": {}
}
```

Rules:
- `source_metadata` is for small factual source-specific fields only
- metadata updates merge with the existing object; they do not replace the full blob
- use `captured_by = "human"` for direct user creation and user-requested agent capture
- reserve `captured_by = "agent"` for autonomous/background creation only

## Writeback Rule

- do not ask to save every moderately useful point from the conversation
- only suggest a save when the context is unusually durable and valuable
- keep the ask terse and concrete, for example: `Add "X" as a node?`

## Edge Rule

- external agents should propose likely edge candidates first
- `createEdge` is the execution tool after explicit user confirmation
- agent-driven edge creation should always include a clear explanation sentence

## Skills

Skills are editable and shared across internal and external agents.

Skills are stored at `~/Library/Application Support/RA-H/skills/` and shared with the main app.

## What's NOT Included

This is a lightweight CRUD server. Advanced features are handled by the main app:
- embedding generation
- AI-powered edge inference
- content extraction (URL, YouTube, PDF)
- real-time SSE events
- automatic chunking or embedding while the app is closed

## Testing

```bash
# Test database connection
node -e "const {initDatabase,query}=require('./services/sqlite-client');initDatabase();console.log(query('SELECT COUNT(*) as c FROM nodes')[0].c,'nodes')"

# Run the server
node index.js
```
