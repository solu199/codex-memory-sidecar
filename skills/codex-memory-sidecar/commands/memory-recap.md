# Memory Recap

Use `codex-memory-sidecar` to rebuild context for the current project.

1. Call `start_memory_session` with the current task description and project path.
2. Summarize directive memory, relevant memories, health, freshness, and warnings.
3. Cross-check the summary against current README/docs/files/git history before making claims.
4. Report:
   - what the saved memory says
   - what current files confirm
   - what remains uncertain
