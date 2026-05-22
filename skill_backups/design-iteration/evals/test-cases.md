# Design Iteration Skill Test Cases

These cases validate the `design-iteration` skill behavior without adding test
content to the skill's default context. Use them for manual review or as source
material for an automated evaluator.

## Shared Mock Context

Unless a test overrides it, assume the prompt contains:

```text
session_id: sess_eval
thread_id: thread_eval
turn_id: turn_eval_001
workspace_id: ws_eval
version_id: v0003
workspace_dir: /data/lbk/codex_web/FreeCAD_data/workspaces/ws_eval/versions/v0003
```

The manifest API returns active version `v0003` with `workspaceDir` equal to the
prompt `workspace_dir`, previous versions `v0001` and `v0002`, and history for
CAD, simulation, artifacts, checkpoints, and scores.

## TC01 Intent Classification and Minimal Loading

**User request**

```text
看看这个工作区上一次仿真为什么失败，先不要修改任何文件。
```

**Capability tested**

Intent recognition, read-only behavior, and minimal reference loading.

**Expected reference use**

- Load `references/intent-and-planning.md`.
- Load `references/versioning-api.md` only for manifest/run details.
- Load `references/artifacts-checkpoints-failures.md` if interpreting failed
  checkpoint/run evidence.
- Do not load `device-db-to-00-inputs.md`.

**Expected behavior**

- Fetch or inspect manifest and recent runs/checkpoints/logs.
- Inspect relevant `02_sim/` and `logs/` files.
- Summarize likely failure cause with file/API evidence.
- Do not branch, create a run, edit files, register artifacts, or mark anything
  completed/failed.

**Pass criteria**

- The answer is read-only and evidence-based.
- No Versioning API write endpoints are used.
- The selected workspace remains `v0003`.

## TC02 Context Reading and History-Aware Planning

**User request**

```text
基于当前版本，找出 P015 附近的热问题，并计划下一步怎么优化，先给计划。
```

**Capability tested**

Workspace input/history intake and compact planning.

**Expected reference use**

- Load `references/intent-and-planning.md`.
- Load `references/versioning-api.md` for manifest/history.
- Do not load workflow or artifact references unless execution begins.

**Expected behavior**

- Inspect manifest active version and prior CAD/simulation artifacts.
- Read relevant `00_inputs`, `01_cad`, `02_sim/analysis`, and `logs` evidence.
- Produce a compact plan: intent, starting version/workspace, evidence found,
  branch strategy, skills to use, validation, and expected artifacts.
- State that branch/run creation should happen only when the user approves or
  asks to execute the optimization.

**Pass criteria**

- Plan references actual evidence paths.
- No branch is created because the user asked only for a plan.
- The plan names whether `freecad`, `simulation-skill`, or both are needed.

## TC03 Tracked CAD/Input Change Branching

**User request**

```text
把 P015 从当前热点附近移开 20mm，然后验证 CAD。
```

**Capability tested**

Branch-first versioning, stale workspace replacement, and FreeCAD coordination.

**Expected reference use**

- Load `references/intent-and-planning.md`.
- Load `references/versioning-api.md`.
- Load `references/iteration-workflows.md`.
- Load `references/artifacts-checkpoints-failures.md` when registering outputs
  or failures.

**Expected behavior**

- Fetch manifest and identify active `v0003`.
- Branch from `v0003`.
- Use the returned version, for example `v0004`, and returned
  `version.workspaceDir`; do not keep using the old `v0003` path.
- Create a run with `workspaceId`, `workspaceDir`, `baseVersionId`,
  `outputVersionId`, `versionId`, `turnId`, and `skillNames`.
- Use `freecad` with explicit `--workspace-dir <new_workspace_dir>`.
- Validate CAD and inspect `01_cad`/`logs`.

**Pass criteria**

- No manual copy/mkdir of version directories.
- All CLI commands target the new branch workspace.
- A successful CAD checkpoint is registered only if validation evidence exists.

## TC04 Full CAD-to-Simulation Iteration

**User request**

```text
创建一个新迭代：移动 P015 降低最高温度，完成 CAD 验证后跑热仿真并分析结果。
```

**Capability tested**

Full orchestration across `freecad`, `simulation-skill`, artifacts,
checkpoints, and run status.

**Expected reference use**

- Load `intent-and-planning.md`, `versioning-api.md`,
  `iteration-workflows.md`, and `artifacts-checkpoints-failures.md`.
- Do not load `device-db-to-00-inputs.md`.

**Expected behavior**

