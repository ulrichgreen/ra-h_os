---
name: DB Operations
description: "Use for graph read, write, connect, classify, or traverse operations with strict data quality standards."
---

# DB Operations

## Core Rules

1. Search before create to avoid duplicates.
2. Always try to include a natural description that clearly says what the thing is and any surrounding context available. But description quality is guidance only; RA-H should never block or rewrite a write because of description quality.
3. Use event dates when known (when it happened, not when saved).
4. Apply contexts only when they are explicit and helpful. One node gets at most one context. If explicit context is missing on create, leave it empty instead of guessing.
5. Do not rely on dimensions. Node quality comes from title, description, source, metadata, and strong edges.
5. Create edges when relationships are meaningful; edge explanations should read as a sentence.
6. For user-authored ideas, notes, or dictated thoughts, preserve the user's wording in `source` as fully as possible with only minimal cleanup.

## Write Quality Contract

- `title`: clear and specific.
- `description`: concrete object-level description, not vague summaries.
- `source`: full verbatim or canonical content of the node (transcript, article text, book passage, user's thoughts). This is what gets chunked and embedded for semantic search.
- For idea capture from chat, the `source` should usually be the raw user thought, not a compressed assistant summary.
- `link`: external source URL only.
- `context_id`: the node's primary context. Prefer setting it when the scope is explicit. Leave it null rather than guessing.
- `metadata`: use the canonical node metadata contract when metadata is needed:
  - `type`
  - `state` (`processed` or `not_processed`)
  - `captured_method`
  - `captured_by`
  - `source_metadata`
- `source_metadata`: factual source-specific details only. Keep it compact. No AI summaries or reasoning text.
- metadata updates are merge-safe patches, not full-blob replacements. Do not assume `updateNode.metadata` wipes existing keys.
- Derived analysis, briefs, and research notes should be stored in a separate linked node, not appended to the source node.

## Description Standard

Every node description should read like natural prose, not a template or checklist.

It must still make three things clear:
1. What — what the artifact is in simple explicit terms (format + creator + core claim)
2. Why — why it is in the graph; what Brad is interested in; what it connects to
3. Status — where it sits in his workflow (queued, in progress, processed, unknown)

If the agent has graph context (active context, context anchor, context capsule, focused nodes), it should infer the why from that context and write it naturally.

If the why genuinely cannot be inferred, say that naturally. Do not use labels like `WHAT:`, `WHY:`, or `STATUS:` and do not substitute vague filler like `insightful for understanding` or `relevant to Brad's work`.

If status is unknown, say naturally that it has not been reviewed yet.

Ask a clarification question only when a missing detail would materially change the node being created. If the user has already given enough substance to infer the artifact, title, and likely why, do the work instead of bouncing it back.

For user-authored idea capture, do not treat the inferred description as final if the "why" or status was mostly inferred. Save the node first, then tell the user what description framing you inferred and invite one short correction pass on:
- what this is
- why it belongs here
- where it sits in their workflow

Keep it concise, but do not block the write over length or quality.

## Metadata Semantics

- Direct user creation, quick add, and user-requested agent capture should default to `captured_by = "human"`.
- Only autonomous/background creation without direct user instruction should use `captured_by = "agent"`.
- Prefer leaving `type` blank over forcing a weak label.
- `state` is the user-visible processed flag. If no state is known, default to `not_processed`.

## Execution Pattern

1. Read context (search + relevant nodes + relevant edges).
2. Decide: create vs update vs connect.
3. Execute minimum required writes.
4. If the node is a user-authored idea and the contextual framing was inferred, offer one concise feedback pass after the write.
5. Verify result reflects user intent exactly.

## Do Not

- Create duplicate nodes when an update is correct.
- Write vague descriptions ("discusses", "explores", "is about").
- Create weak or directionless edges.
