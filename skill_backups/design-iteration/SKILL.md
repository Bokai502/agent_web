---
name: design-iteration
description: "Control layer for versioned CAD/simulation iterations. Use when the user asks to branch, checkout, compare versions, run a tracked design iteration, register artifacts/checkpoints, or coordinate freecad and simulation-skill under the workspace manifest."
---

# Design Iteration

This skill is the control layer for versioned design work. It coordinates the
versioning API, `freecad`, and `simulation-skill`.

## Core Rules

- Do not edit `workspace_manifest.json` directly.
- Do not manually create or rename version records in files.
- Do not create version branches by filesystem operations. Never use `mkdir`,
  `cp -a`, `rsync`, `rm -rf`, or manual edits under
  `<workspaceRoot>/versions/v####` to make a branch or repair a version.
  Directory-only versions are invisible to the frontend because the UI reads
  `workspace_manifest.json`.
- Use the Versioning API as the only way to update versions, runs, artifacts,
  checkpoints, scores, and the active version pointer.
- If the Versioning API is unavailable or returns an error, stop and report the
  API failure. Do not fall back to manually copying version directories.
- Use `freecad` for CAD build, move, and validation work.
- Use `simulation-skill` for simulation doctor, simulation run, postprocess,
  and analysis work.
- Keep each iteration's artifacts inside its version workspace.
- For a versioned iteration, branch from `active_version_id` before running CAD
  or simulation. Branch and checkout APIs are request-scoped and update the
  workspace index/default active version; they do not update
  `/data/lbk/codex_web/config.json`.
- Treat the prompt's `workspace_dir` as authoritative for the current
  workspace/version request. FreeCAD and simulation execution must target this
  exact version workspace.
- For CLIs that accept a workspace option, pass `workspace_dir` explicitly
  (for example `--workspace-dir <workspace_dir>`). Do not rely on
  `config.json`, process cwd, or CLI defaults for versioned work.
- Long-running Open Codex Web runs are managed as backend jobs. Browser refresh
  can re-subscribe to the job event stream, but the version workspace remains
  the request-scoped `workspace_dir`.
- When the user asks to select devices from the thermal simulation database and
  add/replace them in `00_inputs`, read
  `references/device-db-to-00-inputs.md`.

## Context Fields

The prompt may provide:

- `session_id`
- `workspace_id`
- `version_id`
- `turn_id`
- `workspace_dir`
- active version information from
  `GET /api/workspace-index/:workspaceId/manifest?initialize=1`

Treat `workspace_dir` as the selected version workspace for this request. It is
resolved from `workspace_id` and `version_id` by Open Codex Web. Do not replace
it with `/data/lbk/codex_web/config.json`'s `freecad.workspaceDir`.

## Versioning API

Use these backend endpoints:

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

In Open Codex Web, prefer the API base URL provided by the running app or task
context. Do not assume `localhost:3000`; the frontend dev server and backend API
may use different ports.

Request examples:

```json
{
  "workspaceId": "ws_example",
  "label": "move P015 away from hotspot"
}
```

```json
{
  "workspaceId": "ws_example",
  "baseVersionId": "v0001",
  "outputVersionId": "v0002",
  "kind": "full_pipeline",
  "skillNames": ["freecad", "simulation-skill"]
}
```

## Standard Iteration Flow

For a versioned CAD/simulation change:

1. Read the manifest:

```text
GET /api/workspace-index/:workspaceId/manifest?initialize=1
```

For adding or replacing devices from
`/data/wqn/cad2comsol2paraview/data/module_db/热仿真数据库.xlsx`, first read
`references/device-db-to-00-inputs.md`; it defines database matching,
`real_bom.json`, `geom.json`, and `layout_topology.json` update rules.

2. Identify `activeVersionId`.
3. Branch from the active version:

```text
POST /api/versions/:activeVersionId/branch
```

4. The branch API makes the returned version active in the workspace manifest
   and workspace index. Use the returned `version.workspaceDir` as
   `workspace_dir` for execution.
5. Create a run:

```text
POST /api/runs
```

6. Run the appropriate execution skill:

- Use `freecad` for CAD creation, modification, or validation.
- Use `simulation-skill` for thermal simulation and analysis.

For FreeCAD, use explicit workspace-scoped commands:

```bash
python -m freecad_cli_tools.cli.main config show --workspace-dir <workspace_dir>
python -m freecad_cli_tools.cli.main cad build --workspace-dir <workspace_dir>
python -m freecad_cli_tools.cli.main cad validate --workspace-dir <workspace_dir>
python -m freecad_cli_tools.cli.main layout safe-move --workspace-dir <workspace_dir>
```

For simulation, pass the request-scoped version workspace:

```bash
/data/conda/bin/python /data/lbk/codex_web/freecad_skills/sim_skills/sim_cli_tools/sim_run.py \
  --json doctor \
  --workspace-dir <workspace_dir>
```

Before running simulation, inspect the selected workspace with `doctor` and
verify the reported `workspace_dir` matches the prompt's `workspace_dir`. After
FreeCAD execution, verify that `01_cad` exists under `workspace_dir`.

7. Register artifacts using paths relative to the version workspace.
   If collecting the standard CAD/simulation outputs, use:

```text
POST /api/versions/:versionId/artifacts/register-existing
```

8. Register checkpoints at key boundaries:

- `draft_created`
- `cad_completed`
- `simulation_completed`
- `analysis_completed`
- `scoring_completed` when scoring exists

9. Mark the run completed or failed.
10. Commit or checkout the version only when requested or when the task requires
    the result to become active.

Use `GET /api/versions/:a/diff/:b?workspaceId=:workspaceId` for version comparison.
Use `POST /api/runs/:runId/retry` to create a retry run with the original run's
inputs and `retryOfRunId` recorded. Use `POST /api/runs/:runId/cancel` to mark
a queued/running/waiting run as cancelled.

## Artifact Registration Guidance

Common CAD artifacts:

```text
01_cad/geometry_after.step
01_cad/geometry_after.glb
01_cad/simulation_input.json
01_cad/cad_agent_output.json
logs/progress_percentages.json
```

Common simulation artifacts:

```text
02_sim/run_manifest.json
02_sim/simulation/status.json
02_sim/simulation/simulation_manifest.json
02_sim/simulation/native.vtu
02_sim/analysis/metrics_summary.json
02_sim/analysis/anomaly_candidates.json
02_sim/analysis/diagnosis.json
logs/progress_percentages.json
```

Register only artifacts that exist. If a required artifact is missing, mark the
run or checkpoint failed and explain the missing path.

## Checkpoint Guidance

Checkpoint records should reference existing artifact IDs and state files.

Use `stateRefs` for low-level state evidence such as:

```text
logs/progress_percentages.json
logs/*_stage_result.json
02_sim/run_state.json
02_sim/run_manifest.json
```

Do not put large file contents into checkpoint records.

## Failure Handling

- If branch creation fails, stop and report the API error.
- If `freecad` fails, register a failed checkpoint if possible and mark the run
  failed.
- If `simulation-skill` doctor reports missing inputs, stop and report the exact
  missing paths.
- If simulation or analysis fails, preserve the version workspace and logs.
- Do not delete a failed version workspace.

## Non-Versioned Requests

If the user asks only a direct, one-off FreeCAD or simulation question and does
not ask for tracking, versioning, branch, checkout, comparison, or iteration,
you may answer using the relevant execution skill directly.
