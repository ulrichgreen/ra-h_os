# RA-H OS Documentation

```
 ██████╗  █████╗       ██╗  ██╗
 ██╔══██╗██╔══██╗      ██║  ██║
 ██████╔╝███████║█████╗███████║
 ██╔══██╗██╔══██║╚════╝██╔══██║
 ██║  ██║██║  ██║      ██║  ██║
 ╚═╝  ╚═╝╚═╝  ╚═╝      ╚═╝  ╚═╝
```

## Quick Links

| Doc | Description |
|-----|-------------|
| [Overview](./0_overview.md) | What RA-H OS is and what contract it shares with the main app |
| [Schema](./2_schema.md) | Current SQLite contract |
| [Tools & Skills](./4_tools-and-guides.md) | MCP tools and skill system |
| [Logging & Evals](./5_logging-and-evals.md) | Logs, evals, and debugging surfaces |
| [UI](./6_ui.md) | Current pane and focus model |
| [MCP](./8_mcp.md) | Full standalone MCP install, behavior guide, and memory-file guidance |
| [Open Source](./9_open-source.md) | Scope, support boundary, contributor reality |
| [Full Local](./10_full-local.md) | Supported local path vs community patterns |
| [Troubleshooting](./TROUBLESHOOTING.md) | Common issues and fixes |

## Start Here

If you just want RA-H OS working:
1. Read [../README.md](../README.md)
2. Follow [MCP](./8_mcp.md) if you want external-agent access
3. Read [Full Local](./10_full-local.md) if you want a more local-first or community setup

## Local App Quick Start

```bash
git clone https://github.com/bradwmorris/ra-h_os.git
cd ra-h_os
npm install
npm rebuild better-sqlite3
npm run bootstrap:local
npm run dev
```

Open http://localhost:3000

## MCP Integration

Add to your `~/.claude.json`:

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

If you publish a newer MCP release and need clients to use it immediately, bump the pinned version here and restart the client. Do not assume plain `npx ra-h-mcp-server` always refreshes instantly.

Run RA-H once first so the database exists. The standalone MCP server can write nodes without the app running, but the app owns chunking and embedding from node source. See [MCP docs](./8_mcp.md) for the full install, verify, memory-file, and troubleshooting path.

## Questions?

Open an issue on [GitHub](https://github.com/bradwmorris/ra-h_os).
