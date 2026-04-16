# UI Surfaces

## Workspace Model

RA-H OS follows the current pane model:
- explicit `1 / 2 / 3` visible panes
- chat anchored to the right edge of the active workspace
- node tabs only in node panes
- singleton non-node panes

## Main Views

- `Feed` for recent and sortable node browsing
- `Contexts` for optional context browsing
- `Map` for graph structure
- `Table` for dense inspection
- `Skills` for editable agent instructions
- `Chat` for agent-driven graph work

## UI Contract After The Migration

- The app no longer exposes a dimensions pane.
- Feed and table filtering are not dimension-based.
- Persisted pane layout should only hydrate valid pane types: `views`, `node`, `contexts`, `map`, `table`, `skills`.
- Contexts are shown as a secondary organizational aid, not as a hard requirement for capture.

## Focus And Capture

- Capture must succeed when context is omitted.
- Focus surfaces should emphasize title, description, source, metadata, and edges.
- Node cards may show context when present, but should not depend on it for meaning.
