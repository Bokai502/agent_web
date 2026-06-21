# Thermal Progress Updates

Thermal runtime progress is stored at:

```text
<workspace_dir>/logs/progress.json
```

Node-level display progress is stored on every node in:

```text
<workspace_dir>/00_inputs/workflow_diagram/executionFlowData.json
```

The loop keys must come from `kind: "run"` nodes in:

```text
<workspace_dir>/00_inputs/workflow_diagram/executionFlowData.json
```

Use the shared progress CLI. Do not hand-edit `logs/progress.json`.
The CLI also updates the matching `executionFlowData.json` node `progress`
field. Skills and shell commands should call this CLI instead of editing either
progress file directly.

Initialize all run-node loops:

```bash
python3 open_codex_web/backend/workflow_agents/agents/progress_cli.py \
  --workspace-dir <workspace_dir> \
  --init
```

Update one run node:

```bash
python3 open_codex_web/backend/workflow_agents/agents/progress_cli.py \
  --workspace-dir <workspace_dir> \
  --node-id <run_node_id> \
  --status running \
  --percentage <0-100> \
  --note "<short display note>"
```

Complete one run node:

```bash
python3 open_codex_web/backend/workflow_agents/agents/progress_cli.py \
  --workspace-dir <workspace_dir> \
  --node-id <run_node_id> \
  --status completed \
  --percentage 100 \
  --completed \
  --note "<short display note>"
```

If `executionFlowData.json` does not exist yet, the frontend shows the task as
planning. Generate the workflow diagram before initializing or updating progress.
