# Open Source Surface

The open-source RA-H surface should match the main app contract where product behavior is shared:

- no runtime `dimensions` model,
- optional soft `contexts`,
- no automatic context assignment on write,
- node quality driven by title, description, source, metadata, and edges.

## What RA-H OS Includes

- local SQLite graph
- local UI
- standalone MCP server
- shared skills system
- BYO API key path

## What RA-H OS Does Not Promise

- every private-app surface
- private subscription/auth behavior
- official support for every local model stack or vector backend someone can wire up
- a guarantee that every community setup is first-class supported

## Support Boundary

Supported core path:
- RA-H OS app
- local SQLite
- standard standalone MCP server
- documented repo install flow

Reasonable community pattern:
- local model or alternate MCP-capable chat surface layered on top of the documented contract

Experimental / user-owned:
- custom vector backends
- unsupported deployment targets
- aggressive local-model substitutions that degrade tool quality

## Important App Routes

- `app/api/nodes/`
- `app/api/contexts/`
- `app/api/edges/`
- `app/api/rah/chat/`
- extraction routes
- eval / verification helpers

## Porting Rule

Main `ra-h` ships first.

`ra-h_os` is a required follow-up port of the same contract, not a place to preserve older taxonomy behavior.
