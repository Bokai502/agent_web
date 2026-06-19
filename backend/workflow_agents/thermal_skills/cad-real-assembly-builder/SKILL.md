---
name: cad-real-assembly-builder
description: "Build only the supplemental real assembly GLB from 00_inputs/cad_build_spec.json real_cad.step_path entries. Use when Codex needs geometry_after_real_cad.glb without building box or simulation inputs."
---

# CAD Real Assembly Builder

Build the real assembly model from the CAD-native spec.

## Command

```bash
cad_cli --json build real-assembly --workspace-dir <workspace_dir>
```

Defaults:

- Input: `<workspace_dir>/00_inputs/cad_build_spec.json`
- Output: `<workspace_dir>/01_cad/geometry_after_real_cad.glb`

## Rules

- This skill requires `00_inputs/cad_build_spec.json`.
- Use the installed `cad_cli`; implementation code lives under
  `open_codex_web/backend/workflow_agents/agents/cad_cli`.
- Use `components[].real_cad.step_path` when it exists and is readable.
- Fall back to the component box if the STEP path is missing or unreadable.
- This step is supplemental real assembly output; it must not create the simulation STEP.
- If FreeCAD RPC is unavailable, report the host/port connection failure.

## Output

- `<workspace_dir>/01_cad/geometry_after_real_cad.glb`

This step writes `geometry_after_real_cad.hybrid_summary.json` when the
hybrid-link exporter produces it.
