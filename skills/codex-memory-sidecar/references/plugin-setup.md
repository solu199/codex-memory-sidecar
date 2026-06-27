# Plugin Setup

Codex Memory Sidecar is moving toward plugin packaging so the bundle, not custom instructions, becomes the main installation surface.

## Supported packaging shape

The plugin package should bundle:

- gateway skill
- reference files
- command templates
- MCP config
- SessionStart hook config
- assets

## Operational stance

- Do not rely on Codex app custom instructions as the primary bootstrap.
- Let the broad gateway skill description handle most memory-aware tasks.
- Keep SessionStart hook as the backup for light chat starts or identity-style questions that may not mention memory explicitly.

## Caveats

- Plugin-bundled hooks still use trust review before they run.
- SessionStart hook is a backup, not a replacement for explicit `start_memory_session`.
- Custom prompt support in Codex is deprecated, so `commands/` should be treated as reusable prompt assets rather than native slash commands.
