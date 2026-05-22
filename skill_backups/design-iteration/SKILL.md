---
name: design-iteration
description: "Control layer for intent-driven, versioned CAD/simulation iterations. Use when the user asks to understand a design goal, inspect workspace inputs/history, plan a CAD or thermal simulation iteration, branch/checkout/compare versions, register artifacts/checkpoints, add or replace thermal-database devices in 00_inputs, or coordinate freecad and simulation-skill under the workspace manifest."
---

# Design Iteration

Use this skill as the lightweight orchestrator for versioned design work. It
decides what the user is trying to do, reads only the needed evidence, chooses
which reference files to load, then coordinates the Versioning API, `freecad`,
and `simulation-skill`.

## First Moves

1. Identify the user intent: inspect, compare, CAD/input change, simulation,
   full iteration, retry/recover, or device-database update.
2. Read the prompt fields and active manifest before changing anything. Load
   `references/versioning-api.md` if endpoint/body details are needed.
3. Load only the reference files needed for the task.
4. Inspect relevant workspace inputs/history and form a compact plan for
   non-trivial work.
5. Branch before making CAD, layout, input, or simulation-output changes.
6. Use `freecad` and/or `simulation-skill` for domain execution.

## Core Rules

- Do not edit `workspace_manifest.json` directly.
- Do not manually create, rename, or repair version records.
- Do not create version branches by filesystem operations. Never use `mkdir`,
  `cp -a`, `rsync`, `rm -rf`, or manual edits under
  `<workspaceRoot>/versions/v####` to make a branch.
- Use the Versioning API as the only way to update versions, runs, artifacts,
  checkpoints, scores, and the active version pointer.
- If the Versioning API is unavailable or returns an error, stop and report the
  API failure. Do not fall back to manual workspace copying.
- Treat the prompt's `workspace_dir` as authoritative for the selected
  workspace/version. Pass it explicitly to CLIs that accept `--workspace-dir`.
- For versioned iteration work, branch from the active version before operations
  that write CAD outputs, change inputs/layout, or produce new simulation
  outputs. Inspect-only, compare-only, doctor, and read-only validation tasks do
  not require a branch unless the user asks to track new outputs separately.
- After branch or checkout, discard stale `workspace_dir` values and use the
  returned active version's `workspaceDir` for all subsequent file reads,
  command execution, and artifact registration.
- Use `freecad` for CAD build, layout/device movement, geometry validation, and
  CAD artifact generation.
- Use `simulation-skill` for simulation doctor, simulation runs, postprocess,
  thermal analysis, and result interpretation.
- Keep each iteration's artifacts inside its version workspace.
- Do not delete failed version workspaces; preserve logs and evidence.

## Prompt Fields

The prompt may provide:

- `session_id`
- `workspace_id`
- `version_id`
- `turn_id`
- `workspace_dir`
- active version information from
  `GET /api/workspace-index/:workspaceId/manifest?initialize=1`

After checkout or branch, `/data/lbk/codex_web/config.json`
`freecad.workspaceDir` should match the selected version workspace.

## Reference Router

Load references one level deep from this folder. Do not preload every reference.

- `references/intent-and-planning.md`: read when interpreting a user goal,
  choosing whether to branch, deciding which files/history to inspect, or
  drafting the execution plan.
- `references/versioning-api.md`: read before calling manifest, branch,
  checkout, commit/fail, diff, run, retry/cancel, artifact, checkpoint, or score
  APIs.
- `references/iteration-workflows.md`: read when executing a tracked CAD,
  simulation, full-pipeline, comparison, or retry workflow.
- `references/artifacts-checkpoints-failures.md`: read when registering outputs,
  checkpoints, scores, run completion/failure, or preserving failure evidence.
- `references/device-db-to-00-inputs.md`: read only when adding, replacing, or
  selecting devices from the thermal simulation database into `00_inputs`.

## Default Flow

For a non-trivial versioned CAD/simulation change:

1. Read `references/intent-and-planning.md`.
2. Read `references/versioning-api.md` and fetch the active manifest.
3. Inspect only the relevant workspace evidence.
4. Create a compact plan.
5. Branch from the active version.
6. Create a run.
7. Load `references/iteration-workflows.md` and use the needed execution skill.
8. Load `references/artifacts-checkpoints-failures.md` when registering outputs
   or handling failures.

For compare, inspect, doctor, or validation-only requests, do not run the full
default flow. Read the smallest relevant references, avoid branch/run creation
unless output tracking is explicitly needed, and report evidence from the
selected version workspace.

For direct one-off FreeCAD or simulation questions without versioning, tracking,
branching, comparison, or iteration intent, answer with the relevant execution
skill directly.
