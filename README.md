# RA-H OS

```
 ██████╗  █████╗       ██╗  ██╗
 ██╔══██╗██╔══██╗      ██║  ██║
 ██████╔╝███████║█████╗███████║
 ██╔══██╗██╔══██║╚════╝██╔══██║
 ██║  ██║██║  ██║      ██║  ██║
 ╚═╝  ╚═╝╚═╝  ╚═╝      ╚═╝  ╚═╝
```

**TL;DR:** Clone this repository and you'll have a local SQLite database on your computer. The database schema is structured so external AI agents can continuously read and write to it, building your knowledge graph externally.

[![Watch the demo](https://img.youtube.com/vi/IA02YB8mInM/hqdefault.jpg)](https://youtu.be/IA02YB8mInM?si=WoWpNE9QZEKEukvZ)

> **Cross-platform local runtime:** macOS works out of the box. Linux and Windows now support the core local/web app flow, but semantic/vector search still depends on either sqlite-vec for your platform or a later Qdrant setup.

**Full documentation:** [ra-h.app/docs/open-source](https://ra-h.app/docs/open-source)

---

## What This Does

1. **Stores knowledge locally** — Notes, bookmarks, ideas, research in a SQLite database on your machine
2. **Provides a UI** — Browse, search, and organize your nodes at `localhost:3000`
3. **Exposes an MCP server** — Claude Code, Cursor, or any MCP client can query and add to your knowledge base

Your data stays on your machine. Nothing is sent anywhere unless you configure an API key.

---

## Requirements

- **Node.js 20.18.1+** — [nodejs.org](https://nodejs.org/)
- **macOS** — Works out of the box
- **Linux/Windows** — Core app works; vector search requires sqlite-vec for your platform (see below)

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

---

## OpenAI API Key

**Optional but recommended.** Without a key, you can still create and organize nodes manually.

With a key, you get:
- Auto-generated descriptions when you add nodes
- Automatic dimension/tag assignment
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
      "args": ["ra-h-mcp-server"]
    }
  }
}
```

Restart Claude Code fully (**Cmd+Q on Mac**, not just closing the window).

**Verify it worked:** Ask Claude "Do you have RA-H tools available?" — you should see tools like `createNode`, `queryNodes`, and `readSkill`.

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

**What happens:** Once connected, Claude calls `getContext` first to orient itself (stats, hub nodes, dimensions, available skills). It proactively captures knowledge — when a new insight, decision, person, or reference surfaces, it proposes a specific node (title, dimensions, description) so you can approve with minimal friction. For complex tasks it reads skills to follow your graph conventions and workflows.

Available tools:

| Tool | What it does |
|------|--------------|
| `getContext` | Get graph overview — stats, hub nodes, dimensions, recent activity |
| `queryNodes` | Find nodes by keyword |
| `createNode` | Create a new node |
| `getNodesById` | Fetch nodes by ID |
| `updateNode` | Edit an existing node |
| `createEdge` | Link two nodes together |
| `updateEdge` | Update an edge explanation |
| `queryEdge` | Find connections |
| `queryDimensions` | List all tags/categories |
| `createDimension` | Create a new dimension |
| `updateDimension` | Update/rename a dimension |
| `deleteDimension` | Delete a dimension |
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
- "What nodes are connected to my 'research' dimension?"

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

See [ra-h.app/docs/open-source](https://ra-h.app/docs/open-source) for full schema documentation.

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

## Linux/Windows

The app itself can run on Linux and Windows now. The remaining platform-specific piece is vector search.

RA-H OS ships with a macOS sqlite-vec binary by default (`vendor/sqlite-extensions/vec0.dylib`). On Linux or Windows you need to swap it for your platform's version if you want semantic/vector search.

**Linux:**

1. Go to [sqlite-vec releases](https://github.com/asg017/sqlite-vec/releases)
2. Download the release matching your architecture (e.g. `sqlite-vec-0.1.6-loadable-linux-x86_64.tar.gz`)
3. Extract `vec0.so` from the archive
4. Copy it to `vendor/sqlite-extensions/vec0.so` in this repo
5. Run the normal install steps above

**Windows:**

1. Go to [sqlite-vec releases](https://github.com/asg017/sqlite-vec/releases)
2. Download the Windows release (e.g. `sqlite-vec-0.1.6-loadable-windows-x86_64.zip`)
3. Extract `vec0.dll` from the archive
4. Copy it to `vendor/sqlite-extensions/vec0.dll` in this repo
5. Run the normal install steps above

Without sqlite-vec, everything works except semantic/vector search.

If sqlite-vec is missing or fails to load:
- the app still starts
- nodes, UI, and keyword/FTS search still work
- `/api/health/vectors` reports vector search as unavailable instead of crashing

---

## Community

- **Discord:** [discord.gg/3cpQj6Jtc9](https://discord.gg/3cpQj6Jtc9) — ask questions, share your setup, get help
- **Full docs:** [ra-h.app/docs/open-source](https://ra-h.app/docs/open-source)
- **Issues:** [github.com/bradwmorris/ra-h_os/issues](https://github.com/bradwmorris/ra-h_os/issues)
- **License:** MIT
