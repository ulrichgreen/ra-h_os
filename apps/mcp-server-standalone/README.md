# RA-H MCP Server

Connect Claude Code and Claude Desktop to your RA-H knowledge base. Direct SQLite access - works without the RA-H app running.

## Install

```bash
npx --yes ra-h-mcp-server@2.1.1
```

That's it. No manual setup required.

## Configure Claude Code / Claude Desktop

Add to your Claude config (`~/.claude.json` or Claude Desktop settings):

```json
{
  "mcpServers": {
    "ra-h": {
      "command": "npx",
      "args": ["--yes", "ra-h-mcp-server@2.1.1"]
    }
  }
}
```

Restart Claude. Done.

If you publish a newer MCP release and need this client to pick it up immediately, bump the pinned version here and restart Claude. Do not assume plain `npx ra-h-mcp-server` always refreshes instantly.

## Requirements

- Node.js 18+
- Database is created automatically at `~/Library/Application Support/RA-H/db/rah.sqlite` on first connection

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RAH_DB_PATH` | ~/Library/Application Support/RA-H/db/rah.sqlite | Database path |

## What to Expect

Once connected, Claude will:
- **Use `queryNodes` for explicit node lookup** when the user is trying to find a specific existing thing
- **Use `retrieveQueryContext` when graph context is helpful** for a broader task, question, or request
- **Use `getContext` only for orientation** when high-level graph state would actually help
- **Treat context as optional by default** — normal node creation and updates should omit context unless the user explicitly wants one; when context is intentionally provided, use `context_name`
- **Proactively capture knowledge** — when a new insight, decision, person, or reference surfaces, it proposes a specific node (title, description, optional context) so you can approve with minimal friction
- **Treat edges as proposal-first** — it should suggest likely relationships briefly, then create them only after you explicitly confirm
- **Read skills for complex tasks** — skills are editable and shared across internal + external agents
- **Search before creating** to avoid duplicates

## Recommended Agent Memory Line

If you use external agents through this MCP server, you may add one short instruction line to your agent memory file (`AGENTS.md`, `CLAUDE.md`, etc.) as optional reinforcement:

```md
Retrieve relevant context from RA-H before substantive work, and only suggest writing durable context back when it is clearly valuable and the user can confirm yes.
```

Keep the writeback prompt brief. A good pattern is:

```md
Add "X" as a node?
```

RA-H should still work well without this line. The MCP tools, server instructions, skills, and docs are meant to carry the core behavior on their own.

## Available Tools

| Tool | Description |
|------|-------------|
| `getContext` | Get graph overview — stats, contexts, recent activity |
| `retrieveQueryContext` | Pull relevant graph context for a broader current-turn task |
| `createNode` | Create a new node |
| `writeContext` | Save one confirmed durable context node after explicit user approval |
| `queryNodes` | Search nodes by keyword |
| `queryContexts` | List or inspect contexts |
| `getNodesById` | Load nodes by ID (includes chunk + metadata) |
| `updateNode` | Update an existing node |
| `createEdge` | Create a confirmed connection between nodes |
| `updateEdge` | Update an edge explanation after explicit confirmation |
| `queryEdge` | Find edges for a node |
| `listSkills` | List available skills |
| `readSkill` | Read a skill by name |
| `writeSkill` | Create or update a skill |
| `deleteSkill` | Delete a skill |
| `searchContentEmbeddings` | Search through source content (transcripts, books, articles) |
| `sqliteQuery` | Execute read-only SQL queries (SELECT/WITH/PRAGMA) |

## Node Metadata Contract

## Context Rule

- Creating a node never requires context.
- Normal node lookup and update flows should omit context unless the user explicitly asks for it.
- If context is intentionally provided, prefer `context_name`.
- Numeric `context_id` is treated as an internal implementation detail rather than a normal agent-facing field.

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

- Do not ask to save every moderately useful point from the conversation.
- Only suggest a save when the context is unusually durable and valuable.
- Keep the ask terse and concrete, for example: `Add "X" as a node?`
- Never call `writeContext` unless the user has explicitly said yes.

## Edge Rule

- External agents should propose likely edge candidates first.
- `createEdge` is the execution tool after explicit user confirmation.
- Agent-driven edge creation should always include a clear explanation sentence.

## Skills

Skills are detailed instruction sets that teach agents how to work with your knowledge base. The default seeded skills are editable and shared by internal + external agents.

Skills are stored at `~/Library/Application Support/RA-H/skills/` and shared with the main app.

## What's NOT Included

This is a lightweight CRUD server. Advanced features are handled by the main app:

- Embedding generation
- AI-powered edge inference
- Content extraction (URL, YouTube, PDF)
- Real-time SSE events

## Testing

```bash
# Test database connection
node -e "const {initDatabase,query}=require('./services/sqlite-client');initDatabase();console.log(query('SELECT COUNT(*) as c FROM nodes')[0].c,'nodes')"

# Run the server
node index.js
```
