---
name: cad-box-builder
description: "Build only the placeholder box GLB from 00_inputs/cad_build_spec.json through FreeCAD RPC. Use when Codex needs geometry_after.glb without building real assemblies or simulation inputs."
---

# CAD Box Builder

Build the placeholder box model from the CAD-native spec.

## Command

```bash
cad_cli --json build box --workspace-dir <workspace_dir>
```

Defaults:

- Input: `<workspace_dir>/00_inputs/cad_build_spec.json`
- Output: `<workspace_dir>/01_cad/geometry_after.glb`

## Rules

- This skill requires `00_inputs/cad_build_spec.json`.
- Use the installed `cad_cli`; implementation code lives under
  `open_codex_web/backend/workflow_agents/agents/cad_cli`.
- This step exports only the placeholder box GLB.
- It must not export `geometry_after_power_filtered.step` or real-CAD outputs.
- If FreeCAD RPC is unavailable, report the host/port connection failure.

## Output

- `<workspace_dir>/01_cad/geometry_after.glb`
