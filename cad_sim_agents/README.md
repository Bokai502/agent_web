# cad-sim-pipeline

`cad-sim-pipeline` is the durable CLI for the local BOM external tools pipeline. It wraps the `cad_sim_agents` Python package and keeps the old `run_pipeline.sh` defaults available from any working directory.

## Install

```bash
cd /data/lbk/codex_web/open_codex_web/cad_sim_agents
make install-local
```

This installs `cad-sim-pipeline` to `~/.local/bin`. Make sure that directory is on `PATH`.

## Commands

```bash
cad-sim-pipeline --json doctor
cad-sim-pipeline --json steps list
cad-sim-pipeline run --simulation-backend mock_contract --skip-postprocess
WORKSPACE_DIR=/data/lbk/codex_web/FreeCAD_data/v7_data cad-sim-pipeline step geometry-edit
cad-sim-pipeline load-simulation-tools --workspace-dir /data/lbk/codex_web/FreeCAD_data/v7_data
cad-sim-pipeline raw simulation --simulation-backend mock_contract
```

The legacy script remains valid:

```bash
cad_sim_agents/run_pipeline.sh
cad_sim_agents/run_pipeline.sh geometry-edit
cad_sim_agents/run_pipeline.sh --simulation-backend mock_contract --skip-postprocess
```

## Workspace Defaults

The pipeline workspace directory is the same path selected in the frontend workspace switcher and used by the FreeCAD skill:

1. Explicit CLI `--workspace-dir /path/to/workspace`.
2. `WORKSPACE_DIR=/path/to/workspace`.
3. `/data/lbk/codex_web/open_codex_web/config.json` workspace setting, normally `freecad.workspaceDir`.
4. The v7 data default.

Other CLI defaults read these environment variables before falling back to local defaults:

- `BOM_JSON`
- `SIMULATION_BACKEND`
- `SAMPLE_ID`
- `SEED`
- `CLEARANCE_MM`
- `MULTISTART`
- `TARGET_FILL_RATIO`
- `CONNECT_EXISTING_MPHSERVER`

`--connect-existing-mphserver` is ignored unless `CONNECT_EXISTING_MPHSERVER=1`, preserving the previous safe default where `comsol_local` starts and manages its own mphserver.

## JSON Policy

Pipeline run commands emit the existing pipeline manifest JSON to stdout. `doctor` and discovery commands return a CLI envelope:

```json
{
  "ok": true,
  "tool": "cad-sim-pipeline",
  "steps": ["layout-generate"]
}
```

Errors return a nonzero exit code and diagnostics on stderr. The CLI does not print API keys or tokens; local pipeline commands do not require auth.
