---
name: simulation-skill
description: "Run or debug thermal simulation for CAD/spacecraft models. Use for requests about heat/thermal simulation, COMSOL runs, sim_run.py, simulation progress/status, 02_sim outputs, ParaView postprocess artifacts, or analysis results after CAD geometry is available."
---

# Simulation Skill

Use this skill for model thermal simulation work driven by:

```bash
python -m sim_cli_tools.cli.main
```

The tool reads an existing workspace with `00_inputs` and `01_cad`, then writes simulation through analysis outputs under `02_sim`. During `simulation_run`, `sim-run` runs an internal watcher that syncs live COMSOL progress into `<workspace>/logs/progress.json`. Use `sim-comsol-progress` to inspect or manually resync COMSOL progress.

## Core Rules

- Use `python -m sim_cli_tools.cli.main` as the first-class simulation entry point. The installed `sim-run` wrapper is an alias for the same module. Use `sim-comsol-progress` for COMSOL progress inspection or manual resync. Do not call copied runtime modules directly unless debugging internals.
- Open Codex Web injects the bundled simulation CLI source directory into `PYTHONPATH` for agent runs. If `ModuleNotFoundError: sim_cli_tools` appears, verify `PYTHONPATH` includes `open_codex_web/backend/workflow_agents/agents/sim_cli_tools/src` before falling back to global installs or copied runtime modules.
- Resolve the workspace from the Open Codex Web execution context `workspace_dir`. Workspace/version selection is request-scoped; `/api/run`, checkout, and branch do not update `project root config.json`.
- Always pass the execution context workspace explicitly with `--workspace-dir <workspace_dir>` for `doctor` and `run`. Do not rely on `config.json`, process `cwd`, or CLI defaults.
- Before running `run`, inspect the selected workspace by running `--json doctor --workspace-dir <workspace_dir>`. If the reported `workspace_dir` differs from the prompt `workspace_dir`, stop and report the mismatch instead of running simulation into the wrong workspace.
- Required inputs live under:
  - `<workspace>/00_inputs/cad_build_spec.json`
  - `<workspace>/01_cad/geometry_after_power_filtered.step`
  - after-state geometry/layout JSON files derived from the CAD-native spec
  - `<workspace>/01_cad/geometry_after_registry.json`
  - `<workspace>/01_cad/simulation_input.json`
  - `<workspace>/01_cad/comsol_inputs/coord.txt`
  - `<workspace>/01_cad/comsol_inputs/channels_input.npz`
- The `02_sim` geometry input is `01_cad/geometry_after_power_filtered.step`
  when present. `01_cad/geometry_after.glb` and
  `01_cad/geometry_after_real_cad.glb` remain display/review artifacts.
- Real COMSOL runs always start a private mphserver. Reusing an existing mphserver is not supported by this tool.
- Use `comsol_local` for real thermal simulation.
- Do not delete or recreate the workspace unless the user explicitly asks.

## Commands

Show help:

```bash
python -m sim_cli_tools.cli.main --help
python -m sim_cli_tools.cli.main run --help
sim-comsol-progress --help
```

Check whether inputs are complete:

```bash
python -m sim_cli_tools.cli.main \
  --json doctor \
  --workspace-dir <workspace_dir>
```

Real local COMSOL run:

```bash
python -m sim_cli_tools.cli.main \
  --json run \
  --workspace-dir <workspace_dir> \
  --simulation-backend comsol_local \
  --mph-port 32036 \
  --force \
  --quiet
```

## Outputs To Inspect

After a run, inspect:

- `<workspace>/logs/pipeline.log`
- `<workspace>/logs/simulation_run_stage_result.json`
- `<workspace>/02_sim/run_manifest.json`
- `<workspace>/02_sim/simulation/status.json`
- `<workspace>/02_sim/simulation/simulation_manifest.json`
- `<workspace>/02_sim/simulation/data1.txt`
- `<workspace>/02_sim/simulation/native.vtu`
- `<workspace>/02_sim/simulation/component_face_temperature.json`
- `<workspace>/02_sim/simulation/interface_temperature_diagnostics.json`
- `<workspace>/02_sim/postprocess/temperature_field_threejs.json`
- `<workspace>/02_sim/postprocess/temperature_surface_threejs.json`
- `<workspace>/02_sim/postprocess/render_summary.json`
- `<workspace>/02_sim/case_build/component_index.json`
- `<workspace>/02_sim/analysis/metrics_summary.json`

