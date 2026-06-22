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
python scripts/write_execution_flow.py --workspace-dir <workspace_dir>
```

Before running the command, write the run-specific draft JSON directly to:

`<workspace_dir>/00_inputs/workflow_diagram/executionFlowData.json`

The script reads that file as the draft, normalizes it, validates it, and writes
the normalized result back to the same path.

## Defaults

- Draft source and output:
  `<workspace_dir>/00_inputs/workflow_diagram/executionFlowData.json`
- The fallback template is for schema/reference only. Do not pass
  `assets/thermal_execution_flow_template.json` as `--draft-json` for normal
  workflow runs.
- `--draft-json` and `--stdin` remain available only for repair/debug
  workflows. Normal workflow runs must not place drafts in `/tmp` or other
  external paths.

## Draft Semantics

Generate the draft from the actual planned workflow. Do not blindly use the
fallback template when the plan differs.

The script will normalize partial drafts. A minimal valid draft can contain only
`nodes`; missing `kind`, `output`, `summary`, `items`, `connections`, and
invalid `defaultActiveId` values are normalized before writing.
Every node is written with `progress: 0`. Only `kind: "run"` node ids are used
as loop keys in `<workspace>/logs/progress.json`. Runtime updates must use the
shared progress CLI so the loop entry and matching node `progress` stay in sync.

Run nodes that are updated by specialist skills must include a stable
`progressRole` field. `id` is only a frontend graph identifier and may be
changed to fit the current workflow. Runtime skills must update progress by
role, not by hard-coded node id.

Standard thermal progress roles:

- `cad_box`: placeholder/display CAD build.
- `cad_real`: supplemental real assembly build.
- `cad_sim_input`: simulation geometry/input preparation.
- `simulation`: thermal simulation and postprocess run.

## Rules

- Resolve the selected workspace/version from execution context.
- Generate diagram semantics in this skill; use the script only for validation,
  normalization, and writing.
- Create `00_inputs/workflow_diagram/` when missing.
- Preserve the frontend schema: top-level `defaultActiveId`, `nodes`, and
  `connections`.
- Keep node `kind` values within `plan`, `run`, `analyze`, `output`.
- Add `progressRole` to every `kind: "run"` node that a runtime skill will
  update. Keep each `progressRole` unique within the flow.
- After writing `executionFlowData.json`, initialize run-node progress with:
  `python3 open_codex_web/backend/workflow_agents/agents/progress_cli.py --workspace-dir <workspace_dir> --init`.
- Do not edit node `progress` manually after initialization; use the progress
  CLI for each `kind: "run"` node update.
- Keep each node `summary` within 10 Chinese characters, and each `items`
  entry within 5 Chinese characters.
- Use `--default-active-id <id>` only when a different active stage is needed.
- Report the written path and selected node IDs in chat.
