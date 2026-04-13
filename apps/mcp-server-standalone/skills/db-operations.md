---
name: DB Operations
description: "Use for graph read, write, connect, classify, or traverse operations with strict data quality standards."
---

# DB Operations

## Core Rules

1. First decide whether the user is trying to find a specific existing node or whether they want graph context to support a broader answer.
2. If the user is trying to find a specific existing node, use `queryNodes` first.
3. If the user is asking a substantive question or request that would benefit from prior graph context, use `retrieveQueryContext` for current-turn grounding instead of relying on orientation alone.
4. Search before create to avoid duplicates.
5. Every create/update must include a natural description that clearly says what the thing is, why it matters here, and its current workflow status.
6. Use event dates when known (when it happened, not when saved).
7. Apply context only when it is an obvious match to one of the user's existing contexts and genuinely useful. One node gets at most one primary context, and leaving context blank is valid.
8. Create edges when relationships are meaningful; edge explanations should read as a sentence.
9. For user-authored ideas, notes, or dictated thoughts, preserve the user's wording in `source` as fully as possible with only minimal cleanup.

## Write Quality Contract

- `title`: clear and specific.
- `description`: concrete object-level description, not vague summaries.
- `source`: full verbatim or canonical content of the node (transcript, article text, book passage, user's thoughts). This is what gets chunked and embedded for semantic search.
- For idea capture from chat, the `source` should usually be the raw user thought, not a compressed assistant summary.
- `link`: external source URL only.
- `context_id`: the node's primary context. This field is optional. Omit it entirely unless it is an obvious existing match. Do not add `context_id: null` defensively.
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

If the agent has graph context (context capsule, focused nodes, recent connected nodes, or an explicit active context), it should infer the why from that context and write it naturally. Do not let the service auto-generate a weak context-free description when you already have enough signal.

If the why genuinely cannot be inferred, say that naturally. Do not use labels like `WHAT:`, `WHY:`, or `STATUS:` and do not substitute vague filler like `insightful for understanding` or `relevant to Brad's work`.

If status is unknown, say naturally that it has not been reviewed yet.

Ask a clarification question only when a missing detail would materially change the node being created. If the user has already given enough substance to infer the artifact, title, and likely why, do the work instead of bouncing it back.

For user-authored idea capture, do not treat the inferred description as final if the "why" or status was mostly inferred. Save the node first, then tell the user what description framing you inferred and invite one short correction pass on:
- what this is
- why it belongs here
- where it sits in their workflow

Max 500 characters.

## Metadata Semantics

- Direct user creation, quick add, and user-requested agent capture should default to `captured_by = "human"`.
- Only autonomous/background creation without direct user instruction should use `captured_by = "agent"`.
- Prefer leaving `type` blank over forcing a weak label.
- `state` is the user-visible processed flag. If no state is known, default to `not_processed`.

## Execution Pattern

1. Decide whether this is direct node retrieval or broader contextual grounding.
2. If the user is trying to find a specific existing node, call `queryNodes` first.
3. If the user is asking a broader question that would benefit from prior graph context, call `retrieveQueryContext`.
4. Decide: answer only vs create vs update vs connect.
5. If something seems unusually durable and valuable, you may suggest a save in one short line like `Add "X" as a node?`
6. Do not pester. If the user says no, ignores it, or moves on, do not keep asking.
7. Only call `writeContext` or another write tool after explicit user confirmation.
8. Execute minimum required writes.
9. If the node is a user-authored idea and the contextual framing was inferred, offer one concise feedback pass after the write.
10. Verify result reflects user intent exactly.

## Do Not

- Create duplicate nodes when an update is correct.
- Write vague descriptions ("discusses", "explores", "is about").
- Create weak or directionless edges.
- Ask to save every moderately useful point from the conversation.
