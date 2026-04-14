# RA-OS Documentation

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
| [Overview](./0_overview.md) | What is RA-OS, design philosophy |
| [Schema](./2_schema.md) | Database schema, node/edge structure |
| [Tools & Skills](./4_tools-and-guides.md) | MCP tools, skill system |
| [Logging & Evals](./5_logging-and-evals.md) | Debugging, evaluation framework |
| [UI](./6_ui.md) | 2-panel layout, components, views |
| [MCP](./8_mcp.md) | Connect Claude Code and external agents |
| [About](./9_open-source.md) | What's included, contributing |
| [Troubleshooting](./TROUBLESHOOTING.md) | Common issues and fixes |
| [Development](./development/process.md) | Dev workflow and PR checklist |
| [Docs Process](./development/docs-process.md) | How to maintain docs |

## Getting Started

```bash
# Clone
git clone https://github.com/bradwmorris/ra-h_os.git
cd ra-h_os

# Install
npm install

# Run
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
      "args": ["--yes", "ra-h-mcp-server@2.1.1"]
    }
  }
}
```

If you publish a newer MCP release and need clients to use it immediately, bump the pinned version here and restart the client. Do not assume plain `npx ra-h-mcp-server` always refreshes instantly.

Works without RA-OS running. See [MCP docs](./8_mcp.md) for alternatives.

## Questions?

Open an issue on [GitHub](https://github.com/bradwmorris/ra-h_os).
