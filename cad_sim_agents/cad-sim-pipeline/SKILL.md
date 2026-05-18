---
name: cad-sim-pipeline
description: "Use for satellite thermal simulation modeling workflows that turn a spacecraft BOM into CAD geometry, COMSOL thermal simulation, ParaView visualization, analysis, and suggestions through the cad-sim-pipeline CLI; also use for resuming runs, debugging workspace artifacts, logs, progress, and the 8-stage CAD-to-simulation pipeline."
---

# CAD Simulation Pipeline

Use this skill for `cad-sim-pipeline`: run the full satellite thermal simulation pipeline, resume a stage, inspect `run_manifest.json`, debug pipeline logs/progress, or triage missing artifacts under the resolved pipeline workspace.

## Core Rule

- `cad-sim-pipeline` is the top-level entry for normal run, resume, doctor, step execution, manifest inspection, and progress/log triage.
- Start normal pipeline work by resolving the CLI, `workspace_dir`, BOM input, manifest state, and target stage.
- FreeCAD is the execution backend for `geometry-edit`. When the target stage is `geometry-edit`, load and follow the `freecad` skill for runtime config, workspace alignment, CAD command rules, STEP/GLB export behavior, and progress-log merge rules.
- Default to `comsol_local` for real satellite thermal runs. Use `mock_contract` only for fast smoke tests or contract checks.
- Do not delete/recreate the resolved workspace or skip prerequisite stages unless the user explicitly asks and existing artifacts prove it is safe.

## CLI

Use the installed CLI from any working directory:

```bash
command -v cad-sim-pipeline
cad-sim-pipeline --json doctor
cad-sim-pipeline --json steps list
```

If `cad-sim-pipeline` is missing, install it and then use the CLI:

```bash
cd /data/lbk/codex_web/open_codex_web/cad_sim_agents
make install-local
```

Primary commands:

```bash
cad-sim-pipeline run
cad-sim-pipeline step <stage-name>
cad-sim-pipeline load-simulation-tools --workspace-dir <workspace>
cad-sim-pipeline raw <legacy-command>
```

Valid stage names are `layout-generate`, `geometry-edit`, `simulation`, `field-export`, `postprocess`, `case-build`, `analysis`, and `suggestion`.

Use `--json` for discovery commands that Codex needs to parse. `doctor` reports defaults, environment-derived config, available steps. To inspect a specific workspace with `doctor`, set `WORKSPACE_DIR=/path/to/workspace`; `doctor` does not accept `--workspace-dir`.

The CLI reads `BOM_JSON`, `WORKSPACE_DIR`, `SIMULATION_BACKEND`, `SAMPLE_ID`, `SEED`, `CLEARANCE_MM`, `MULTISTART`, and `TARGET_FILL_RATIO`. Local pipeline commands do not require auth.

## Workspace And Inputs

Resolve `workspace_dir` before inspecting artifacts or running/resuming a command:

1. CLI `--workspace-dir /path/to/workspace`.
2. `WORKSPACE_DIR=/path/to/workspace`.
3. `/data/lbk/codex_web/open_codex_web/config.json`, normally `freecad.workspaceDir`.

Resolve BOM input independently:

1. CLI `--bom-json /path/to/real_bom.json`.
2. `BOM_JSON=/path/to/real_bom.json`.
3. CLI default only for local smoke/manual runs.

Never infer workspace or BOM paths from `cwd`, the repo root, the skill directory, or similarly named folders. If the user gives relative paths, expand them to absolute paths before checking artifacts or running commands. Inspect only the resolved workspace's `run_manifest.json`, `logs/progress_percentages.json`, and `logs/*.json` unless the user asks you to locate a different run.

For FreeCAD rebuilds inside `geometry-edit`, keep the FreeCAD workspace aligned with the resolved pipeline workspace unless the user explicitly asks to separate them. Before running or debugging `geometry-edit`, use the `freecad` skill to inspect FreeCAD runtime settings and apply its workflow rules; then execute the stage through `cad-sim-pipeline step geometry-edit` unless the user is asking for direct low-level CAD repair.

## Workflows

Default real run:

