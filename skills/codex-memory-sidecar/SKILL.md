---
name: codex-memory-sidecar
description: Use when a task involves codex-memory-sidecar, durable local memory, directive memory, persona or preferences loaded from local memory, previous work, project continuity, start or resume of nontrivial work, health_check, Dashboard or Observatory status, backup or repair state, memory search, memory curation, release checks, or audit-style review of saved local memory context.
---

# Codex Memory Sidecar Gateway

Use this skill as the gateway into local memory-aware work. The skill should trigger broadly; detailed operating rules live in the bundled references.

## First move

Call `start_memory_session` before making decisions when any of these are true:

- the work is nontrivial
- the user asks about memory, identity, persona, preferences, or previous decisions
- the user asks for `health_check`, memory status, Dashboard status, backup status, or repair status
- the task depends on project continuity, local operating rules, or stored verification history

Call `start_memory_session` as its own first MCP call. Read it first, then choose follow-up tools. Do not call it in parallel with `health_check`, `memory_stats`, `search_memory`, or write/repair tools.

If `start_memory_session` is unavailable, say the session context could not be loaded and continue with the explicitly requested safe action.

## Routing

Read only the reference files that match the current task:

- `references/memory-protocol.md`
  - startup flow, health-check sequencing, priority order, search/read rules
- `references/directive-memory.md`
  - global vs project directive handling, replacement/disable rules, citation rules
- `references/auto-curation.md`
  - `memory_auto_write`, review candidates, `externalAuthor`, `supersede_memory`
- `references/dashboard-observatory.md`
  - Dashboard, Observatory, privacy limits, performance expectations
- `references/plugin-setup.md`
  - plugin packaging, MCP setup, SessionStart hook expectations, install caveats
- `references/safety-and-backup.md`
  - backups, repair, secret detection, risky-operation boundaries
- `references/evaluation-workflows.md`
  - recap, audit, release checks, project recap, verification-style workflows

## Command templates

When the user wants a repeatable memory-oriented workflow, reuse these prompt templates:

- `commands/memory-recap.md`
- `commands/memory-audit.md`
- `commands/memory-release-check.md`
- `commands/memory-project-recap.md`

These are reusable prompt assets, not a guarantee of native slash-command support in every Codex surface.

## Required operating rules

- Treat memory as supporting context, not the source of truth.
- Follow this priority order when context conflicts:
  - system / developer instructions
  - latest user instruction
  - `AGENTS.md`
  - directive memory
  - normal memory
  - inference
- Use `propose_memory_update` before writing normal memory unless the task is explicitly about exercising raw write APIs.
- Use `propose_directive_update` before writing directive memory, and ask the user to choose `global` or `project` scope when that choice matters.
- Do not store secrets, credentials, private tokens, or unnecessary personal details.
- If the same correction or failure mode appears repeatedly, propose capturing it as directive memory at the right scope.

## SessionStart hook

SessionStart hook context is a backup for light chats and chat starts. It does not replace explicit `start_memory_session` for important work, and it must not be treated as proof that auto-curation or full MCP context has already run.
