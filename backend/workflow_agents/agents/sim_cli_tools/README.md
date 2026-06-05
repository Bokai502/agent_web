# sim-run

CLI wrapper around a copied local `cad_sim_agents` runtime. It generates `02_sim` from an existing `00_inputs` directory and an existing `01_cad` after-state directory, then runs simulation through analysis with the copied runtime code.

Workspace resolution:

```bash
sim-run --workspace-dir <workspace_dir>
<workspace>/00_inputs
<workspace>/01_cad
```

In Open Codex Web, workspace/version selection is request-scoped. Use the
`workspace_dir` provided in the execution context and pass it explicitly with
`--workspace-dir`. Do not rely on the project root `config.json` defaults for
Web-triggered runs.

Install:

```bash
cd /path/to/open_codex_web/backend/workflow_agents/agents/sim_cli_tools
make install-local
```

Module entry point, matching the FreeCAD CLI style:

```bash
cd /path/to/open_codex_web/backend/workflow_agents/agents/sim_cli_tools
PYTHONPATH=src python -m sim_cli_tools.cli.main --help
PYTHONPATH=src python -m sim_cli_tools.cli.main --json doctor --workspace-dir <workspace_dir>
```

Check:

```bash
sim-run --json doctor --workspace-dir <workspace_dir>
```

Check only the `00_inputs` JSON files and report missing fields:

```bash
/data/conda/bin/python check_00_inputs.py --json --workspace-dir <workspace_dir>
```

Run with the default COMSOL backend:

```bash
sim-run --json run \
  --workspace-dir <workspace_dir> \
  --quiet
```

Fast contract run without COMSOL:

```bash
sim-run --json run \
  --workspace-dir <workspace_dir> \
  --simulation-backend mock_contract
```

The CLI does not call the older pipeline skill or CLI. It imports the copied runtime under `sim_cli_tools/runtime/codex_agents`, reads the source `00_inputs` and `01_cad` directories directly, then writes generated files under `02_sim`:

- `02_sim/components.json`
- `02_sim/sample.yaml`
- `02_sim/simulation`
- `02_sim/postprocess`
- `02_sim/case_build`
- `02_sim/analysis`

It does not create copied input stage directories such as `02_sim/00_inputs`, `02_sim/01_layout`, or `02_sim/02_geometry_edit`.

The run manifest is written to `02_sim/run_manifest.json`. Runtime logs and stage result logs are written to the workspace-level `logs` directory, for example `<workspace>/logs`, not `02_sim/logs`.
The CLI does not write `<workspace>/logs/progress_percentages.json`. During real
COMSOL runs, the progress source of truth is
`<workspace>/02_sim/simulation/_comsol_work/sim/comsol_progress.json`. That file
contains `sample_id`, `stage`, `percent`, `ok`, `updated_at`, and
`heartbeat_at`; `status.json` is for detailed COMSOL status and validation
checks, not progress fallback.

Resource controls:

- A single run lock is written to `02_sim/.run.lock`. A second run against the same output directory exits before starting COMSOL.
- If a previous process died and left a stale lock, rerun with `--force`; active PIDs are still blocked.
- COMSOL uses `--mph-port 32036` by default instead of the common `2036`. If that port is busy, the runtime chooses the next free port and starts a private mphserver for the run.
- In Open Codex Web/agent runs, pass `--async-open-tools` so COMSOL/ParaView
  GUI loaders start through the background/detached launcher flow after a
  successful simulation. Add `--no-open-tools` for headless runs. Omit
  `--async-open-tools` only for manual CLI runs that explicitly need to wait
  for launcher completion.
- COMSOL/ParaView GUI loading is managed by `external_tool_launchers.py`.
  Launcher paths and remote display settings come from the project root
  `config.json` fields `tools.comsol.*` and `tools.paraview.*`.

Example controlled COMSOL run:

```bash
sim-run --json run \
  --workspace-dir <workspace_dir> \
  --mph-port 32036 \
  --quiet \
  --async-open-tools
```

Read COMSOL progress without modifying any progress file:

```bash
sim-comsol-progress \
  --workspace-dir <workspace_dir>
```

`sim-run` owns `<workspace>/logs/progress.json` updates for the simulation loop.
It writes `simulation_running` at 0% when a run starts. During
`simulation_run`, it polls `comsol_progress.json` about once per second and maps
COMSOL's internal percent into the outer `simulation` loop's 0-70 range. Later
pipeline stages advance the same loop through field export, postprocess, case
build, and analysis, then write `completed` or `failed` at 100%.