- Inspect current evidence and plan the iteration.
- Branch from active version and create a run.
- Execute CAD/layout change through `freecad`.
- Confirm `01_cad/simulation_input.json` exists before simulation.
- Run simulation doctor with explicit workspace.
- Run simulation/postprocess/analysis through `simulation-skill`.
- Register existing artifacts that exist.
- Register checkpoints at CAD, simulation, and analysis boundaries.
- Mark the run completed only after all expected stages succeed; otherwise mark
  the run/checkpoint failed and preserve logs.

**Pass criteria**

- Correct skill sequence: FreeCAD before simulation.
- Simulation does not run if doctor reports missing inputs.
- Successful final response cites key artifacts and metrics.

## TC05 Artifact and Checkpoint Failure Handling

**User request**

```text
这个仿真跑完后把产物注册一下，如果有缺失就说明哪里失败。
```

**Mock condition**

`02_sim/simulation/status.json` exists, but
`02_sim/analysis/metrics_summary.json` is missing.

**Capability tested**

Artifact registration integrity and failed/partial checkpoint handling.

**Expected reference use**

- Load `references/versioning-api.md`.
- Load `references/artifacts-checkpoints-failures.md`.
- Load `references/intent-and-planning.md` if needed to confirm task type.

**Expected behavior**

- Register only existing relative artifact paths.
- Do not register absolute paths or paths containing `..`.
- Do not create `analysis_completed` success checkpoint.
- Mark analysis checkpoint or run as failed/partial with the missing path.
- Preserve logs and workspace.

**Pass criteria**

- Missing `metrics_summary.json` is explicitly reported.
- Existing simulation artifacts can be registered.
- No false successful analysis checkpoint is created.

## TC06 Compare-Only Version Diff

**User request**

```text
比较 v0002 和 v0003 的差异，告诉我 CAD 和仿真结果有什么变化，不要新建版本。
```

**Capability tested**

Version comparison and no-branch behavior.

**Expected reference use**

- Load `references/intent-and-planning.md`.
- Load `references/versioning-api.md`.
- Load `references/iteration-workflows.md` only for compare-only guidance if
  needed.

**Expected behavior**

- Call or use `GET /api/versions/v0002/diff/v0003?workspaceId=ws_eval`.
- Inspect relevant changed artifacts from both versions.
- Summarize file-level and behavioral changes.
- Do not branch, checkout, create a run, edit files, or register new artifacts.

**Pass criteria**

- The response compares the requested versions, not just active version state.
- No write API endpoints are used.
- The active version is unchanged.

## TC07 Thermal Database Device Replacement

**User request**

```text
从热仿真数据库里选一个匹配的星敏感器，替换当前 P020，并更新 00_inputs。
```

**Capability tested**

Device database reference routing and structured `00_inputs` update rules.

**Expected reference use**

- Load `references/intent-and-planning.md`.
- Load `references/versioning-api.md`.
- Load `references/device-db-to-00-inputs.md`.
- Load `references/iteration-workflows.md` for validation after editing.

**Expected behavior**

- Branch from active version before editing.
- Read the database and identify candidate rows.
- If multiple materially different rows match, ask the user to choose before
  writing. If one exact row matches, proceed.
- Update only the branched workspace's:
  - `00_inputs/real_bom.json`
  - `00_inputs/geom.json`
  - `00_inputs/layout_topology.json`
- Preserve P020's component/geometry/thermal IDs and placement unless the user
  requested movement.
- Convert units, write `source_ref`, backup JSON files, and validate the three
  JSON files.
- Run the relevant FreeCAD validation path.

**Pass criteria**

- No edits are made to template/source workspaces.
- JSON is parsed and rewritten structurally.
- Replacement keeps P020 identity and placement unless explicitly changed.

## TC08 Retry and Recovery

**User request**

```text
上一个 run 因为 FreeCAD RPC 断开失败了，帮我重试，不要手动修 manifest。
```

**Capability tested**

Retry/recover routing and manifest safety.

**Expected reference use**

- Load `references/intent-and-planning.md`.
- Load `references/versioning-api.md`.
- Load `references/iteration-workflows.md`.
- Load `references/artifacts-checkpoints-failures.md` if recording failure or
  retry evidence.

**Expected behavior**

- Inspect manifest and identify the failed run.
- Use `POST /api/runs/:runId/retry` with locator body fields.
- Preserve the failed version workspace and logs.
- Do not edit `workspace_manifest.json` or run records manually.
- Resume the appropriate workflow in the selected/retry workspace, verifying
  `workspace_dir` before CLI execution.

**Pass criteria**

- Retry run records `retryOfRunId`.
- No manual manifest modification or version directory repair occurs.
- RPC failure is surfaced clearly if it persists.
