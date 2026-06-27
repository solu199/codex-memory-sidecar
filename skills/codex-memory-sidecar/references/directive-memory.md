# Directive Memory

Directive memory is for strong operating guidance. It sits below system or developer instructions, the latest user instruction, and `AGENTS.md`, but above normal memory.

## Scope choice

- Use `global` directives for long-term preferences that should apply across projects.
- Use `project` directives for repository-specific workflow, README, testing, MCP, or release rules.

If the scope choice is not obvious from the current task, ask the user before writing.

## Write and replace flow

1. Use `propose_directive_update` first.
2. Confirm whether the rule belongs in `global` or `project`.
3. Use `write_directive` only when the rule is durable and worth enforcing across later sessions.

If a directive becomes stale or conflicts with current instructions, prefer `disable_directive` or a replacement proposal over silent deletion.

## Citation rule

When relying on directive memory in an explanation, cite enough context to audit it:

- directive id
- scope
- `sourceRef`
- a short quoted summary of the directive content
