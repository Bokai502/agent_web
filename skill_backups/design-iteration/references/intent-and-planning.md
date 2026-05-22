# Intent and Planning

Read this reference when the task requires interpreting the user's goal,
inspecting workspace evidence, deciding whether to branch, or making an
execution plan.

## Intake

Always inspect:

- Current request fields: `workspace_id`, `version_id`, `turn_id`,
  `workspace_dir`.
- Manifest from
  `GET /api/workspace-index/:workspaceId/manifest?initialize=1`.
- Active version ID, active `workspaceDir`, parent version, label, and status.

Inspect when relevant:

- `00_inputs/`: BOM, geometry, topology, constraints, design requirements, and
  user-provided source files.
- `01_cad/`: existing geometry, CAD state, validation output, and
  `simulation_input.json`.
- `02_sim/`: simulation manifests, status, metrics, diagnosis, and previous
  thermal results.
- `logs/`: progress, stage results, failures, and tool diagnostics.
- Manifest/API history: previous runs, artifacts, checkpoints, scores, labels,
  and parent-child version relationships.
- Version diff API: when the user asks what changed, asks to compare, or wants
  to continue from a prior branch.
- If `workspace_dir` is present, verify it matches the active version's
  `workspaceDir`. After branch or checkout, use the newly returned
  `workspaceDir` as the selected workspace.

Prefer `rg`, `find`, `jq`, and small file reads. Do not load large mesh, STEP,
VTU, image, or binary artifacts into context.

## Intent Classes

- **Inspect/answer only**: do not branch. Summarize findings with file/API
  evidence.
- **Compare versions**: do not branch. Use the diff API and inspect referenced
  artifacts as needed.
- **CAD/input change**: branch first, then use `freecad` or focused structured
  edits inside the new version workspace.
- **Simulation/analysis**: run doctor/read-only analysis without a branch when
  no new outputs are requested. Branch when a new simulation, postprocess, or
  analysis output should be tracked separately.
- **Full iteration**: branch, create a run, apply CAD/input changes, validate
  CAD, run simulation, analyze results, register artifacts/checkpoints, and mark
  the run completed or failed.
- **Retry/recover**: use retry/cancel/fail APIs instead of editing records.
- **Device database update**: read `device-db-to-00-inputs.md` before writing
  `00_inputs`.

## Ambiguity Rules

- If the user asks "can this run?", "what happened?", "compare", "inspect", or
  "validate", start read-only.
- If the user asks "try", "optimize", "move", "replace", "add", "rerun", or
  "simulate this change", plan a tracked branch unless they explicitly ask for
  analysis only.
- If `workspace_id` or `workspace_dir` is missing and cannot be inferred from
  prompt context or the manifest API, ask for the workspace instead of guessing
  from repository paths.
- If a requested operation could be either cheap inspection or expensive
  simulation, inspect first and make the cost/branch choice explicit.

## Plan Template

For non-trivial work, state or internally follow a compact plan:

- Intent summary: what the user wants changed or learned.
- Starting point: active version and selected workspace directory.
- Evidence to read: inputs, CAD outputs, simulation outputs, history, or diffs.
- Branch strategy: whether a new branch is required and why.
- Execution skills: `freecad`, `simulation-skill`, or both.
- Validation: commands/checkpoints that prove the result is usable.
- Artifacts: expected files to register.

Update the plan if evidence contradicts the first interpretation. Ask the user
only when plausible actions would make different irreversible or expensive
changes.
