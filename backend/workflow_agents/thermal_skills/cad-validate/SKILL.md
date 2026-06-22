---
name: cad-validate
description: "Validate CAD-native spec outputs in 01_cad after split CAD build steps. Use to check geometry_after.glb, geometry_after_power_filtered.step, geometry_after_real_cad.glb, simulation_input.json, screenshots, and CAD geometry constraints without invoking the legacy cad validate workflow."
---

# CAD Validate

Validate outputs produced from `cad_build_spec.json`.

## Command

```bash
python scripts/validate_spec_outputs.py --workspace-dir <workspace_dir>
```

Defaults:

- Input: `<workspace_dir>/00_inputs/cad_build_spec.json`
- Output report: stdout. Use `--report-path <path>` to persist the JSON report.

## Rules

- Treat missing/empty required files as hard failures.
- Treat bbox overlap, mount contact, and face occupancy as warnings.
- Use `success: true` when hard failures are absent, even if warnings exist.

## Required Files

- `01_cad/geometry_after.glb`
- `01_cad/geometry_after_power_filtered.step`
- `01_cad/geometry_after_real_cad.glb`
- `01_cad/simulation_input.json`
