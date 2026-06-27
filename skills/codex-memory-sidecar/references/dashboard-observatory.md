# Dashboard And Observatory

Use Dashboard and Observatory as read-only visibility surfaces.

## Dashboard

Dashboard is for state inspection:

- health
- backup state
- warning actions
- directive visibility
- memory freshness
- auto-curation status

Dashboard should not directly mutate DB state. Repairs, retention changes, restore planning, and write operations still go through MCP tools.

## Observatory

Memory Observatory is the visual graph view for normal memory relationships.

- treat it as privacy-safe by default
- `/api/graph` should return summaries and metadata, not full memory content or raw audit payloads
- detailed memory content should be fetched only through explicit detail actions
- reloading the Dashboard or viewing Observatory must not create new retrieved events or writes

## Performance

When UI work touches Observatory, preserve the current behavior:

- degrade rendering frequency when the tab is hidden or the Observatory view is inactive
- keep labels contextual rather than always-on
- prefer reduced work over background animation when the scene is idle
