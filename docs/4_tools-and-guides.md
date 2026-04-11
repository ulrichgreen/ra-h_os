# Tools & Skills

> MCP tools for graph operations and skills for procedural guidance.

**How it works:** External agents call MCP tools to read and write your graph. Contexts are optional soft organization only; node quality should come from clear nodes and explicit edges.

---

## MCP Tools

RA-OS exposes these core standalone MCP tools:

### Context + Graph

| Tool | Description |
|------|-------------|
| `getContext` | Graph overview: stats, contexts, hub nodes, recent activity, skills |
| `queryNodes` | Search nodes by keyword/date/context |
| `getNodesById` | Fetch full nodes by ID |
| `createNode` | Create a node |
| `updateNode` | Update a node |
| `createEdge` | Create an edge between nodes |
| `queryEdge` | Query edges |
| `updateEdge` | Update edge explanation |
| `queryContexts` | List contexts and optional attached nodes |

### Skills + Search

| Tool | Description |
|------|-------------|
| `listSkills` | List available skills |
| `readSkill` | Read one skill |
| `writeSkill` | Create/update a skill |
| `deleteSkill` | Delete a skill |
| `searchContentEmbeddings` | Search source chunks/transcripts |
| `sqliteQuery` | Read-only SQL (`SELECT`, `WITH`, `PRAGMA`) |

---

## Skills

Skills are markdown instructions stored locally and shared across internal + external agents.

### Default seeded skills

- `db-operations`
- `create-skill`
- `audit`
- `traverse`
- `onboarding`
- `persona`
- `calibration`
- `connect`

### Storage

- Live skills: `~/Library/Application Support/RA-H/skills/`
- Bundled defaults: `src/config/skills/`

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/skills` | GET | List skills |
| `/api/skills/[name]` | GET/PUT/DELETE | Skill CRUD |
| `/api/guides` | GET | Compatibility alias to skills |
| `/api/guides/[name]` | GET/PUT/DELETE | Compatibility alias to skills |

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/mcp-server-standalone/` | Standalone MCP server (recommended) |
| `src/services/skills/skillService.ts` | Skills runtime service |
| `src/config/skills/*.md` | Bundled default skills |
| `src/components/panes/SkillsPane.tsx` | Skills pane UI |
