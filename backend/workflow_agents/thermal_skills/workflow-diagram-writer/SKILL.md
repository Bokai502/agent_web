---
name: workflow-diagram-writer
description: "Write the frontend execution flow JSON for thermal CAD/simulation workspaces. Use after planner creates or updates a thermal workflow plan, or when the user asks to generate, refresh, or repair 00_inputs/workflow_diagram/executionFlowData.json."
---

# Workflow Diagram Writer

Write the execution-flow diagram consumed by the frontend `ExecutionFlow`
component.

This skill owns the diagram semantics. Convert the current execution plan,
workspace state, and user goal into a fixed-format JSON file. Do not run helper
scripts or generate runner code for this skill.

This skill may write only:

`00_inputs/workflow_diagram/executionFlowData.json`

It must not edit `cad_build_spec.json`, run CAD builders, run simulation, or
write final report artifacts.

## Output Path

Create the directory when missing and write:

`<workspace_dir>/00_inputs/workflow_diagram/executionFlowData.json`

## JSON Format

The file must be one JSON object with exactly these top-level fields:

```json
{
  "defaultActiveId": "plan",
  "nodes": [],
  "connections": []
}
```

Each node object must use this shape:

```json
{
  "id": "cad_box",
  "title": "CAD箱体",
  "kind": "run",
  "output": "AI",
  "summary": "箱体建模",
  "items": ["读取规格", "生成模型"],
  "progress": 0,
  "progressRole": "cad_box"
}
```

Required node fields:

- `id`: stable ASCII identifier, unique within `nodes`.
- `title`: short display label.
- `kind`: one of `plan`, `run`, `analyze`, `output`.
- `output`: short source/output label such as `INPUT`, `AI`, `CAD`, `SIM`, or
  `REPORT`.
- `summary`: short Chinese summary, ideally within 10 Chinese characters.
- `items`: list of short Chinese labels, each ideally within 5 Chinese
  characters.
- `progress`: number. Use `0` when writing or refreshing the diagram.

Optional node field:

- `progressRole`: required for every `kind: "run"` node that a runtime skill
  updates.

Each connection object must use this shape:

```json
{ "from": "plan", "to": "cad_box" }
```

`from` and `to` must reference existing node ids. If the workflow is linear,
connect each node to the next node in order.

## Progress Roles

Use these standard thermal progress roles when the corresponding run node
exists:

- `cad_box`: placeholder/display CAD build.
- `cad_real`: supplemental real assembly build.
- `cad_sim_input`: simulation geometry/input preparation.
- `simulation`: thermal simulation and postprocess run.
- `cad_validate`: CAD output validation.

Keep each `progressRole` unique.

## Rules

- Resolve the selected workspace/version from execution context.
- Generate the JSON directly. Do not call `write_execution_flow.py`, generate a
  Python runner, import helper packages, or use `/tmp` draft files.
- Preserve the frontend schema: top-level `defaultActiveId`, `nodes`, and
  `connections`.
- `defaultActiveId` must match an existing node id.
- Keep node ids stable and ASCII-friendly: lowercase letters, numbers, and
  underscores.
- Use `progress: 0` for every node when writing or refreshing the diagram.
- Do not hand-edit `logs/progress.json`.
- After writing `executionFlowData.json`, initialize run-node progress with the
  shared progress CLI:

```bash
python3 <repo_root>/agent-web/backend/workflow_agents/agents/progress_cli.py --workspace-dir <workspace_dir> --init
```

- Runtime skills must update progress by `progressRole`, not hard-coded node id.
- Report the written path and selected node ids in chat.
