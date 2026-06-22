---
name: cad-real-assembly-builder
description: "Build only the supplemental real assembly GLB from 00_inputs/cad_build_spec.json real_cad.step_path entries. Use when Codex needs geometry_after_real_cad.glb without building box or simulation inputs."
---

# CAD Real Assembly Builder

Build the real assembly model from the CAD-native spec.

## Command

```bash
python3 open_codex_web/backend/workflow_agents/agents/progress_cli.py \
  --workspace-dir <workspace_dir> \
  --role cad_real \
  --status running \
  --percentage 5 \
  --note "真实装配构建中"
cad_cli --json build real-assembly --workspace-dir <workspace_dir>
python3 open_codex_web/backend/workflow_agents/agents/progress_cli.py \
  --workspace-dir <workspace_dir> \
  --role cad_real \
  --status completed \
  --percentage 100 \
  --completed \
  --note "真实装配完成"
```

Defaults:

- Input: `<workspace_dir>/00_inputs/cad_build_spec.json`
- Output: `<workspace_dir>/01_cad/geometry_after_real_cad.glb`

## Rules

- This skill requires `00_inputs/cad_build_spec.json`.
- Use the installed `cad_cli`; implementation code lives under
  `open_codex_web/backend/workflow_agents/agents/cad_cli`.
- Use `progress_cli.py` before and after the CAD command when
  `progressRole: "cad_real"` exists as a `kind: "run"` node in
  `<workspace_dir>/00_inputs/workflow_diagram/executionFlowData.json`. If the
  current workflow has no real-assembly run node, skip progress updates for this
  supplemental step. Do not hand-edit progress JSON files.
- Progress is resolved by `progressRole`, not by hard-coded workflow node id.
- Use `components[].real_cad.step_path` when it exists and is readable.
- Fall back to the component box if the STEP path is missing or unreadable.
- This step is supplemental real assembly output; it must not create the simulation STEP.
- If FreeCAD RPC is unavailable, report the host/port connection failure.

## Output

- `<workspace_dir>/01_cad/geometry_after_real_cad.glb`

This step writes `geometry_after_real_cad.hybrid_summary.json` when the
hybrid-link exporter produces it.
