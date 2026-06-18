---
name: cad-sim-input-builder
description: "Build only the power-filtered thermal simulation STEP and simulation_input.json from 00_inputs/cad_build_spec.json. Use when Codex needs simulation inputs for 02_sim without rebuilding box or real assembly GLBs."
---

# CAD Sim Input Builder

Build the thermal simulation geometry from the CAD-native spec.

## Command

```bash
python scripts/build_sim_input.py --workspace-dir <workspace_dir>
```

Defaults:

- Input: `<workspace_dir>/00_inputs/cad_build_spec.json`
- Outputs: `<workspace_dir>/01_cad/geometry_after_power_filtered.step`, `simulation_input.json`

## Rules

- This skill requires `00_inputs/cad_build_spec.json`.
- Include only components where `thermal.include_in_simulation == true`.
- Include walls in `simulation_input.json` metadata with `power_W = 0`.
- Do not export a GLB in this step.
- If FreeCAD RPC is unavailable, report the host/port connection failure.

## Outputs

- `<workspace_dir>/01_cad/geometry_after_power_filtered.step`
- `<workspace_dir>/01_cad/simulation_input.json`

This step does not write `cad_build_spec.power_filtered_layout.json`; downstream
after-state preparation derives its layout directly from `00_inputs/cad_build_spec.json`.
