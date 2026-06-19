---
name: config-editor
description: "Edit satellite thermal simulation configuration from workspace inputs and logs, then write config_editor_output.md explaining the changes."
---

# Config Editor

Use this skill for satellite thermal simulation configuration edits.

## Flow

1. Read `references/satellite-thermal-workspace.md`.
2. Resolve the workspace/version from `workspace_id`, `version_id`, and
   `workspace_dir`.
3. Let the managed runner own progress updates.
4. Read only `cad_build_spec.json` from the selected version's `00_inputs` and
   relevant files from the selected version's `logs`.
5. If component information must be queried or added beyond `cad_build_spec.json`,
   review `references/热仿真数据库_headers.md`, then look it up in
   `references/热仿真数据库.json`.
6. Update only the configuration fields needed for the user's request.
7. Validate edited config syntax when possible.
8. Write the result to:

```text
<selected version workspace>/00_inputs/config_editor_output.md
```

9. Report success or failure in chat and in `config_editor_output.md`.

Use `templates/config_editor_report_template.md` for the output shape.

## Progress

The managed runner or orchestration layer owns progress tracking. This skill's
durable output is `00_inputs/config_editor_output.md` plus any targeted edits
to `00_inputs/cad_build_spec.json`.

## Rules

- Do not read every input or log file by default; follow the reference routing.
- When adding a new component, you must check `references/热仿真数据库.json`.
  If the component is not present in that database, do not add it. Also verify
  the component's mounting-face information and keep placement/topology
  consistent with that mounting face.
- For every component included in simulation, set
  `thermal.contact_resistance` to `0.001`. Do not introduce mixed contact
  resistance values such as `0.15`, because the COMSOL thermal-contact builder
  expects a single shared `PairThermalContact` resistance across component
  contact pairs.
- When adding or moving a component, edit only `00_inputs/cad_build_spec.json`.
  Keep each component's `mount`, `position`, `dims`, `bbox`, `rotation_rows`,
  `thermal`, `color`, `display_name`, and `real_cad.step_path` fields
  consistent. The `bbox` must describe the final world-coordinate occupied
  volume after the component local face is rotated onto the target face. Do not
  write an unrotated bbox for a rotated mounting relation. For `*_inner` target
  faces, expand the component volume toward the cabin interior; for `*_outer`
  faces, expand away from the cabin/body. Record this assumption in
  `config_editor_output.md` when the database mounting face and requested target
  face require rotation.
- For component overlap or geometry problems, make the smallest targeted
  change: modify only the component(s) identified as problematic by the
  request, config, or logs.
- Preserve unknown config fields and existing structure.
- If evidence is missing or conflicting, make the smallest reasonable change
  and record the assumption in `config_editor_output.md`.
- If config editing fails, do not partially rewrite unrelated input files.
  Report the failure and write `config_editor_output.md` only when it can
  accurately describe what happened.
- Keep the final chat response brief: changed config file, output path, and
  validation result.
