---
name: freecad
description: "FreeCAD CLI/RPC workflow for the current 00_inputs -> 01_cad CAD stage. Use when Codex needs to create a new CAD model with cad build + cad validate, modify an existing CAD model with layout safe-move + cad validate, inspect runtime/workspace config, validate CAD outputs with geometry checks and screenshots, or debug FreeCAD workflow arguments and progress logs."
---

# FreeCAD

## Prerequisites

- Before running a workflow command, call `python -m freecad_cli_tools.cli.main config show --workspace-dir <workspace_dir>` to read the resolved workspace, RPC settings, default input paths, default output paths, and component-info STEP size limit.
- Expect FreeCAD RPC at the `rpc_host` and `rpc_port` reported by `python -m freecad_cli_tools.cli.main config show`, unless the active workflow command is given explicit `--host` or `--port` overrides. If RPC is unavailable, report the connection problem clearly instead of guessing.
- Open Codex Web injects the bundled CLI source directory into `PYTHONPATH` for agent runs. If `ModuleNotFoundError: freecad_cli_tools` appears, verify `PYTHONPATH` includes `open_codex_web/backend/workflow_agents/agents/freecad_cli_tools/src` before changing commands or searching for alternate modules.

## User Updates

- When explaining setup or first actions to the user, do not say the skill
  directory/path "did not match", "was not hit", or that you are "locating the
  actual CLI environment". Those are internal implementation details and can
  sound like a failure.
- Prefer this wording: "I will use the execution-context `workspace_dir` and
  pass it explicitly as `--workspace-dir` to the FreeCAD CLI, so `00_inputs` is
  read from the selected workspace and outputs do not fall back to `config.json`
  defaults."

## Route The Request

There are two primary workflows:

- Create a new CAD model: read `guides/cad-build-workflow.md`, run
  `python -m freecad_cli_tools.cli.main progress update --workspace-dir <workspace_dir> --loop-name create_cad --status running --completed false --percentage 60`,
  run `python -m freecad_cli_tools.cli.main cad build --workspace-dir <workspace_dir>`, update progress to 85, then read
  `guides/cad-validate-workflow.md`, run `python -m freecad_cli_tools.cli.main cad validate --workspace-dir <workspace_dir>`, and
  update progress to `--completed true --percentage 100` with `--status completed` when validation passes or `--status failed` when validation fails.
- Modify an existing CAD model: read `guides/safe-move-workflow.md`, run
  `python -m freecad_cli_tools.cli.main progress update --workspace-dir <workspace_dir> --loop-name modify_cad --status running --completed false --percentage 0`,
  run `python -m freecad_cli_tools.cli.main layout safe-move --workspace-dir <workspace_dir>`, update progress to 60, then read
  `guides/cad-validate-workflow.md`, run `python -m freecad_cli_tools.cli.main cad validate --workspace-dir <workspace_dir>`, and
  update progress to `--completed true --percentage 100` with `--status completed` when validation passes or `--status failed` when validation fails.

Route requests this way:

- Use the create workflow when the user asks to create, build, rebuild, or
  regenerate the CAD model from `00_inputs`.
- Use the modify workflow for move, rotate, re-seat, install-face changes,
  collision-avoidance moves, or requests to adjust an existing component.
- Use only `guides/cad-validate-workflow.md` when the user asks only to validate
  a CAD build, check geometry correctness, detect collisions/overlaps, verify贴面安装
  or face occupancy, capture screenshots, or inspect `cad_agent_output.json`
  validation results.
- Use `guides/create-assembly-from-component-info.md` only as an auxiliary
  real STEP/STP asset assembly/debug workflow when the request explicitly
  mentions `python -m freecad_cli_tools.cli.main assembly create-from-component-info`,
  `component_info_assembly.step`, real STEP/STP asset import behavior,
  `real_bom.source.template_csv`, or optional `geom_component_info.json`. Do not
  treat it as the standard create-CAD workflow because it does not produce the
  standard `geometry_after.step/.glb` CAD-stage outputs.
