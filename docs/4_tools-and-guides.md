# Tools & Skills

MCP tools are the graph contract. Skills are the reusable procedural layer that teaches agents how to use that contract well.

## Live MCP Tools

### Read

| Tool | Description |
|------|-------------|
| `getContext` | Graph overview for orientation |
| `queryNodes` | Direct node lookup by title, description, or source |
| `retrieveQueryContext` | Broader current-turn retrieval when graph grounding helps |
| `getNodesById` | Fetch full nodes by ID |
| `queryEdge` | Inspect existing edges |
| `queryContexts` | List/search contexts |
| `searchContentEmbeddings` | Search source chunks/transcripts |
| `sqliteQuery` | Read-only SQL (`SELECT`, `WITH`, `PRAGMA`) |

### Write

| Tool | Description |
|------|-------------|
| `createNode` | Create a node after duplicate/update checks |
| `updateNode` | Update a node while preserving context by default |
| `writeContext` | Save one confirmed durable context node |
| `createEdge` | Create a confirmed edge |
| `updateEdge` | Correct an edge after explicit confirmation |

### Skills

| Tool | Description |
|------|-------------|
| `listSkills` | List available skills |
| `readSkill` | Read one skill |
| `writeSkill` | Create or update a skill |
| `deleteSkill` | Delete a skill |

## Behavior Rules

- search before creating
- use `queryNodes` first for specific-node intent
- use `retrieveQueryContext` only when broader grounding would help
- leave context blank by default
- if context is intentionally provided, prefer `context_name`
- `writeContext`, `createEdge`, and `updateEdge` are confirmation-gated
- judge graph quality by node quality and explicit edges, not taxonomy completeness

## Skills

Skills are markdown instructions stored locally and shared across internal and external agents.

Default seeded skills:
- `db-operations`
- `create-skill`
- `audit`
- `traverse`
- `onboarding`
- `persona`
- `calibration`
- `connect`

Storage:
- live skills: `~/Library/Application Support/RA-H/skills/`
- bundled defaults: `src/config/skills/`

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/skills` | GET | List skills |
| `/api/skills/[name]` | GET/PUT/DELETE | Skill CRUD |
| `/api/guides` | GET | Compatibility alias to skills |
| `/api/guides/[name]` | GET/PUT/DELETE | Compatibility alias to skills |

## Key Files

| File | Purpose |
|------|---------|
| `apps/mcp-server-standalone/` | Standalone MCP server |
| `src/tools/infrastructure/registry.ts` | Live tool registry |
| `src/services/skills/skillService.ts` | Skills runtime service |
| `src/config/skills/*.md` | Bundled default skills |
| `src/components/panes/SkillsPane.tsx` | Skills pane UI |
