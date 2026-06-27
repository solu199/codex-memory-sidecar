# Memory Audit

Audit the current memory state for reliability.

1. Call `start_memory_session`.
2. Inspect directive memory, recent normal memories, freshness, review candidates, and warnings.
3. Use `audit_memory`, `read_memory`, or `search_memory` when needed to confirm provenance or staleness.
4. Report:
   - strongest trustworthy memories
   - stale or weakly sourced memories
   - duplicate or supersession candidates
   - recommended follow-up actions
