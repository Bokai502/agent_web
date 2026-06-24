# CAD Builder: Validate

Validate outputs produced from `cad_build_spec.json`.

## Class Responsibilities

- `CadValidateRequest`: carries explicit runtime inputs: workspace, optional
  spec path, optional CAD output directory, validation tolerances, and optional
  report path.
- `CadValidateRunner`: runs the split CAD output validator through a class API
  and returns the validation report as a JSON-compatible dict.

## Defaults

- Input: `<workspace_dir>/00_inputs/cad_build_spec.json`
- CAD output directory: `<workspace_dir>/01_cad`
- Generated runner: `<workspace_dir>/01_cad/runners/run_cad_validate.py`
- Output report: stdout. Use `report_path` to persist the JSON report.

## Steps

1. Generate `<workspace_dir>/01_cad/runners/run_cad_validate.py` using the class
   composition rules below. Do not execute the generated script yet.
2. In the generated runner, call `CadProgressUpdater.update(...)` with role `cad_validate`
   when the operation starts or reaches a meaningful stage.
3. Execute `<workspace_dir>/01_cad/runners/run_cad_validate.py` to validate CAD
   outputs and print the report JSON.
4. In the generated runner, call `CadProgressUpdater.update(...)` with role `cad_validate`
   after successful execution using a completed status.

## Composition Rules

- Generate and execute `<workspace_dir>/01_cad/runners/run_cad_validate.py`; the runner
  should import `cad_builders.validate` from the local `cad_builders/src`
  package path.
- The runner may include local orchestration code, but CAD validation logic must
  come from the CAD validate class API. Print the report JSON.
- Request inputs: `workspace_dir`, optional `spec_path`, optional `cad_dir`,
  optional `max_occupancy_ratio`, optional `mount_tolerance_mm`, optional
  `overlap_tolerance_mm3`, optional `report_path`, and optional
  `echo_validator_output`. Keep `echo_validator_output` false for normal runs.
- Update progress only through `cad_builders.progress.CadProgressUpdater` with role `cad_validate`;
  do not edit progress JSON or workflow node fields directly.
- Resolve progress by `progressRole: "cad_validate"`, not by hard-coded
  workflow node id.
- Treat missing/empty required files as hard failures; treat bbox overlap, mount
  contact, and face occupancy as warnings.
- Use `success: true` when hard failures are absent, even if warnings exist.

## Required Files

- `01_cad/geometry_after.glb`
- `01_cad/geometry_after_power_filtered.step`
- `01_cad/geometry_after_real_cad.glb`
- `01_cad/simulation_input.json`
