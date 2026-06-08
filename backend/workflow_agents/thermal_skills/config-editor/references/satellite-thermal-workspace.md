# Satellite Thermal Workspace Reference

This config editor currently supports one fixed task family: satellite thermal
simulation configuration. Use this reference to locate the correct workspace
and version, choose which configuration/history files to read, and understand
what each file contains.

## Workspace And Version Locator

Open Codex Web passes task context from the frontend/backend into the agent
prompt. The important identifiers are:

- `workspace_id`: frontend/backend workspace identifier, for example
  `ws_demo`.
- `version_id`: selected version identifier, for example `v0001`.
- `workspace_dir`: absolute path for the selected workspace version, for
  example
  `<workspace.usersRoot>/<user_id>/workspaces/ws_demo/versions/v0001`.
- `session_id`, `thread_id`, and `turn_id`: request correlation identifiers.

When all three workspace fields are available, treat `workspace_dir` as the
path to inspect, but verify it matches the identifiers:

```text
<workspace.usersRoot>/<user_id>/workspaces/<workspace_id>/versions/<version_id>
```

When `workspace_dir` is missing but `workspace_id` and `version_id` are
available, derive the expected path from the workspace root:

```text
<workspace.usersRoot>/<user_id>/workspaces/<workspace_id>/versions/<version_id>
```

If `version_id` is missing, use the active version from the workspace manifest
when available. If no active version can be identified, stop and ask for the
workspace/version context instead of guessing.

For this config-editing task, the configuration source is always the initial version:

```text
<workspace root>/workspaces/<workspace_id>/versions/v0001/00_inputs
```

Use `version_id` to identify the selected run/history context, but read and
update configuration under `v0001/00_inputs` unless the user explicitly changes
this policy.

## Primary Directories

`v0001/00_inputs/`

- Fixed configuration input directory for satellite thermal simulation.
- Contains component, geometry, and layout/topology data used by CAD and
  simulation stages.
- Read only the specific files required by the user's requested change.
- The config editor's Markdown output must also be written here as
  `config_editor_output.md`.

`<selected version>/logs/`

- Historical and runtime information for the selected version.
- Contains progress snapshots, stage results, validation details, failures, and
  tool diagnostics.
- Use logs to understand what happened in previous runs and why a
  configuration change may be needed.

`workspace_manifest.json`

- Workspace/version index when present near the workspace root.
- Contains workspace id, version ids, active version, version workspace paths,
  statuses, labels, and timestamps.
- Read this only when the prompt identifiers are incomplete, inconsistent, or
  the active version must be resolved.

## Configuration Files In `00_inputs`

`real_bom.json`

- Bill of materials and component/device metadata.
- Typical contents include component ids, names/types, physical dimensions,
  mass/material metadata, power or heat-load related fields, source information,
  and references to real device data.
- Read this for requests about replacing devices, changing power/heat
  dissipation, component selection, mass/material updates, or component-level
  thermal properties.

`geom.json`

- Geometry configuration used to build or validate the satellite model.
- Typical contents include body dimensions, component dimensions, positions,
  mounting faces, coordinate frames, bounding boxes, and geometry parameters
  consumed by CAD or thermal meshing.
- Read this for requests about size, placement, clearances, mounting geometry,
  model dimensions, or geometry-dependent simulation behavior.

`layout_topology.json`

- Layout and topology relationship source of truth.
- Typical contents include component placement, adjacency, installed faces,
  orientation, parent/child relationships, collision-sensitive placement, and
  topology constraints.
- Read this for requests about moving components, changing installation faces,
  rearranging layout, avoiding overlap, or preserving topology constraints.

Other `00_inputs` files, if present

- Treat additional JSON/YAML/TOML files as task-specific configuration.
- Inspect filenames first. Read a file only when the name or the user's request
  indicates it is relevant.
- Preserve unknown fields and existing format.

## History Files In `logs`

`progress_percentages.json`

- UI/progress snapshot for the pipeline.
- Usually records current stage, progress percentage, status, timestamps, and
  high-level messages.
- Read for questions about whether the last run finished, where it stopped, or
  which stage was active.

`*_stage_result.json`

- Stage result snapshots, such as `simulation_run_stage_result.json`,
  `analysis_stage_result.json`, or CAD/build/validation stage outputs.
- Usually records success/failure status, command details, artifact paths,
  metrics, error messages, and structured summaries.
- Read the stage file that matches the user's intent. For example, read
  simulation stage results for thermal run failures and analysis stage results
  for temperature/thermal interpretation questions.

`pipeline.log`

- Human-readable pipeline execution log when present.
- Contains command traces, stage transitions, warnings, errors, and diagnostic
  text.
- Read only targeted excerpts with search/tail when structured JSON logs do
  not explain the issue.

`registry/`

- Artifact registry directory when present.
- Contains records for generated outputs such as geometry files, reports,
  simulation artifacts, screenshots, and analysis summaries.
- Read when a task depends on knowing which artifacts were produced.

Other log files, if present

- Inspect names first and read selectively.
- Prefer structured JSON over large text logs.
- For text logs, use targeted search terms from the user's request, component
  ids, stage names, or error keywords.

## Selective Reading Guide

Do not read every file by default. Route by user intent:

- Component replacement or BOM edits: read `real_bom.json`; then read
  `geom.json` or `layout_topology.json` only if dimensions, placement, or
  topology may be affected.
- Power, heat load, material, or thermal property changes: read
  `real_bom.json`; read recent simulation/analysis stage results if the change
  is motivated by prior thermal output.
- Move, rotate, face, clearance, or overlap changes: read
  `layout_topology.json` and `geom.json`; read CAD/validation logs only if the
  request mentions previous geometry failures. For overlaps or geometry
  errors, identify the affected component ids and change only those components.
- Thermal simulation failure or retry planning: read
  `logs/progress_percentages.json`, the relevant `*_stage_result.json`, and
  targeted excerpts from `pipeline.log` if needed.
- Temperature or analysis interpretation: read analysis stage results first;
  read `real_bom.json` only for component names, powers, or materials needed to
  explain the result.
- General "adjust config based on my request": read filenames under
  `00_inputs`, then open the smallest likely set from the descriptions above.

## Change Report Evidence

For every configuration change, `00_inputs/config_editor_output.md` should briefly cite:

- The user request that required the change.
- The exact config file and field changed.
- Any history file that motivated the change.
- Any assumption made because the logs/config did not contain enough detail.

Do not include secrets or full large logs in the report. Summarize only the
relevant evidence.
