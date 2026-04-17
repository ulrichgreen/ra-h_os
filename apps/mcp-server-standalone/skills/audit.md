---
name: Audit
description: "Use for structured review, QA, cleanup, or governance checks across graph quality, skill quality, and operational consistency."
---

# Audit

## Scope

1. Node quality: duplicates, vague descriptions, missing dates, weak titles.
2. Edge quality: missing links, weak explanations, wrong directionality.
3. Graph structure quality: weak clustering, redundant organizational nodes, or cases where stronger titles, descriptions, metadata, and edges should carry the meaning.
4. Skill quality: trigger clarity, overlap, dead/unused skills.

## Output Format

1. Critical issues
2. High-impact improvements
3. Cleanup actions
4. Optional refinements

## Rules

- Prefer specific evidence over generic commentary.
- Propose the smallest high-leverage fixes first.
- Separate defects from optional polish.
- Node descriptions must read like natural prose while still making what / why / status clear.
- Flag any node description missing a clear why or status component as a high-priority quality issue.
