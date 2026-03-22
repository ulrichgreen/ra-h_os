# MCP Server

> Connect Claude Code and other AI assistants to your knowledge base.

**How it works:** RA-OS includes an MCP (Model Context Protocol) server. This lets any MCP-compatible assistant — like Claude Code — search your knowledge graph, add new knowledge, and manage your graph. Everything stays local.

---

## Quick Start (Recommended)

The easiest way is using the npm package:

```json
{
  "mcpServers": {
    "ra-h": {
      "command": "npx",
      "args": ["ra-h-mcp-server"]
    }
  }
}
```

Add this to your `~/.claude.json` (Claude Code) or Claude Desktop settings.

**Requirements:**
- Node.js 18+ installed

**That's it.** The database is created automatically on first connection. No need to keep RA-OS running.

---

## Alternative: Local Development

If you're developing RA-OS and want to use the local server:

### Standalone (No Web App Required)

```json
{
  "mcpServers": {
    "ra-h": {
      "command": "node",
      "args": ["/path/to/ra-h_os/apps/mcp-server-standalone/index.js"]
    }
  }
}
```

First install dependencies:
```bash
cd apps/mcp-server-standalone
npm install
```

### HTTP Transport (Web App Required)

If you want real-time UI updates when nodes are created:

1. Start RA-OS: `npm run dev`
2. Configure:

```json
{
  "mcpServers": {
    "ra-h": {
      "url": "http://127.0.0.1:44145/mcp"
    }
  }
}
```

---

## Available Tools

| Tool | Description |
|------|-------------|
| `getContext` | Get graph overview — stats, hub nodes, dimensions, recent activity. Called first automatically. |
| `createNode` | Create a new node (title/source/dimensions) |
| `queryNodes` | Search existing nodes by keyword |
| `updateNode` | Update an existing node |
| `getNodesById` | Get nodes by ID |
| `createEdge` | Create relationship between nodes |
| `updateEdge` | Update an edge explanation |
| `queryEdge` | Query existing edges |
| `queryDimensions` | List all dimensions |
| `createDimension` | Create a new dimension |
| `updateDimension` | Update/rename dimension |
| `deleteDimension` | Delete a dimension |
| `listSkills` | List available skills |
| `readSkill` | Read a skill by name |
| `writeSkill` | Create or update a custom skill |
| `deleteSkill` | Delete a custom skill |
| `searchContentEmbeddings` | Search extracted source content |
| `sqliteQuery` | Run read-only SQL queries |

---

## What to Expect

Once connected, the MCP server instructs Claude to:

1. **Call `getContext` first** to orient itself (hub nodes, dimensions, stats, available skills)
2. **Proactively capture knowledge** — when a new insight, decision, person, or reference surfaces, it proposes a specific node (title, dimensions, description) so you can approve with minimal friction
3. **Read skills for complex tasks** — skills provide reusable procedural instructions for graph operations and workflows
4. **Search before creating** to avoid duplicates

You don't need to ask Claude to use your knowledge base — it will offer when it spots something worth saving.

---

## Example Usage

Once connected, you can ask your AI assistant:

```
"What's in my knowledge graph?"
"Search RA-H for what I wrote about product strategy"
"Add this conversation summary to RA-H as a new node"
"Find all nodes with the 'research' dimension"
"Create an edge between node 123 and node 456"
```

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/mcp-server-standalone/` | **Standalone server (direct SQLite, recommended)** |
| `apps/mcp-server/server.js` | HTTP MCP server |
| `apps/mcp-server/stdio-server.js` | STDIO bridge to HTTP server |

---

## Security

- The MCP server only binds to `127.0.0.1` — localhost only
- No authentication required (local access only)
- All data persisted to `~/Library/Application Support/RA-H/db/rah.sqlite`

---

## Troubleshooting

### "Database not found"

The MCP server auto-creates the database on first connection (v1.1.0+). If you're on an older version, run RA-OS once to create it:
```bash
npm run dev
```

### "Tools not showing" (npm package)

1. Make sure Node.js 18+ is installed: `node --version`
2. Try running manually: `npx ra-h-mcp-server`
3. Restart Claude Code

### "Connection refused" (HTTP method)

1. Make sure RA-OS is running: `npm run dev`
2. Check the port: `lsof -i :44145`