- If the user asks only about workspace/config/CLI argument behavior, stay in
  this file unless a workflow guide is needed.

## Hard Rules

- Treat `layout_topology.json` plus `geom.json` as the geometry/layout source of truth. Treat `real_bom.json + layout_topology.json + geom.json` as the CAD-stage build source of truth. Do not use `sample.yaml`; it is backup-only.
- `python -m freecad_cli_tools.cli.main layout safe-move` defaults to `./00_inputs/layout_topology.json` and `./00_inputs/geom.json` under the resolved workspace root.
- The standard create workflow is always `python -m freecad_cli_tools.cli.main cad build` followed by
  `python -m freecad_cli_tools.cli.main cad validate`.
- The standard modify workflow is always `python -m freecad_cli_tools.cli.main layout safe-move`
  followed by `python -m freecad_cli_tools.cli.main cad validate`.
- The component-info CAD-asset build defaults to `./00_inputs/real_bom.json`, `./00_inputs/layout_topology.json`, and `./00_inputs/geom.json`. It resolves STEP/STP paths from `real_bom.source.template_csv`; explicit `--geom-component-info` is optional and overrides synthesized component info. It is an auxiliary/debug workflow, not the default create workflow.
- `python -m freecad_cli_tools.cli.main layout safe-move` defaults to writing after-state outputs under `./01_cad` under the resolved workspace root. `python -m freecad_cli_tools.cli.main assembly create-from-component-info` defaults to writing `component_info_assembly.step/.glb` under `./01_cad`.
- Never infer dataset input paths from the repository root, the skill backup directory, or the process `cwd` once a workspace root has been resolved. Expand defaults to absolute paths before reasoning about missing files or running commands.
- If default input files are not present under the resolved workspace, do not search broadly for similarly named files. Ask for or require a corrected `--workspace-dir`, `workspace.workspaceDir`, `--layout-topology`, and `--geom` path.
- Placeholder and safe-move CAD artifacts must be named `geometry_after.step` and `geometry_after.glb`. Component-info CAD-asset builds must be named `component_info_assembly.step` and `component_info_assembly.glb`. If a CLI accepts an output path, use it only to choose the directory or parent path unless the guide says otherwise.
- `python -m freecad_cli_tools.cli.main layout safe-move` writes non-destructive dataset outputs such as `geometry_after.layout_topology.json` and `geometry_after.geom.json`. Do not overwrite the source dataset unless the workflow explicitly says to.
- Preserve the component-local contact face when changing the installation face. Derive runtime orientation from `placement.mount_face_id`, `placement.component_mount_face_id`, and `placement.alignment.in_plane_rotation_deg` instead of storing `placement.rotation_matrix`.
- Prefer first-class commands:
  - `python -m freecad_cli_tools.cli.main cad build`
  - `python -m freecad_cli_tools.cli.main cad validate`
  - `python -m freecad_cli_tools.cli.main layout safe-move`
  - `python -m freecad_cli_tools.cli.main progress update`
  - `python -m freecad_cli_tools.cli.main config show`
  - `python -m freecad_cli_tools.cli.main assembly create-from-component-info` only for auxiliary real-CAD asset assembly/debug tasks
- After CAD geometry changes, recompute and fit the view unless the active command exposes and uses an explicit opt-out such as `--no-fit-view`.
- Verify outputs after execution. If the dataset update succeeds but STEP or GLB export is missing, report partial success rather than full success.
- For every two-primary-workflow run, update `<resolved workspace>/logs/progress.json` with
  `python -m freecad_cli_tools.cli.main progress update --workspace-dir <workspace_dir> --loop-name <create_cad|modify_cad> --status <running|completed|failed> --completed <true|false> --percentage <0-100>`.
  The `--completed` value is required and must be exactly `true` or `false`; when it is `true`, the command writes `percentage: 100.0` and `finished_at` regardless of the input percentage.
  The progress command records `created_at`, `updated_at`, `finished_at`, `completed`, and the latest input fields for each loop.
