# Memory Protocol

Use `codex-memory-sidecar` as a local supporting memory layer for MCP-aware agents. Memory helps with continuity, but it never outranks system or developer instructions, the latest user instruction, `AGENTS.md`, repository files, docs, or git history.

## Startup sequence

Call `start_memory_session` before nontrivial work, and also before answering requests about identity, persona, preferences, previous work, memory, health status, Dashboard status, backup status, or repair status.

Pass:

- `taskDescription`
  - one concrete sentence about the current task
- `projectPath`
  - absolute repository path when the work is project-specific

Read these fields before acting:

- `directives`
- `memories` or `relevantMemories`
- `memoryFreshness`
- `memoryUpdateCandidates`
- `autoMemoryCuration`
- `backupRetention`
- `repairRecommended`
- `warnings`
- `sessionGuidance.priorityOrder`

`start_memory_session` records a startup audit event. Treat it as expected operational history, not as a purely read-only call.

## Health-check requests

For a request such as "run codex-memory-sidecar health_check":

1. Call `start_memory_session`.
2. Read `directives`, `repairRecommended`, `warnings`, and session guidance.
3. Call `health_check`.
4. Report both the health result and any session warnings or required actions.

This sequence must be sequential, not parallel.

## Search and read

- Use `search_memory` when past decisions, design intent, operating history, or preferences may matter.
- Do not set `includeEmbedding: true` unless raw vectors are explicitly needed.
- When a memory matters to an important decision, use `read_memory` or `audit_memory` to inspect it more closely.
- Cite memory-derived claims with auditable context such as memory id, directive id, summary, or `sourceRef`.

## Conflict rule

Treat memory-derived claims as supporting context. Verify important claims against current files, docs, config, or git history before treating them as facts.
