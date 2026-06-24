---
name: cad-box-builder
description: "Build only the placeholder box GLB from 00_inputs/cad_build_spec.json through FreeCAD RPC. Use when Codex needs geometry_after.glb without building real assemblies or simulation inputs."
---

# CAD Box Builder

Build the placeholder box model from the CAD-native spec.

## Class Responsibilities

- `CadBoxBuildRequest`: carries explicit runtime inputs: workspace, optional
  spec path, optional output path, optional document name, and optional FreeCAD
  RPC host/port.
- `CadBoxScreenshotCapture`: provides the FreeCAD screenshot helper script and
  validates expected screenshot artifacts after the build.
- `CadBoxGeometryBuilder`: renders the FreeCAD code that builds placeholder box
  geometry, envelope/wall previews, GLB export, and screenshot capture.
- `CadBoxBuilder`: orchestrates path resolution, spec validation, FreeCAD RPC
  execution, screenshot result collection, and final JSON result construction.

## Defaults

- Input: `<workspace_dir>/00_inputs/cad_build_spec.json`
- Output: `<workspace_dir>/01_cad/geometry_after.glb`
- Generated runner: `<workspace_dir>/01_cad/run_cad_box_builder.py`

## Steps

1. Generate `<workspace_dir>/01_cad/run_cad_box_builder.py` using the class
   composition rules below. Do not execute the generated script yet.
2. Update progress to 40 by running
   `backend/workflow_agents/thermal_skills/cad-box-builder/scripts/progress.sh`
   with `<workspace_dir>` and `40`.
3. Execute `<workspace_dir>/01_cad/run_cad_box_builder.py` to build the
   placeholder box GLB and screenshots.
4. After the generated script exits successfully, update progress to 100 by
   running
   `backend/workflow_agents/thermal_skills/cad-box-builder/scripts/progress.sh`
   with `<workspace_dir>` and `100`.

## Composition Rules

- This skill requires `00_inputs/cad_build_spec.json`.
- Do not invoke the `cad_cli` command directly.
- Create a runnable Python script at
  `<workspace_dir>/01_cad/run_cad_box_builder.py`, then execute that generated
  script to perform the build.
- The generated script must add
  `open_codex_web/backend/workflow_agents/agents/cad_cli/src` to `sys.path`
  before importing `cad_cli.box`.
- The generated script must compose the class API from
  `open_codex_web/backend/workflow_agents/agents/cad_cli/src/cad_cli/box`:
  instantiate one `CadBoxScreenshotCapture`, pass it to
  `CadBoxGeometryBuilder`, pass both into `CadBoxBuilder`, then call
  `CadBoxBuilder.build(CadBoxBuildRequest(...))`.
- The generated script must print `result.to_dict()` as JSON.
- `CadBoxBuildRequest` inputs:
  `workspace_dir`, optional `spec_path`, optional `output_dir`, optional
  `doc_name`, optional `host`, and optional `port`.
- `scripts/progress.sh` inputs are exactly two positional arguments:
  `workspace-dir` and `percentage`.
- Do not hand-edit `<workspace_dir>/logs/progress.json` or workflow node
  `progress` fields.
- Progress is resolved by `progressRole`, not by hard-coded workflow node id.
- This step exports only the placeholder box GLB.
- It must not export `geometry_after_power_filtered.step` or real-CAD outputs.
- If FreeCAD RPC is unavailable, report the host/port connection failure.

## Output

- `<workspace_dir>/01_cad/geometry_after.glb`
- `<workspace_dir>/01_cad/freecad_screenshot_*.png`
- `<workspace_dir>/01_cad/run_cad_box_builder.py`