`temperature_surface_threejs.json` is the standard 3D Thermal preview input. The
`field_export` stage derives it from `<workspace>/02_sim/simulation/native.vtu`
as indexed triangle `THREE.BufferGeometry` data with per-vertex temperature
colors.

For real COMSOL progress during simulation, inspect the progress source of truth:

- `<workspace>/02_sim/simulation/_comsol_work/sim/comsol_progress.json`

This file contains `sample_id`, `stage`, `percent`, `ok`, `updated_at`, and
`heartbeat_at`. Use `<workspace>/02_sim/simulation/_comsol_work/sim/status.json`
for detailed COMSOL status and validation checks, not progress fallback. Or run:

```bash
sim-comsol-progress \
  --workspace-dir <workspace_dir>
```

Manually resync COMSOL progress into workspace progress when recovering or
debugging a run whose `sim-run` parent process is no longer alive:

```bash
sim-comsol-progress \
  --workspace-dir <workspace_dir> \
  --sync-progress
```

## Progress Semantics

- The simulation CLI no longer writes `<workspace>/logs/progress_percentages.json`.
- `sim-run` is responsible for updating `<workspace>/logs/progress.json`.
  Do not write this JSON manually during a normal simulation run.
- During `simulation_run`, `sim-run` starts an internal COMSOL progress watcher
  around `SimulationStep.run()`. The watcher reads
  `<workspace>/02_sim/simulation/_comsol_work/sim/comsol_progress.json` and
  writes the mapped percentage to `<workspace>/logs/progress.json` about once
  per second while the parent `sim-run` process is alive.
- `sim-run` writes stage-specific running status values instead of plain
  `running`:
  - `simulation_running`
  - `field_export_running`
  - `postprocess_running`
  - `case_build_running`
  - `analysis_running`
- `sim-run` maps simulation stages into the single `simulation` loop percentage:
  - `simulation_run`: 0-70
  - `field_export`: 70-80
  - `postprocess`: 80-90
  - `case_build`: 90-96
  - `analysis`: 96-100
- Do not require `sim_run.py` or stage scripts to return a unified progress
  payload. Derive progress from the active stage, durable stage logs, and COMSOL
  progress files.
- For real COMSOL progress during `simulation_run`, `sim-run` reads
  `_comsol_work/sim/comsol_progress.json` and maps COMSOL's internal percent
  into the 0-70 range. Use `sim-comsol-progress --sync-progress` only for manual
  recovery when the parent `sim-run` process is gone or automatic sync did not
  run. Do not use `_comsol_work/sim/status.json` as a progress fallback.
- `heartbeat_at` in `_comsol_work/sim/comsol_progress.json` is used to decide
  whether the current `simulation_running` operation is alive. It is not written
  separately into `<workspace>/logs/progress.json`.
- When the full simulation workflow finishes, `sim-run` writes `completed: true`
  and `percentage: 100`; it uses `status: completed` for success and
  `status: failed` for a completed failed run.

## Triage

1. Run `doctor` first when inputs or workspace are uncertain.
2. If `doctor` reports missing files, stop and report the exact missing paths.
3. If a stale lock blocks a run, use `--force` only when the recorded PID is not alive.
4. If a real COMSOL run appears stuck, inspect `_comsol_work/sim/comsol_progress.json` first for `heartbeat_at`, `stage`, and `percent`; use `_comsol_work/sim/status.json` only for detailed status/checks before killing processes.
5. Check active processes with:

```bash
pgrep -af "sim_run.py|comsol_remote_entry.py|mphserver"
```

6. If `mph-port` is busy, keep the requested port unless the runtime chooses the next free private port automatically.
7. After any failed run, inspect `logs/pipeline.log` and `logs/simulation_run_stage_result.json` before rerunning.

## Expected Success Criteria

A successful full run has:

- `02_sim/run_manifest.json` with `ok: true`.
- `simulation_run`, `field_export`, `postprocess`, `case_build`, and `analysis` stages completed.
- For real COMSOL, `02_sim/simulation/status.json` has `ok: true` and real artifacts such as `data1.txt`, `native.vtu`, and `work.mph`.
