# RA-H OS Overview

## What is RA-OS?

RA-H OS is the open-source local graph surface of RA-H. It gives you the graph, UI, and MCP path without the private Mac-app-only packaging and subscription surfaces.

**Open Source:** [github.com/bradwmorris/ra-h_os](https://github.com/bradwmorris/ra-h_os)

## Design Philosophy

**Local-first** — Your knowledge network belongs to you. Everything runs locally in a SQLite database you control.

**External-agent friendly** — The open-source path is designed to work well with external MCP clients. The graph contract should not depend on prompt hacks or old taxonomy assumptions.

**Simple & focused** — The open-source surface keeps the graph, UI, and MCP contract. It does not try to mirror every private-app surface.

## Tech Stack

- **Frontend:** Next.js 15, TypeScript, Tailwind CSS
- **Database:** SQLite + sqlite-vec (vector search)
- **Embeddings:** OpenAI (BYO API key)
- **MCP Server:** Local connector for Claude Code and external agents

## What's Included

- Multi-pane UI for feed, contexts, map, table, node focus, and skills
- Node/Edge CRUD with optional contexts
- Full-text and semantic search
- MCP server with graph and skill tools
- Skills system (shared instructions for internal + external agents)
- PDF extraction
- Graph visualization (Map view)
- BYO API keys

## What's NOT Included

- Private-app-only built-in assistant experience
- Voice features
- Auth/subscription system
- Desktop packaging

## Current Doctrine

- no runtime `dimensions`
- optional `contexts`
- node quality driven by `title`, `description`, `source`, `metadata`, and `edges`
- direct lookup first, broader retrieval when useful
- app-owned chunking and embeddings from `nodes.source`

## MCP Integration

RA-OS is designed to be the knowledge backend for your AI workflows:

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

Add this to `~/.claude.json` and restart Claude. Run RA-H once first so the database exists. The standalone MCP server can write nodes without the app running, but the app owns chunking and embedding from node source. If you publish a newer MCP release and need clients to pick it up immediately, bump the pinned version here and restart the client.

Core tools include: `queryNodes`, `retrieveQueryContext`, `createNode`, `writeContext`, `updateNode`, `getNodesById`, `createEdge`, `updateEdge`, `queryEdge`, `queryContexts`, `listSkills`, `readSkill`

## Documentation

| Doc | Description |
|-----|-------------|
| [Schema](./2_schema.md) | Database schema, node/edge structure |
| [Tools & Skills](./4_tools-and-guides.md) | Available MCP tools, skill system |
| [UI](./6_ui.md) | Component structure, panels, views |
| [MCP](./8_mcp.md) | External agent connector setup |
| [Full Local](./10_full-local.md) | Supported local path and community patterns |
| [Troubleshooting](./TROUBLESHOOTING.md) | Common issues and fixes |
