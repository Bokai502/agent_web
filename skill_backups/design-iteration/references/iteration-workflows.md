# Iteration Workflows

Read this reference when executing a tracked CAD, simulation, full-pipeline,
comparison, or retry workflow.

## Standard Tracked Flow

1. Interpret the goal and read the manifest.
2. Inspect relevant inputs, outputs, logs, and history.
3. Make a compact plan.
4. Branch from `activeVersionId`.
5. Use returned `version.workspaceDir` as `workspace_dir`.
6. Create a run.
7. Re-check that CLI/runtime config resolves to the same `workspace_dir`.
8. Execute the appropriate domain skill.
9. Verify outputs and inspect stage logs.
10. Register artifacts and checkpoints.
11. Mark the run completed or failed.
12. Commit or checkout only when requested or required by the workflow.

For adding or replacing devices from
`/data/wqn/cad2comsol2paraview/data/module_db/热仿真数据库.xlsx`, read
`device-db-to-00-inputs.md` before editing `00_inputs`.

## CAD and Layout

Use `freecad` for CAD creation, modification, movement, and validation. Pass the
version workspace explicitly:

```bash
python -m freecad_cli_tools.cli.main config show --workspace-dir <workspace_dir>
python -m freecad_cli_tools.cli.main cad build --workspace-dir <workspace_dir>
python -m freecad_cli_tools.cli.main cad validate --workspace-dir <workspace_dir>
python -m freecad_cli_tools.cli.main layout safe-move --workspace-dir <workspace_dir>
```

After FreeCAD execution, verify `01_cad` exists under `workspace_dir` and inspect
the relevant stage result/log files.

For input edits that affect CAD, validate the JSON inputs first, then run the
minimal FreeCAD build/validate path needed to prove the edited workspace is
usable. Do not register a successful CAD checkpoint until expected CAD artifacts
or validation evidence exist.

## Simulation and Analysis

Use `simulation-skill` for simulation doctor, run, postprocess, and analysis.
Start with doctor and verify it reports the selected version workspace:

```bash
/data/conda/bin/python /data/lbk/codex_web/freecad_skills/sim_skills/sim_cli_tools/sim_run.py \
  --json doctor \
  --workspace-dir <workspace_dir>
```

If doctor reports missing inputs, stop and report the exact missing paths. Do
not proceed to a simulation run with unresolved inputs.

Before a full simulation run, verify `01_cad/simulation_input.json` exists or
run the CAD step that produces it. After simulation, inspect status and analysis
JSON before summarizing results.

## Compare-Only Flow

Do not branch. Use the version diff API, inspect relevant artifacts from both
versions, and summarize behavioral or file-level differences.

## Retry/Recover Flow

Use run retry/cancel/fail APIs. Preserve failed workspaces and logs. Do not
repair version or run records by editing manifest files manually.
