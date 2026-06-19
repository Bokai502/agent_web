---
name: workflow-diagram-writer
description: "Write the frontend execution flow JSON for thermal CAD/simulation workspaces. Use after planner creates or updates a thermal workflow plan, or when the user asks to generate, refresh, or repair 00_inputs/workflow_diagram/executionFlowData.json."
---

# Workflow Diagram Writer

Use this skill to write the execution-flow diagram consumed by the frontend
`ExecutionFlow` component.

This skill owns the diagram semantics. Convert the current execution plan,
workspace state, and user goal into frontend-friendly nodes, summaries, items,
and connections before calling the script.

This skill may write only:

`00_inputs/workflow_diagram/executionFlowData.json`

It must not edit `cad_build_spec.json`, run CAD builders, run simulation, or
write final report artifacts.

## Command

Run from this skill directory:

```bash
python scripts/write_execution_flow.py --workspace-dir <workspace_dir> --draft-json <draft_json>
```

You may also pipe the draft JSON through stdin:

```bash
python scripts/write_execution_flow.py --workspace-dir <workspace_dir> --stdin < <draft_json>
```

## Defaults

- Draft source: `--draft-json` or `--stdin`.
- Fallback template when no draft is supplied:
  `assets/thermal_execution_flow_template.json`
- Output:
  `<workspace_dir>/00_inputs/workflow_diagram/executionFlowData.json`

## Draft Semantics

Generate the draft from the actual planned workflow. Do not blindly use the
fallback template when the plan differs.

The script will normalize partial drafts. A minimal valid draft can contain only
`nodes`; missing `kind`, `output`, `summary`, `items`, `connections`, and
invalid `defaultActiveId` values are normalized before writing.

## Rules

- Resolve the selected workspace/version from execution context.
- Generate diagram semantics in this skill; use the script only for validation,
  normalization, and writing.
- Create `00_inputs/workflow_diagram/` when missing.
- Preserve the frontend schema: top-level `defaultActiveId`, `nodes`, and
  `connections`.
- Keep node `kind` values within `plan`, `run`, `analyze`, `output`.
- Keep each node `summary` within 10 Chinese characters, and each `items`
  entry within 5 Chinese characters.
- Use `--default-active-id <id>` only when a different active stage is needed.
- Report the written path and selected node IDs in chat.
