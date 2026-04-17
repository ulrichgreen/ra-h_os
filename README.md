# RA-H OS

```
 ██████╗  █████╗       ██╗  ██╗
 ██╔══██╗██╔══██╗      ██║  ██║
 ██████╔╝███████║█████╗███████║
 ██╔══██╗██╔══██║╚════╝██╔══██║
 ██║  ██║██║  ██║      ██║  ██║
 ╚═╝  ╚═╝╚═╝  ╚═╝      ╚═╝  ╚═╝
```

**TL;DR:** Clone this repository and you get a local SQLite knowledge graph plus a UI and standalone MCP server. External agents can read and write the graph, while the app owns chunking and embedding from node source.

[![Watch the demo](https://img.youtube.com/vi/IA02YB8mInM/hqdefault.jpg)](https://youtu.be/IA02YB8mInM?si=WoWpNE9QZEKEukvZ)

> **Cross-platform local runtime:** macOS works out of the box. Windows and Linux are now being hardened for the core local/web app flow, but semantic/vector search still depends on either sqlite-vec for your platform or a later Qdrant setup.

**Docs start here:** [docs/README.md](./docs/README.md)

---

## What This Does

1. **Stores knowledge locally** — Notes, bookmarks, ideas, research in a SQLite database on your machine
2. **Provides a UI** — Browse, search, and organize your nodes at `localhost:3000`
3. **Exposes an MCP server** — Claude Code and other MCP clients can query and add to your knowledge base

Your data stays on your machine. Nothing is sent anywhere unless you configure an API key.

Current contract:
- no runtime `dimensions`
- no separate runtime `contexts` layer or context capsule
- node quality comes from `title`, `description`, `source`, `metadata`, and explicit `edges`
- direct node lookup first for specific-node intent
- `getContext` for orientation and `retrieveQueryContext` for broader current-turn grounding
- standalone MCP writes node data, but the app owns chunking and embeddings

---

## Requirements

- **Node.js 20.18.1+** — [nodejs.org](https://nodejs.org/)
- **macOS** — Works out of the box
- **Windows/Linux** — Core app flow is being validated; vector search still requires sqlite-vec for your platform (see below)

---

## Install

```bash
git clone https://github.com/bradwmorris/ra-h_os.git
cd ra-h_os
npm install
npm rebuild better-sqlite3
npm run bootstrap:local
npm run dev
```

Open [localhost:3000](http://localhost:3000). Done.

Full install details:
- [docs/README.md](./docs/README.md)
- [docs/8_mcp.md](./docs/8_mcp.md)
- [docs/10_full-local.md](./docs/10_full-local.md)

---

## OpenAI API Key

**Optional but recommended.** Without a key, you can still create and organize nodes manually.

With a key, you get:
- Auto-generated descriptions when you add nodes
- Automatic node descriptions
- Semantic search (find similar content, not just keyword matches)

**Cost:** Less than $0.10/day for heavy use. Most users spend $1-2/month.

**Setup:** The app will prompt you on first launch, or go to Settings → API Keys.

Get a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

---

## Where Your Data Lives

```
~/Library/Application Support/RA-H/db/rah.sqlite   # macOS
~/.local/share/RA-H/db/rah.sqlite                  # Linux
%APPDATA%/RA-H/db/rah.sqlite                       # Windows
```

This is a standard SQLite file. You can:
- Back it up by copying the file
- Query it directly with `sqlite3` or any SQLite tool
- Move it between machines

---

## Connect Claude Code (or other MCP clients)

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

Restart Claude Code fully (**Cmd+Q on Mac**, not just closing the window).

If you publish a newer MCP release and want clients to use it immediately, bump the pinned version here and restart the client. Do not rely on plain `npx ra-h-mcp-server` always refreshing instantly.

**Verify it worked:** Ask Claude `Do you have RA-H tools available?` You should see tools like `queryNodes`, `retrieveQueryContext`, `createNode`, and `readSkill`.

**For contributors** testing local changes, use the local path instead:
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

**What happens:** Once connected, the agent should use `queryNodes` for specific existing-node lookup, `retrieveQueryContext` when broader graph grounding would help, and `getContext` only for orientation. It should search before creating, propose durable writeback selectively instead of pestering, and treat the graph itself as the source of grounding rather than a separate contexts layer. The MCP server stores source on the node. The app later turns that source into chunks and embeddings.

**Recommended memory file:** If you use Claude Code or another coding agent, add one short repo-level memory file (`AGENTS.md` or `CLAUDE.md`) that reinforces the core graph behavior. Keep it simple and do not maintain conflicting versions across multiple files.

Suggested snippet:

```md
You are helping build a thoughtful graph of atomic units of context.

- Use `queryNodes` for direct lookup of a specific existing node.
- Use `retrieveQueryContext` when broader graph context would help with the current turn.
- Search before creating. Prefer updating the same artifact when it is clearly the same thing.
- `description` should state plainly what the thing is first, then why it belongs and current status.
- Preserve the user's wording in `source` for user-authored ideas unless they explicitly want a rewrite.
```

Available tools:

| Tool | What it does |
|------|--------------|
| `getContext` | Get graph overview — stats, hub nodes, skills, and orientation signals |
| `retrieveQueryContext` | Pull relevant graph context for a broader current-turn task |
| `queryNodes` | Find nodes by keyword |
| `createNode` | Create a new node |
| `getNodesById` | Fetch nodes by ID |
| `updateNode` | Edit an existing node |
| `createEdge` | Link two nodes together after explicit confirmation |
| `updateEdge` | Update an edge explanation after explicit confirmation |
| `queryEdge` | Find connections |
| `listSkills` | List available skills |
| `readSkill` | Read a skill by name |
| `writeSkill` | Create or update a custom skill |
| `deleteSkill` | Delete a custom skill |
| `searchContentEmbeddings` | Search through source content (transcripts, books, articles) |
| `sqliteQuery` | Run read-only SQL queries (SELECT/WITH/PRAGMA) |

**Example prompts for Claude Code:**
- "What's in my knowledge graph?"
- "Search my knowledge base for notes about React performance"
- "Add a node about the article I just read on transformers"
- "Show me the nodes connected to this project idea"

---

## Direct Database Access

Query your database directly:

```bash
# Open the database
sqlite3 ~/Library/Application\ Support/RA-H/db/rah.sqlite

# List all nodes
SELECT id, title, created_at FROM nodes ORDER BY created_at DESC LIMIT 10;

# Search by title
SELECT title, description FROM nodes WHERE title LIKE '%react%';

# Find connections
SELECT n1.title, e.explanation, n2.title
FROM edges e
JOIN nodes n1 ON e.from_node_id = n1.id
JOIN nodes n2 ON e.to_node_id = n2.id
LIMIT 10;
```

See [docs/2_schema.md](./docs/2_schema.md) and [docs/8_mcp.md](./docs/8_mcp.md) for the current contract.

---

## Commands

| Command | What it does |
|---------|--------------|
| `npm run bootstrap:local` | Create `.env.local`, create the SQLite DB, and seed the base schema |
| `npm run dev` | Start the app at localhost:3000 |
| `npm run dev:local` | Alias for `npm run dev` |
| `npm run build` | Production build |
| `npm run type-check` | Check TypeScript |

---

## Windows

Windows support is now being validated against real user setups.

The latest runtime update is intended to make the core local/web app work on Windows even if vector search is not configured yet:
- the app should still start
- nodes, UI, and keyword/FTS search should still work
- `/api/health/vectors` should report vector search as unavailable instead of crashing

For semantic/vector search on Windows:
1. Go to [sqlite-vec releases](https://github.com/asg017/sqlite-vec/releases)
2. Download the Windows x64 release (for example `sqlite-vec-0.1.6-loadable-windows-x86_64.zip`)
3. Extract `vec0.dll`
4. Copy it to `vendor/sqlite-extensions/vec0.dll` in this repo
5. Re-run the normal local setup steps

Without `vec0.dll`, the core app should still work, but semantic/vector search will be unavailable.

## Linux

Linux support depends on which Linux environment you are running.

For standard Linux x64 distributions that use glibc (Ubuntu, Debian, Fedora, etc.), the core app should work and sqlite-vec can be added like this:
1. Go to [sqlite-vec releases](https://github.com/asg017/sqlite-vec/releases)
2. Download the Linux release matching your architecture (for example `sqlite-vec-0.1.6-loadable-linux-x86_64.tar.gz`)
3. Extract `vec0.so`
4. Copy it to `vendor/sqlite-extensions/vec0.so` in this repo
5. Re-run the normal local setup steps

For Alpine/musl environments, sqlite-vec is the problem case. The core app may still run, but sqlite-vec is not the reliable path there. Qdrant is the intended backend for that deployment target.

Without sqlite-vec:
- the core app should still start
- nodes, UI, and keyword/FTS search should still work
- `/api/health/vectors` should report vector search as unavailable instead of crashing

---

## Community

- **Discord:** [discord.gg/3cpQj6Jtc9](https://discord.gg/3cpQj6Jtc9) — ask questions, share your setup, get help
- **Repo docs:** [docs/README.md](./docs/README.md)
- **Issues:** [github.com/bradwmorris/ra-h_os/issues](https://github.com/bradwmorris/ra-h_os/issues)
- **License:** MIT
