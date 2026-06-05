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
3. Mark progress as `config_editor_running` in `<workspace>/logs/progress.json`.
4. Read only the relevant files from `v0001/00_inputs` and the selected
   version's `logs`.
5. If component information must be queried or added beyond `real_bom.json`,
   review `references/热仿真数据库_headers.md`, then look it up in
   `references/热仿真数据库.json`.
6. Update only the configuration fields needed for the user's request.
7. Validate edited config syntax when possible.
8. Write the result to:

```text
<selected version workspace>/00_inputs/config_editor_output.md
```

9. Mark progress as `config_editor_completed` or `config_editor_failed`.

Use `templates/config_editor_report_template.md` for the output shape.

## Progress

Use the FreeCAD progress CLI to update `<workspace>/logs/progress.json` only.
Do not create or modify `<workspace>/logs/progress_percentages.json`.

Run progress commands from the FreeCAD skill directory:

```bash
cd /path/to/open_codex_web/backend/workflow_agents
```

Before editing config:

```bash
python -m freecad_cli_tools.cli.main progress update \
  --workspace-dir <selected version workspace> \
  --loop-name create_cad \
  --status config_editor_running \
  --completed false \
  --percentage 0
```

After success:

```bash
python -m freecad_cli_tools.cli.main progress update \
  --workspace-dir <selected version workspace> \
  --loop-name create_cad \
  --status config_editor_completed \
  --completed false \
  --percentage 50
```

After failure:

```bash
python -m freecad_cli_tools.cli.main progress update \
  --workspace-dir <selected version workspace> \
  --loop-name create_cad \
  --status config_editor_failed \
  --completed false \
  --percentage 50
```

The loop name must be `create_cad`. The `--completed` value must be exactly
`true` or `false`. Keep it `false` at 50 so the shared `create_cad` loop can
continue into the FreeCAD build stage.

## Rules

- Do not read every input or log file by default; follow the reference routing.
- When adding a new component, you must check `references/热仿真数据库.json`.
  If the component is not present in that database, do not add it. Also verify
  the component's mounting-face information and keep placement/topology
  consistent with that mounting face.
- For component overlap or geometry problems, make the smallest targeted
  change: modify only the component(s) identified as problematic by the
  request, config, or logs.
- Preserve unknown config fields and existing structure.
- If evidence is missing or conflicting, make the smallest reasonable change
  and record the assumption in `config_editor_output.md`.
- If config editing fails after the running progress update, write
  `config_editor_failed` at 50 with `--completed false`; do not mark the shared
  `create_cad` loop complete.
- Keep the final chat response brief: changed config file, output path, and
  validation result, plus the final `create_cad` progress status.
