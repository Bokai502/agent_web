# CAD Builder: Box

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
- Generated runner: `<workspace_dir>/01_cad/runners/run_cad_box_builder.py`

## Steps

1. Generate `<workspace_dir>/01_cad/runners/run_cad_box_builder.py` using the class
   composition rules below. Do not execute the generated script yet.
2. In the generated runner, call `CadProgressUpdater.update(...)` with role `cad_box`
   when the operation starts or reaches a meaningful stage.
3. Execute `<workspace_dir>/01_cad/runners/run_cad_box_builder.py` to build the
   placeholder box GLB and screenshots.
4. In the generated runner, call `CadProgressUpdater.update(...)` with role `cad_box`
   after successful execution using a completed status.

## Composition Rules

- This skill requires `00_inputs/cad_build_spec.json`.
- Generate and execute `<workspace_dir>/01_cad/runners/run_cad_box_builder.py`; the
  runner should import `cad_builders.box` from the local `cad_builders/src`
  package path.
- The runner may include local orchestration code, but placeholder box build and
  screenshot behavior must come from the box class API. Print one JSON result
  object.
- Request inputs: `workspace_dir`, optional `spec_path`, optional `output_dir`,
  optional `doc_name`, optional `host`, and optional `port`.
- Omit `doc_name` unless the user explicitly provides one; the class default
  uses the normalized `<thermal-kind>_<user>_<version>_box` document name.
- Update progress only through `cad_builders.progress.CadProgressUpdater` with role `cad_box`;
  do not edit progress JSON or workflow node fields directly.
- Resolve progress by `progressRole`, not by hard-coded workflow node id.
- This step exports only the placeholder box GLB and screenshots. It must not
  export simulation STEP or real-CAD outputs.
- If FreeCAD RPC is unavailable, report the host/port connection failure.

## Output

- `<workspace_dir>/01_cad/geometry_after.glb`
- `<workspace_dir>/01_cad/freecad_screenshot_*.png`
- `<workspace_dir>/01_cad/runners/run_cad_box_builder.py`
