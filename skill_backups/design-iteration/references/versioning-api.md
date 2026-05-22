# Versioning API

Read this reference before calling backend APIs that modify or inspect versions,
runs, artifacts, checkpoints, or scores.

## Contents

- API Base
- Endpoints
- Manifest
- Branch and Checkout
- Runs
- Request Bodies
- Diff, Retry, Cancel

## API Base

Prefer the API base URL provided by the running app or task context. Do not
assume `localhost:3000`; the frontend dev server and backend API may use
different ports.

If the base URL is not provided, infer it from the running Open Codex Web
process, environment, or config before making a request. Common local defaults
are backend port `3001` and frontend port `5174`, but treat them as defaults,
not guarantees.

## Endpoints

```text
GET  /api/workspace-index/:workspaceId/manifest?initialize=1
POST /api/versions/:versionId/branch
POST /api/versions/:versionId/checkout
POST /api/versions/:versionId/commit
POST /api/versions/:versionId/fail
GET  /api/versions/:a/diff/:b?workspaceId=:workspaceId
POST /api/runs
GET  /api/runs/:runId?workspaceId=:workspaceId
PATCH /api/runs/:runId
POST /api/runs/:runId/cancel
POST /api/runs/:runId/retry
POST /api/artifacts/register
POST /api/versions/:versionId/artifacts/register-existing
POST /api/checkpoints/register
POST /api/scores/register
```

## Manifest

Start most versioned tasks with:

```text
GET /api/workspace-index/:workspaceId/manifest?initialize=1
```

When available, include the selected workspace path:

```text
GET /api/workspace-index/:workspaceId/manifest?initialize=1&workspaceDir=<workspace_dir>
```

Use the returned active version as the source of truth for `activeVersionId`,
version workspace, parent links, history, runs, artifacts, checkpoints, and
scores.

## Branch and Checkout

Branch from the active version before changing CAD, layout, inputs, or tracked
simulation outputs:

```text
POST /api/versions/:activeVersionId/branch
```

Example body:

```json
{
  "workspaceId": "ws_example",
  "workspaceDir": "/path/to/current/version/workspace",
  "label": "move P015 away from hotspot"
}
```

The branch API makes the returned version active in the workspace manifest and
workspace index. Use returned `version.workspaceDir` as the execution
`workspace_dir`.

Use checkout only when the user wants to select an existing version or when the
workflow requires the result to become active.

## Runs

Create a run for tracked execution:

```text
POST /api/runs
```

Example body:

```json
{
  "workspaceId": "ws_example",
  "baseVersionId": "v0001",
  "outputVersionId": "v0002",
  "kind": "full_pipeline",
  "skillNames": ["freecad", "simulation-skill"]
}
```

Use `PATCH /api/runs/:runId` to update status/progress metadata. Mark runs
completed or failed through the API, not by editing files.

## Request Bodies

For branch, checkout, run, artifact, checkpoint, and score operations, include
the best available locator fields:

```json
{
  "workspaceId": "ws_example",
  "workspaceDir": "/path/to/selected/version/workspace",
  "versionId": "v0002",
  "turnId": "turn_example"
}
```

Use `workspaceId` when known. Include `workspaceDir` when the backend must
resolve or verify the selected version. For `POST /api/runs`, pass the output
version as both `outputVersionId` and `versionId` when the run tracks work in
the newly branched version.

## Diff, Retry, Cancel

Use version diff for comparisons:

```text
GET /api/versions/:a/diff/:b?workspaceId=:workspaceId
```

Use retry to create a retry run with original inputs and `retryOfRunId`
recorded:

```text
POST /api/runs/:runId/retry
```

Use cancel to mark queued/running/waiting runs cancelled:

```text
POST /api/runs/:runId/cancel
```
