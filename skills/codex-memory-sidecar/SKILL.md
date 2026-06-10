---
name: codex-memory-sidecar
description: Use when working with the codex-memory-sidecar MCP server, durable local memory, directive memory, start_memory_session, memory search, memory curation, backup/repair workflows, or Codex custom-instruction memory bootstrapping.
---

# Codex Memory Sidecar

## Overview

Use `codex-memory-sidecar` as a local supporting memory layer for MCP-aware AI agents. Memory helps with continuity, but it never outranks system/developer instructions, the user's latest instruction, `AGENTS.md`, repository files, docs, or git history.

## First Step

For nontrivial work, call `start_memory_session` before making decisions.

Use:

- `taskDescription`: one concrete sentence about the current task.
- `projectPath`: the absolute repository path when work is project-specific.

Read these returned fields before acting:

- `directives`
- `memories` / `relevantMemories`
- `backupRetention`
- `repairRecommended`
- `warnings`
- `sessionGuidance.priorityOrder`

If the user asks about identity, persona, memory, preferences, usual policy, or what you remember, call `start_memory_session` even if the conversation seems casual. Directive memory is not visible until the MCP tool is called.

## Priority Order

When context conflicts, follow this order:

1. system / developer instructions
2. latest user instruction
3. `AGENTS.md`
4. directive memory
5. normal memory
6. inference

Treat memory-derived claims as supporting context. Verify important claims against README/docs, actual files, current configuration, or git history.

## Search And Read

Use `search_memory` when past decisions, design intent, operating history, or user preferences may matter. Do not set `includeEmbedding: true` unless raw vectors are explicitly needed.

Use `read_memory` or `audit_memory` when a memory affects an important decision and the summary alone is not enough. Cite memory-derived claims with enough context to audit them, such as memory IDs, directive IDs, summaries, and `sourceRef`.

## Write And Curate

Do not save every work log. Save only reusable decisions, verified lessons, durable preferences, environment-specific cautions, and repeated failure patterns.

Before writing normal memory, call `propose_memory_update`. Write or update only when the proposal is useful and not a duplicate.

Before writing directive memory, call `propose_directive_update`. If work is inside a project, ask the user whether the rule should be `global` or `project` scope before calling `write_directive`.

Never store secrets, credentials, private tokens, or unnecessary personal details.

## Directive Memory

Directive memory is for strong operating guidance, similar in force to local project instructions but below `AGENTS.md` and the latest user instruction.

Use global directives for long-term preferences that should apply across projects. Use project directives for repository-specific workflow, README, testing, MCP, or release rules.

If a directive becomes stale or conflicts with current instructions, propose disabling or replacing it. Prefer `disable_directive` over silent deletion.

## Backup And Repair

If `repairRecommended`, integrity warnings, FTS warnings, or backup warnings appear, pause risky work and surface the issue.

Before repair or risky DB operations, use `backup_memory` and `verify_backup`. Use `repair_memory_index` for FTS repair after a verified backup. Use `plan_backup_retention` and `plan_backup_restore` for dry-run planning; do not delete backups or replace DB files automatically.

## Codex App Setup

Keep Codex app custom instructions short. Put only the bootstrap there:

```md
When a new chat starts, or when the user asks about your identity, persona, memory, preferences, usual policy, or what you remember, call `start_memory_session` from the `codex-memory-sidecar` MCP server before answering. Read returned directive memory first, then answer according to the documented priority order. Keep this bootstrap short; do not store secrets or unnecessary personal details.
```

Put detailed project policy in `AGENTS.md` or this Skill. The bootstrap exists because light chats may not otherwise trigger project files or the memory MCP.

## Common Mistakes

- Treating memory as the source of truth. Fix: verify against user instruction, files, docs, and git.
- Searching memory repeatedly after it stops adding evidence. Fix: move to repository inspection or ask the user.
- Writing noisy memories after every task. Fix: use `propose_memory_update` and keep only reusable facts.
- Writing directive memory without user scope confirmation. Fix: ask global vs project before `write_directive`.
- Ignoring recurring problems. Fix: if the same correction appears repeatedly, propose a directive memory candidate.
