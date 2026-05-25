# Backend Modules

The backend is grouped by business capability. Keep route handlers inside the
module that owns the API surface, and move shared behavior into services or
small shared helpers when a second module needs it.

## Modules

- `artifacts`: static/local artifact delivery such as images.
- `codex-run`: Codex SDK execution, SSE streaming, input files, and run context.
- `manifests`: workspace manifests, versions, runs, artifacts, checkpoints, and scores.
- `server`: backend route registration and server composition.
- `sessions`: conversation history APIs and workspace-backed persistence.
- `shared`: cross-module request parsing, HTTP response, and path helpers.
- `system`: health checks, skill cache, and other backend support APIs.
- `workspaces`: workspace selection, BOM, models, progress, and stage logs.

## Dependency Direction

Prefer this direction when adding new code:

```text
*.routes.ts -> *.service.ts -> stores/adapters -> shared utilities
```

Routes should stay thin: validate request shape, call module services, and map
errors to HTTP responses. Stores and adapters should avoid importing routes.
