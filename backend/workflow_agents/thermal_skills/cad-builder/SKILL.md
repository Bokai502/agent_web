---
name: cad-builder
description: "Build or validate CAD artifacts for satellite thermal workflows from 00_inputs/cad_build_spec.json. Use for placeholder box GLB, real assembly GLB, power-filtered simulation STEP/input files, after-state CAD metadata, and CAD output validation."
---

# CAD Builder

Build and validate CAD artifacts for the thermal workflow using the
`cad_builders` class APIs.

## Scope

This skill covers four CAD operations:

- `box`: build `01_cad/geometry_after.glb` and FreeCAD screenshots.
- `real-assembly`: build `01_cad/geometry_after_real_cad.glb`.
- `sim-input`: build `geometry_after_power_filtered.step`,
  `simulation_input.json`, after-state JSON, and COMSOL grid inputs.
- `validate`: validate required `01_cad` outputs.

Run only the operations needed for the user's request. For a full CAD refresh,
run `box`, then `real-assembly`, then `sim-input`; run `validate` when a CAD
gate or explicit validation is needed.

## References

Read the relevant reference before generating a runner:

- `references/box-builder.md` for placeholder box GLB and screenshot builds.
- `references/real-assembly-builder.md` for supplemental real assembly GLB.
- `references/sim-input-builder.md` for simulation STEP/input and after-state
  preparation.
- `references/validate.md` for CAD output validation.
- `references/module-index.md` when you need to inspect or choose among existing
  `cad_builders` classes and helper functions.

## Core Rules

- Use `00_inputs/cad_build_spec.json` as the CAD build input unless the user
  explicitly provides another spec path.
- Do not invoke a CAD command wrapper. Generate runnable Python scripts under
  `<workspace_dir>/01_cad/runners/` and call the `cad_builders` class API from
  those scripts.

## Generated Runner Freedom

Generated runners may include task-specific orchestration code around the
`cad_builders` class APIs. This can include argument parsing, conditional step
selection, preflight checks, result aggregation, lightweight output checks,
custom progress notes, and failure handling.

Do not reimplement core CAD build behavior, FreeCAD RPC execution, simulation
input construction, after-state generation, validation logic, or progress file
mutation in the runner. Use the `cad_builders` class APIs for those behaviors.

## Progress

Use `CadProgressUpdater` from the generated runner. Either call
`CadProgressUpdater().update(CadProgressRequest(...))`, or construct it with
`workspace_dir` and call `update(role=..., percentage=..., note=..., status=...)`.

Allowed roles are:

- `cad_box`
- `cad_real`
- `cad_sim_input`
- `cad_validate`

Let the generated runner choose progress percentages and notes that match the
actual operation stages. Keep progress monotonic for a role, use
`status="completed"` with a completed percentage after successful execution, and
use `status="failed"` with the last meaningful percentage when reporting a
terminal error.

## Outputs

Outputs depend on the selected operation. See the operation reference files for
the exact artifact list and operation-specific constraints.
