---
name: cad-box-builder
description: "Build only the placeholder box GLB from 00_inputs/cad_build_spec.json through FreeCAD RPC. Use when Codex needs geometry_after.glb without building real assemblies or simulation inputs."
---

# CAD Box Builder

Build the placeholder box model from the CAD-native spec.

## Command

```bash
python3 open_codex_web/backend/workflow_agents/agents/progress_cli.py \
  --workspace-dir <workspace_dir> \
  --role cad_box \
  --status running \
  --percentage 5 \
  --note "占位CAD构建中"
cad_cli --json build box --workspace-dir <workspace_dir>
python3 open_codex_web/backend/workflow_agents/agents/progress_cli.py \
  --workspace-dir <workspace_dir> \
  --role cad_box \
  --status completed \
  --percentage 100 \
  --completed \
  --note "占位CAD完成"
```

Defaults:

- Input: `<workspace_dir>/00_inputs/cad_build_spec.json`
- Output: `<workspace_dir>/01_cad/geometry_after.glb`

## Rules

- This skill requires `00_inputs/cad_build_spec.json`.
- Use the installed `cad_cli`; implementation code lives under
  `open_codex_web/backend/workflow_agents/agents/cad_cli`.
- Use `progress_cli.py` before and after the CAD command. Do not hand-edit
  `<workspace_dir>/logs/progress.json` or workflow node `progress` fields.
- Progress is resolved by `progressRole`, not by hard-coded workflow node id.
- This step exports only the placeholder box GLB.
- It must not export `geometry_after_power_filtered.step` or real-CAD outputs.
- If FreeCAD RPC is unavailable, report the host/port connection failure.

## Output

- `<workspace_dir>/01_cad/geometry_after.glb`
