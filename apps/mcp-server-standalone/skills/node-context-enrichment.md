---
name: Node Context Enrichment
description: "Use to rewrite thin node descriptions into natural prose that still makes what, why, and status clear, with graph review and edge suggestions."
---

# Node Context Enrichment

Use this when a node already exists but its description is thin, generic, or missing useful graph framing.

This skill should not silently rewrite and move on when framing is inferred. If the enrichment depends on interpretation, update the node and then explicitly invite the user to correct or refine that framing.

## Goal

Replace weak descriptions with a single clean natural description that captures:

1. What the artifact literally is
2. Why it is in Brad's graph
3. Status in Brad's workflow

Also review whether the node needs obvious edge suggestions.

## Workflow

1. Load the node and inspect title, description, source, link, metadata, and nearby edges.
2. Search for adjacent graph context before rewriting:
   - recently connected project or belief nodes
   - related nodes with overlapping titles, creators, or neighboring structure
3. Infer the best available "why" from that graph context.
4. Rewrite the full description from scratch in natural prose. Do not append to the old text or use labels like WHAT:, WHY:, or STATUS:.
5. Suggest 1-3 high-signal edges when obvious.
6. Update the node once the description is strong enough to be useful.
7. After the update, tell the user what changed and ask whether they want to refine the important framing:
   - what it is
   - why it belongs in the graph
   - status / current relevance / workflow position

The user feedback pass is required whenever the enriched "why" or status was inferred rather than directly stated in the node/source.

## Description Standard

Every rewritten description must naturally cover:

1. What
   - explicit artifact type
   - creator/author/speaker when known
   - core subject, claim, or function
2. Why
   - why Brad saved it
   - what project, belief, question, or theme it connects to
   - if genuinely unknown, say that naturally without inventing graph framing
3. Status
   - queued, in progress, processed, not yet reviewed, saved for later, etc.
   - if unknown, say naturally that it has not been reviewed yet

Max 500 characters.

## Batch Mode

Use batch enrichment when cleaning up many nodes with the same failure mode.

1. Pull a tight node set first.
2. Group by pattern:
   - vague imported links
   - thin quick-add captures
   - old source nodes missing workflow state
3. Enrich each node individually. Do not reuse boilerplate "why" text across unrelated nodes.
4. Return a compact summary of:
   - nodes updated
- edge suggestions not yet created

## Quality Bar

- No filler phrases like `insightful for understanding`, `relevant to`, or `important for`.
- No generic summaries that only restate the topic.
- No invented certainty. If graph evidence is weak, say so explicitly.
- Prefer one compact 3-sentence description over bloated prose.

## Output Pattern

For each node:

- New description
- Framing note: what graph context influenced the rewrite, if any
- Edge suggestions: source -> target with explicit explanation
- One short invitation for user feedback when framing was inferred
