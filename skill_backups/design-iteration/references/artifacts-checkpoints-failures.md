# Artifacts, Checkpoints, and Failures

Read this reference when registering outputs, recording checkpoints or scores,
marking runs completed/failed, or reporting failure evidence.

## Artifact Registration

Register artifacts using paths relative to the version workspace. To collect
standard outputs, prefer:

```text
POST /api/versions/:versionId/artifacts/register-existing
```

Common CAD artifacts:

```text
01_cad/geometry_after.step
01_cad/geometry_after.glb
01_cad/simulation_input.json
01_cad/cad_agent_output.json
logs/progress_percentages.json
```

Common simulation artifacts:

```text
02_sim/run_manifest.json
02_sim/simulation/status.json
02_sim/simulation/simulation_manifest.json
02_sim/simulation/native.vtu
02_sim/analysis/metrics_summary.json
02_sim/analysis/anomaly_candidates.json
02_sim/analysis/diagnosis.json
logs/progress_percentages.json
```

Register only artifacts that exist. If a required artifact is missing, mark the
run or checkpoint failed and explain the missing path.

Use relative artifact paths only. Do not register absolute paths or paths
containing `..`.

## Checkpoints

Register checkpoints at key boundaries:

- `draft_created`
- `cad_completed`
- `simulation_completed`
- `analysis_completed`
- `scoring_completed` when scoring exists

Checkpoint records should reference existing artifact IDs and state files. Use
`stateRefs` for low-level evidence:

```text
logs/progress_percentages.json
logs/*_stage_result.json
02_sim/run_state.json
02_sim/run_manifest.json
```

Do not put large file contents into checkpoint records.

Register successful checkpoints only after the referenced artifact IDs and
stateRefs exist. For partial success, use a failed or partial status with the
available evidence instead of a successful checkpoint.

## Scores

Use the score API when the workflow produces objective metrics or rankings.
Reference the artifact/checkpoint evidence that supports each score.

## Failure Handling

- If branch creation fails, stop and report the API error.
- If `freecad` fails, register a failed checkpoint if possible and mark the run
  failed.
- If `simulation-skill` doctor reports missing inputs, stop and report the exact
  missing paths.
- If simulation or analysis fails, preserve the version workspace and logs.
- Do not delete a failed version workspace.
- Do not register successful checkpoints for failed or incomplete stages.
- Mark the version failed only when the iteration branch itself should be
  considered failed. For a recoverable tool error, preserve the draft version and
  mark the run/checkpoint failed with logs.
