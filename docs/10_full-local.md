# Fully Local / Community Patterns

This page is for users who want to stay as local as possible without pretending every local-first stack is equally supported.

## 1. What "Fully Local" Means In RA-H Terms

In RA-H terms, "fully local" usually means:
- your graph lives in local SQLite
- the UI runs locally
- your MCP server runs locally
- you avoid shipping graph data to hosted backends where possible

That does not automatically mean every part of the stack is equally local. Model choice, embeddings, and alternate vector backends change that.

## 2. The Supported Baseline Local Stack

Supported core path:
- RA-H OS app
- local SQLite DB
- standard standalone MCP server
- documented repo install flow
- hosted model APIs if you choose them

This is the path the core docs and troubleshooting are written for.

## 3. Where Local-First Starts Getting Experimental

Local-first gets more experimental when you change:
- model provider
- embedding provider
- vector backend
- deployment target
- chat/agent client beyond the documented MCP path

That does not make those setups bad. It just changes the support boundary.

## 4. Community Pattern: Local Models + RA-H MCP

Reasonable community pattern:
- keep RA-H OS local
- keep SQLite local
- connect a local-model-capable client to RA-H through MCP

Honest caveat:
- tool-calling quality depends heavily on the model/runtime
- smaller local models may perform materially worse than stronger hosted tool-use models
- "fully local" can reduce privacy concerns and improve offline control, but it can also degrade reliability

## 5. Community Pattern: AnythingLLM As Alternate Local Chat / Agent Surface

Based on current public docs:
- AnythingLLM has MCP compatibility
- AnythingLLM supports local-model paths
- Intelligent Tool Selection exists and may matter for local-model performance

This makes it a plausible alternate local chat/agent surface for RA-H MCP.

Caveat:
- MCP support alone does not guarantee strong tool use
- weaker local models can still underperform badly even with a solid MCP integration

References:
- https://docs.anythingllm.com/mcp-compatibility/overview
- https://docs.anythingllm.com/agent/intelligent-tool-selection

## 6. Community Pattern: Qdrant Add-On For Vector-Heavy Or `sqlite-vec`-Hostile Environments

Qdrant is a plausible local or self-hosted vector backend when:
- `sqlite-vec` is weak on the target platform
- storage/runtime constraints make the default vector path awkward
- you are intentionally running a more custom environment

Important boundary:
- this is not a bundled official RA-H core dependency
- the Nathan Maine repo is a community add-on example, not the default install story

References:
- https://qdrant.tech/documentation/quickstart/
- https://github.com/NathanMaine/rah-qdrant-integration

## 7. Honest Tradeoffs

- more local privacy can be better
- offline control can be better
- maintenance burden is usually higher
- tool quality can get worse fast with weaker local models
- troubleshooting becomes more user-owned as you move away from the baseline path

## 8. Support Boundary

Supported core path:
- repo install flow
- SQLite
- documented standalone MCP setup

Reasonable community pattern:
- alternate local-model or alternate local chat surface that still respects the MCP contract

Experimental / user-owned:
- custom vector backend swaps
- unsupported runtime targets
- heavily modified inference stacks
