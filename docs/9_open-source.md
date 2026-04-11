# Open Source Surface

The open-source RA-H surface should match the main app contract:

- no runtime `dimensions` model,
- optional soft `contexts`,
- no automatic context assignment on write,
- node quality driven by title, description, source, metadata, and edges.

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