```bash
BOM_JSON=<real_bom.json> WORKSPACE_DIR=<workspace> SIMULATION_BACKEND=comsol_local cad-sim-pipeline run
```

Resume one stage:

```bash
WORKSPACE_DIR=<existing_workspace> cad-sim-pipeline step <stage-name>
```

Fast smoke test without COMSOL:

```bash
WORKSPACE_DIR=/tmp/bom_pipeline_smoke SIMULATION_BACKEND=mock_contract cad-sim-pipeline run
```

Stop after simulation for COMSOL or ParaView triage:

```bash
cad-sim-pipeline run --skip-postprocess
```

Use `--connect-existing-mphserver` only when `CONNECT_EXISTING_MPHSERVER=1` is set and a COMSOL mphserver is already known to be listening. Otherwise let `comsol_local` auto-start/manage mphserver.

## Stage Contract

1. `layout-generate`: needs BOM; writes `01_layout`, `logs/layout_generate_stage_result.json`, and `logs/layout_generate_raw_result.json`.
2. `geometry-edit`: needs completed `layout_generate` plus `logs/layout_generate_raw_result.json`; uses the `freecad` skill rules for CAD runtime/workspace/export behavior; writes `02_geometry_edit`, `freecad_skill_cli_result.json`, and after-state geometry artifacts.
3. `simulation`: needs completed `geometry_validate` plus `02_geometry_edit/geometry_after.step`, `geometry_after.geom.json`, `geometry_after.layout_topology.json`, `geometry_after_registry.json`, `simulation_input.json`, and `comsol_inputs/*`; writes `03_simulation`.
4. `field-export`: needs completed `simulation_run` plus `03_simulation/status.json`, `field_samples.json`, and `tensors.json`; writes `04_postprocess`.
5. `postprocess`: needs completed `field_export` plus `04_postprocess/field_stats.json`; writes render and visualization manifests.
6. `case-build`: needs completed `postprocess`; writes `05_case_build/component_index.json` and case artifacts.
7. `analysis`: needs completed `case_build`; writes `06_analysis` reports.
8. `suggestion`: needs completed `analysis` plus `05_case_build/component_index.json`; writes `07_suggestions`.

Successful single-step commands update `run_manifest.json` without dropping unrelated existing stages. If prerequisites are missing, the CLI exits with a message naming missing stages or files.

## Diagnosis

Triage in this order:

1. Ensure `cad-sim-pipeline` is available; install with `make install-local` if missing.
2. Resolve `workspace_dir` and BOM input.
3. Identify target: full run, resume, one stage, artifact inspection, or failure diagnosis.
4. Inspect `<workspace>/run_manifest.json` and `<workspace>/logs/*.json` when present.
5. Check prerequisites for the target stage.
6. Run the earliest missing or failed pipeline stage.
7. Use the `freecad` skill whenever the target or failure boundary is `geometry-edit` or CAD artifact generation.

Use the `freecad` skill or `freecad-runtime-config` only when one of these is true:

- The requested task is specifically low-level CAD geometry work.
- The target stage is `geometry-edit`.
- `geometry-edit` failed.
- `<workspace>/02_geometry_edit/freecad_skill_cli_result.json` reports a failed FreeCAD command.
- `geometry_after.step` or `geometry_after.glb` is missing after `geometry-edit`.
- FreeCAD RPC, workspace config, STEP/GLB export, safe move, component re-seat, or CAD progress logging is the explicit problem.

Common fixes:

- Missing `logs/layout_generate_raw_result.json`: rerun `layout-generate`.
- Missing `geometry_validate`: rerun `geometry-edit`.
- Missing after-state geometry artifacts: rerun `geometry-edit`.
- Missing `03_simulation/status.json`, `field_samples.json`, or `tensors.json`: rerun `simulation`.
- Missing `04_postprocess/field_stats.json`: rerun `field-export`.
- Missing `05_case_build/component_index.json`: rerun `case-build`.
- COMSOL `Connection refused` on port 2036: rerun without `--connect-existing-mphserver`, or start/verify mphserver first and set `CONNECT_EXISTING_MPHSERVER=1`.
