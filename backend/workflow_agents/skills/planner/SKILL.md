---
name: planner
description: "Plan satellite thermal simulation config updates from workspace inputs and logs, then write planner_output.md explaining the changes."
---

# Planner

Use this skill for satellite thermal simulation configuration planning.

## Flow

1. Read `references/satellite-thermal-workspace.md`.
2. Resolve the workspace/version from `workspace_id`, `version_id`, and
   `workspace_dir`.
3. Read only the relevant files from `v0001/00_inputs` and the selected
   version's `logs`.
4. If component information must be queried or added beyond `real_bom.json`,
   review `references/热仿真数据库_headers.md`, then look it up in
   `references/热仿真数据库.json`.
5. Update only the configuration fields needed for the user's request.
6. Validate edited config syntax when possible.
7. Write the result to:

```text
<selected version workspace>/00_inputs/planner_output.md
```

Use `templates/planner_report_template.md` for the output shape.

## Rules

- Do not read every input or log file by default; follow the reference routing.
- When adding a new component, you must check `references/热仿真数据库.json`.
  If the component is not present in that database, do not add it.
- Preserve unknown config fields and existing structure.
- If evidence is missing or conflicting, make the smallest reasonable change
  and record the assumption in `planner_output.md`.
- Keep the final chat response brief: changed config file, output path, and
  validation result.
