# Memory Observatory 3D Bundle Notice

Issue #109 tracks this public-release cleanup.

`vendor/observatory-3d.bundle.js` is a reproducible browser bundle for the
read-only Memory Observatory Dashboard view. It exposes these globals used by
`src/dashboard.ts`:

- `window.ForceGraph3D`
- `window.THREE`
- `window.UnrealBloomPass`

## Direct Sources

The bundle is generated from `scripts/observatory-3d-entry.mjs` with:

```powershell
npm run build:observatory-bundle
```

The checked-in bundle can be verified with:

```powershell
npm run check:observatory-bundle
```

The checksum is stored in `vendor/observatory-3d.bundle.sha256`.

Direct npm packages:

| Package | Use | License |
| --- | --- | --- |
| `3d-force-graph` | 3D graph renderer for memory nodes and edges | MIT |
| `three` | WebGL scene primitives and `UnrealBloomPass` | MIT |
| `esbuild` | Development-time bundler used to produce the vendored bundle | MIT |

Transitive notices that esbuild preserves from bundled source files are kept at
the end of `vendor/observatory-3d.bundle.js` under `Bundled license information`.

## Operational Notes

- The bundle is served only from the local Dashboard route
  `/assets/observatory-3d.bundle.js`.
- Dashboard refreshes and graph rendering must remain read-only; they must not
  write memory, audit events, or search events by themselves.
- If package versions change, run `npm run build:observatory-bundle`, review the
  bundle diff, and keep this notice plus the checksum in sync.