- Pass the same explicit `--workspace-dir <workspace_dir>` to progress updates as to the workflow command during normal Open Codex Web runs.
- For `create_cad`, this loop may already be at 50 after `config-editor`, so do not reset it to 0. Before the long CAD/RPC build operation, write `--status running --completed false --percentage 60`; after `cad build` succeeds, keep `--completed false` and advance to 85; after `cad validate` finishes, write `--completed true --percentage 100`. Use `--status failed` if validation failed, but still mark completed because the workflow ran to completion.
- For `modify_cad`, before the long CAD/RPC safe-move operation, write `--status running --completed false --percentage 0`; after `layout safe-move` succeeds, keep `--completed false` and advance to 60; after `cad validate` finishes, write `--completed true --percentage 100`. Use `--status failed` if validation failed, but still mark completed because the workflow ran to completion.
- Check and report progress fields from `<resolved workspace>/logs/progress_percentages.json`: `workflow`, `stage`, `status`, `overall_percent`, `modeling_percent`, `export_file_percent`, `validation_percent`, and `error`. STEP and GLB exports each contribute 50% to `export_file_percent`.
- Progress `workflow` must match the two primary workflows: `create_cad` for `cad build -> cad validate`, and `modify_cad` for `layout safe-move -> cad validate`. A standalone validation run may use `cad_validation`.
- When that progress file already contains the BOM pipeline schema (`schema_version: "1.0"` with `steps`), FreeCAD must not replace the file with its standalone payload. Merge FreeCAD progress into the `geometry-edit` step: set `steps[].percent` for `geometry-edit` to the average of the three FreeCAD progress fields, keep it in the range `0-100`, attach the detailed values under `freecad_progress`, recompute `overall_percent`, and preserve top-level `output_files` for frontend display.
- When the progress file does not contain the BOM pipeline schema, the CLI may keep writing the standalone FreeCAD progress payload for direct FreeCAD use.

## Workflow Notes

- Create workflow: `python -m freecad_cli_tools.cli.main cad build` reads `00_inputs/real_bom.json`,
  `00_inputs/layout_topology.json`, and `00_inputs/geom.json`; writes
  `01_cad/geometry_after.step`, `geometry_after.glb`,
  `simulation_input.json`, and `cad_agent_output.json`; then
  `python -m freecad_cli_tools.cli.main cad validate` validates the result and writes validation plus
  six-face screenshot metadata into `01_cad/cad_agent_output.json`.
- Modify workflow: `python -m freecad_cli_tools.cli.main layout safe-move` solves in normalized
  coordinates, projects the move into the active face plane, preserves the
  component contact face, writes updated dataset files under `01_cad`, syncs
  CAD and exports `geometry_after.step/.glb` by default; then
  `python -m freecad_cli_tools.cli.main cad validate` validates the modified CAD model.
- CAD-stage validation reads `00_inputs` and `01_cad`, validates file
  completeness, ID contracts, bbox overlap, mount-plane contact, footprint
  bounds, and face occupancy; it writes the report directly into
  `01_cad/cad_agent_output.json` under `validation`, and writes six-face
  screenshot metadata under the top-level `screenshot` field.
- Auxiliary component-info CAD-asset workflow: normalize
  `real_bom.json + layout_topology.json + geom.json` into the internal
  component-info assembly spec, create a separate new assembly, include the
  envelope from `geom.outer_shell`, import real STEP components from
  `real_bom.source.template_csv` when available, fall back to box placeholders
  when they are not, then export `01_cad/component_info_assembly.step` and
  `01_cad/component_info_assembly.glb` by default.

## Error Handling

- If RPC connection fails, tell the user to check the running FreeCAD instance and MCP/RPC setup.
- If the CLI returns `"success": false`, surface the returned error details.
- If a move or build operation yields STEP without GLB, report partial success and include the artifact paths that do exist.
