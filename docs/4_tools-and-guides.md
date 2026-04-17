# Tools & Skills

What actions agents can take, and how skills provide procedural guidance.

## Tool Groups

| Group | Purpose | Examples |
|-------|---------|----------|
| Read | Find, inspect, and ground graph context | `queryNodes`, `retrieveQueryContext`, `getNodesById` |
| Write | Create or update graph structure | `createNode`, `updateNode`, `createEdge` |
| Extraction | Ingest external content into the graph | `websiteExtract`, `youtubeExtract`, `paperExtract` |
| Utility | Deep inspection or external support | `sqliteQuery`, `webSearch`, `think` |
| Skills | Procedural guidance | `listSkills`, `readSkill`, `writeSkill`, `deleteSkill` |

## Live Tool Surface

### Read
- `getContext`
- `queryNodes`
- `retrieveQueryContext`
- `getNodesById`
- `queryEdge`
- `searchContentEmbeddings`
- `sqliteQuery`
- `webSearch`
- `think`

### Write
- `createNode`
- `updateNode`
- `deleteNode`
- `createEdge`
- `updateEdge`

### Skills
- `listSkills`
- `readSkill`
- `writeSkill`
- `deleteSkill`

### Extraction
- `websiteExtract`
- `youtubeExtract`
- `paperExtract`

## Important Behavior Rules

- Search before creating.
- Use `queryNodes` first when the user is clearly looking for a specific existing node.
- Use `retrieveQueryContext` when the current turn would benefit from broader graph grounding.
- `createEdge` and `updateEdge` are confirmation-gated.
- node creation quality should come from `title`, `description`, `source`, `metadata`, and explicit edges, not taxonomy.

Metadata note for `createNode` / `updateNode`:
- prefer canonical keys: `type`, `state`, `captured_method`, `captured_by`, `source_metadata`
- `updateNode.metadata` merges into the existing object rather than replacing the whole blob

## Skills System

Skills are markdown instruction documents shared by internal and external agents.

Seeded defaults:
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

## API Surfaces

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/skills` | GET | List skills |
| `/api/skills/[name]` | GET/PUT/DELETE | Skill CRUD |
| `/api/guides` | GET | Legacy compatibility alias to skills |
| `/api/guides/[name]` | GET/PUT/DELETE | Legacy compatibility alias to skills |

## Key Files

| File | Purpose |
|------|---------|
| `src/tools/infrastructure/registry.ts` | Live tool registry |
| `src/services/skills/skillService.ts` | App skill service |
| `apps/mcp-server-standalone/services/skillService.js` | Standalone MCP skill service |
| `src/config/skills/*.md` | Bundled default skills |
| `apps/mcp-server-standalone/skills/*.md` | MCP bundled default skills |
