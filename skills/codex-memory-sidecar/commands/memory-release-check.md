# Memory Release Check

Perform a release-oriented check for Codex Memory Sidecar.

1. Call `start_memory_session`.
2. Verify health, backup state, warnings, and freshness.
3. Inspect whether README, AGENTS-memory-protocol, Skill resources, hook docs, and plugin packaging docs are aligned.
4. Report:
   - release blockers
   - documentation drift
   - plugin or hook caveats
   - memory state issues worth fixing before release
