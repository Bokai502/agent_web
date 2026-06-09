---
name: 42-build-run-diagnose
description: Run a validated 42 configuration package only to confirm that the workspace files are complete, parseable by 42, and able to compile and execute without load/runtime aborts; route configuration-format failures back to configuration authoring.
---

# 42 Build Run Diagnose

## Path Contract

- `<workspace>` means the backend-injected `workspace_dir`; this skill must use `workspace_dir` as the only source for the active working directory.
- Shared skills live under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/`.
- Shared knowledge lives under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/`.
- Shared 42, bridge, and reference resources live under `codex_web/AIGNC/42/`, `codex_web/AIGNC/bridge/`, and `codex_web/AIGNC/ref/`.


## Overview

Use this skill after `42-config-validator` passes. The goal is only to prove that the generated 42 configuration package is complete enough, correctly formatted enough, and internally consistent enough for 42 to build, load, and execute.

This skill is a configuration parse/run smoke test. It does not judge GNC behavior, mission performance, pointing quality, mode correctness, control quality, or `CFS_FSW` behavior.

## When to Use

Use this skill only when a generated 42 workspace package has already passed structural validation and the user wants runtime confirmation that 42 can parse and execute the configuration files.

## Inputs

Required:

- validated workspace package
- `<workspace>/AIGNC_Workflow/04_config/validation/config_validation_summary.json`

Optional:

- preferred run mode
- permission to rebuild 42 if needed

## Required Local Context

Read `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/42-build-run-diagnose/references/repo-sources.md` first.

Workspace-local layout and writable-boundary rules are governed by `codex_web/AIGNC/AGENT.md`.

Load only the minimum repository context needed to execute the case and interpret failures.

## Required Checklist

Complete these in order:

1. Confirm validator output allows runtime.
2. Decide whether existing build artifacts are usable or whether rebuild is needed.
3. Select the lowest-risk runtime mode for validation.
4. Run the case.
5. Capture build failures, load/parser failures, runtime aborts, and basic output presence.
6. Classify only configuration-readiness failure or pass status.
7. Emit a bounded diagnosis and route.

## Output Contract

Produce:

- `<workspace>/AIGNC_Workflow/08_run/run_report.md`
- `<workspace>/AIGNC_Workflow/08_run/run_summary.json`

Write diagnosis artifacts under `<workspace>/AIGNC_Workflow/08_run/`. Use the platform-neutral Python entrypoints `<workspace>/Script/build_42.py --headless` and `<workspace>/Script/run_case.py --headless` for command-line runtime validation; those scripts detect the current environment and select the correct executable name. The real simulator runtime directory is `<workspace>/Output/Run/runtime_case/InOut/`.

Build and runtime locations are mission-local:

- build working directory and Makefile: `<workspace>/Output/Run/`
- object files: `<workspace>/Output/Run/build/`
- executable: the platform-selected simulator binary under `<workspace>/Output/Run/`, resolved by the build/run scripts
- runtime workspace: `<workspace>/Output/Run/runtime_case/`
- runtime `InOut`: `<workspace>/Output/Run/runtime_case/InOut/`

Do not compile from the workspace root, do not write objects under `codex_web/AIGNC/42/Object/`, and do not place simulator executables at the workspace root.

Append step-level status entries to `<workspace>/AIGNC_Workflow/workflow_log.md` when this skill starts, after validator-status confirmation, build artifact inspection, build decision, build result, runtime assembly check, run start, run completion or failure capture, output presence check, diagnosis artifact writing, and final route recommendation. Entries must use stage `08_run`, current skill `42-build-run-diagnose`, step id or step name, status, timestamp, concise description, key inputs checked, outputs updated, and next action or handoff target. Do not log private reasoning.
Structured progress must also be updated in `<workspace>/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>_<skill_name>`, matching the numbered stage used for `<workspace>/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the skill run.


Runtime plots are not required for this skill. If plots already exist, they may be referenced as auxiliary evidence, but plot quality, trajectory quality, attitude behavior, wheel behavior, thruster behavior, and mode timelines are outside this stage's pass/fail criteria.

Required summary fields:

- `status`
- `build_action_taken`
- `run_mode`
- `output_files_detected`
- `primary_failure_cause`
- `recommended_return_stage`
- `configuration_runtime_ready`

Allowed status values:

- `run_pass`
- `run_fail_config`
- `run_fail_runtime`

## Stop Conditions

If the case cannot load due to configuration problems, stop and route back to `42-config-author`.

If the workspace package builds, loads, runs to normal completion, and produces the expected basic output files, return `run_pass` even if the simulated behavior or mission performance is poor. Behavior and performance are outside this skill's scope and must not change the verdict.

## Self-Review

Before finishing, check:

1. Did I judge only build/load/parser/runtime-abort/output-presence readiness?
2. Did I avoid silently patching workspace files during diagnosis?
3. Did I avoid routing behavior or performance concerns to `fsw-tuning-reviewer` from this stage?

## Boundaries

Do not:

- redesign the scenario
- retune control laws
- perform post-run FSW tuning review
- judge mission behavior, pointing quality, control quality, mode correctness, or performance
- claim mission success from mere runtime pass
- modify `CFS_FSW` source code in this stage

## Terminal State

The terminal state is a configuration runtime-readiness verdict: either the workspace package builds/loads/runs and is marked `run_pass`, or it returns to configuration authoring for correction.

