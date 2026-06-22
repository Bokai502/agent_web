---
name: cad-sim-input-builder
description: "Build only the power-filtered thermal simulation STEP and simulation_input.json from 00_inputs/cad_build_spec.json. Use when Codex needs simulation inputs for 02_sim without rebuilding box or real assembly GLBs."
---

# CAD Sim Input Builder

Build the thermal simulation geometry from the CAD-native spec.

## Command

```bash
python3 open_codex_web/backend/workflow_agents/agents/progress_cli.py \
  --workspace-dir <workspace_dir> \
  --role cad_sim_input \
  --status running \
  --percentage 35 \
  --note "仿真输入构建中"
cad_cli --json build sim-input --workspace-dir <workspace_dir>
python3 open_codex_web/backend/workflow_agents/agents/progress_cli.py \
  --workspace-dir <workspace_dir> \
  --role cad_sim_input \
  --status running \
  --percentage 70 \
  --note "仿真输入STEP已生成"
cad_cli --json build after-state --workspace-dir <workspace_dir>
python3 open_codex_web/backend/workflow_agents/agents/progress_cli.py \
  --workspace-dir <workspace_dir> \
  --role cad_sim_input \
  --status completed \
  --percentage 100 \
  --completed \
  --note "仿真输入完成"
```

Defaults:

- Input: `<workspace_dir>/00_inputs/cad_build_spec.json`
- Outputs: `<workspace_dir>/01_cad/geometry_after_power_filtered.step`, `simulation_input.json`

## Rules

- This skill requires `00_inputs/cad_build_spec.json`.
- Use the installed `cad_cli`; implementation code lives under
  `open_codex_web/backend/workflow_agents/agents/cad_cli`.
- Use `progress_cli.py` before, between, and after the CAD commands. Do not
  hand-edit `<workspace_dir>/logs/progress.json` or workflow node `progress`
  fields.
- Progress is resolved by `progressRole: "cad_sim_input"`, not by hard-coded
  workflow node id. The actual node id may be `cad_sim_input`, `cad_sim`,
  `thermal_geometry`, or any other frontend-safe id.
- Include only components where `thermal.include_in_simulation == true`.
- Include walls in `simulation_input.json` metadata with `power_W = 0`.
- Do not export a GLB in this step.
- If FreeCAD RPC is unavailable, report the host/port connection failure.

## Outputs

- `<workspace_dir>/01_cad/geometry_after_power_filtered.step`
- `<workspace_dir>/01_cad/simulation_input.json`

This step does not write `cad_build_spec.power_filtered_layout.json`; downstream
after-state preparation derives its layout directly from `00_inputs/cad_build_spec.json`.
