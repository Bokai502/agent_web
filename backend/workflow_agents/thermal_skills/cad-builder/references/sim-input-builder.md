# CAD Builder: Sim Input

Build the thermal simulation geometry and after-state metadata from the
CAD-native spec.

## Class Responsibilities

- `CadSimInputBuildRequest`: carries explicit runtime inputs: workspace,
  optional spec path, optional output path, optional document name, optional
  FreeCAD RPC host/port, and optional grid shape.
- `CadSimInputBuilder`: builds `geometry_after_power_filtered.step` and
  `simulation_input.json`.
- `CadAfterStatePreparer`: derives `geometry_after.geom.json`,
  `geometry_after.layout_topology.json`, `geometry_after_registry.json`, and
  COMSOL grid input files from CAD outputs.

## Defaults

- Input: `<workspace_dir>/00_inputs/cad_build_spec.json`
- Output STEP: `<workspace_dir>/01_cad/geometry_after_power_filtered.step`
- Simulation input: `<workspace_dir>/01_cad/simulation_input.json`
- Generated runner: `<workspace_dir>/01_cad/runners/run_cad_sim_input_builder.py`

## Steps

1. Generate `<workspace_dir>/01_cad/runners/run_cad_sim_input_builder.py` using the
   class composition rules below. Do not execute the generated script yet.
2. In the generated runner, call `CadProgressUpdater.update(...)` with role `cad_sim_input`
   when the operation starts or reaches a meaningful stage.
3. Execute `<workspace_dir>/01_cad/runners/run_cad_sim_input_builder.py`; inside that
   script, run `CadSimInputBuilder.build(...)`, then
   `CadAfterStatePreparer.prepare(...)`.
4. In the generated runner, call `CadProgressUpdater.update(...)` with role `cad_sim_input`
   after successful execution using a completed status.

## Composition Rules

- This skill requires `00_inputs/cad_build_spec.json`.
- Generate and execute `<workspace_dir>/01_cad/runners/run_cad_sim_input_builder.py`;
  the runner should import `cad_builders.sim_input` from the local
  `cad_builders/src` package path.
- The runner may include local orchestration code, but simulation STEP/input
  construction and after-state metadata generation must come from the sim input
  class APIs. Print one JSON object containing the selected step results.
- Request inputs: `workspace_dir`, optional `spec_path`, optional `output_dir`,
  optional `doc_name`, optional `host`, optional `port`, and optional
  `grid_shape`.
- Omit `doc_name` unless the user explicitly provides one; the class default
  uses the normalized `<thermal-kind>_<user>_<version>_simulation` document name.
- Update progress only through `cad_builders.progress.CadProgressUpdater` with role `cad_sim_input`;
  do not edit progress JSON or workflow node fields directly.
- Resolve progress by `progressRole: "cad_sim_input"`, not by hard-coded
  workflow node id.
- Include only components where `thermal.include_in_simulation == true`, and
  include walls as non-heat-source metadata.
- Do not export a GLB in this step.
- If FreeCAD RPC is unavailable, report the host/port connection failure.

## Outputs

- `<workspace_dir>/01_cad/geometry_after_power_filtered.step`
- `<workspace_dir>/01_cad/simulation_input.json`
- `<workspace_dir>/01_cad/geometry_after.geom.json`
- `<workspace_dir>/01_cad/geometry_after.layout_topology.json`
- `<workspace_dir>/01_cad/geometry_after_registry.json`
- `<workspace_dir>/01_cad/comsol_inputs/coord.txt`
- `<workspace_dir>/01_cad/comsol_inputs/channels_input.npz`
- `<workspace_dir>/01_cad/runners/run_cad_sim_input_builder.py`
