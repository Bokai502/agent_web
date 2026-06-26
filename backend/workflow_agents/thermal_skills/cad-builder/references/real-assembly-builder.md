# CAD Builder: Real Assembly

Build the supplemental real assembly model from the CAD-native spec.

## Class Responsibilities

- `CadRealAssemblyBuildRequest`: carries explicit runtime inputs: workspace,
  optional spec path, optional output path, optional document name, and optional
  FreeCAD RPC host/port.
- `CadRealAssemblyBuilder`: resolves paths, validates the CAD build spec,
  normalizes component assembly input, renders the hybrid-link FreeCAD RPC
  script, executes FreeCAD RPC, copies the exported GLB artifact, and
  constructs the final JSON result.

## Defaults

- Input: `<workspace_dir>/00_inputs/cad_build_spec.json`
- Output: `<workspace_dir>/01_cad/geometry_after_real_cad.glb`
- Generated runner: `<workspace_dir>/01_cad/runners/run_cad_real_assembly_builder.py`

## Steps

1. Generate `<workspace_dir>/01_cad/runners/run_cad_real_assembly_builder.py` using the
   class composition rules below. Do not execute the generated script yet.
2. In the generated runner, call `CadProgressUpdater.update(...)` with role `cad_real`
   when the operation starts or reaches a meaningful stage.
3. Execute `<workspace_dir>/01_cad/runners/run_cad_real_assembly_builder.py` to build the
   supplemental real assembly GLB.
4. In the generated runner, call `CadProgressUpdater.update(...)` with role `cad_real`
   after successful execution using a completed status.

## Composition Rules

- This skill requires `00_inputs/cad_build_spec.json`.
- Generate and execute `<workspace_dir>/01_cad/runners/run_cad_real_assembly_builder.py`;
  the runner should import `cad_builders.real_assembly` from the local
  `cad_builders/src` package path.
- The runner may include local orchestration code, but real assembly build,
  hybrid-link execution, and export copying must come from the real assembly
  class API. Print one JSON result object.
- Request inputs: `workspace_dir`, optional `spec_path`, optional `output_dir`,
  optional `doc_name`, optional `host`, and optional `port`.
- Omit `doc_name` unless the user explicitly provides one; the class default
  uses the normalized `<thermal-kind>_<user>_<version>_real_cad` document name.
- Update progress only through `cad_builders.progress.CadProgressUpdater` with role `cad_real`;
  do not edit progress JSON or workflow node fields directly.
- Resolve progress by `progressRole`, not by hard-coded workflow node id.
- Use readable `components[].real_cad.step_path` files when available, and fall
  back to component boxes for missing or unreadable STEP files.
- This step is supplemental real assembly output; it must not create the
  simulation STEP.
- Do not create or persist `.hybrid_link` staging directories,
  `geometry_after_real_cad.hybrid_summary.json`, or
  `normalized_component_info_assembly.json`. Any temporary normalized input or
  `geometry_after_real_cad.step` export should be removed after GLB generation.
- If FreeCAD RPC is unavailable, report the host/port connection failure.

## Output

- `<workspace_dir>/01_cad/geometry_after_real_cad.glb`
- `<workspace_dir>/01_cad/runners/run_cad_real_assembly_builder.py`
