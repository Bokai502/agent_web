---
name: 42-build-run-diagnose
description: Run a validated 42 configuration artifact bundle only to confirm that the configuration files are complete, parseable by 42, and able to compile and execute without load/runtime aborts; route configuration-format failures back to configuration authoring.
---

# 42 Build Run Diagnose

## Overview

Use this skill after `42-config-validator` passes. The goal is only to prove that the generated 42 configuration artifact bundle is complete enough, correctly formatted enough, and internally consistent enough for 42 to build, load, and execute.

This skill is a configuration parse/run smoke test. It does not judge GNC behavior, mission performance, pointing quality, mode correctness, control quality, or `CFS_FSW` behavior.

## When to Use

Use this skill only when a generated 42 configuration set has already passed structural validation and the user wants runtime confirmation that 42 can parse and execute the configuration files.

## Inputs

Required:

- validated workspace configuration artifact bundle
- `workspace_dir/AIGNC_Workflow/04_config/validation/config_validation_summary.json`

Optional:

- preferred run mode
- permission to rebuild 42 if needed

## Required Local Context

Read `skills/42-build-run-diagnose/references/repo-sources.md` first.

Workspace-local directory layout and writable-boundary rules are governed by `AGENT.md` at the current workspace root.

Load only the minimum repository context needed to execute the workspace configuration and interpret failures.

## Required Checklist

Complete these in order:

1. Confirm validator output allows runtime.
2. Decide whether existing build artifacts are usable or whether rebuild is needed.
3. Select the lowest-risk runtime mode for validation.
4. Run the workspace configuration.
5. Capture build failures, load/parser failures, runtime aborts, and basic output presence.
6. Classify only configuration-readiness failure or pass status.
7. Emit a bounded diagnosis and route.

## Output Contract

Produce:

- `workspace_dir/AIGNC_Workflow/08_run/run_report.md`
- `workspace_dir/AIGNC_Workflow/08_run/run_summary.json`

Write diagnosis artifacts under `workspace_dir/AIGNC_Workflow/08_run/`. Use the platform-neutral Python entrypoints `workspace_dir/00_inputs/Script/build_42.py --workspace-dir <workspace_dir> --headless` and `workspace_dir/00_inputs/Script/run_case.py --workspace-dir <workspace_dir> --headless` for command-line runtime validation; those scripts detect the current environment and select the correct executable name. The real simulator runtime directory is `workspace_dir/02_sim/42_run/runtime_case/InOut/`.

Build and runtime locations are version-workspace local:

- build working directory and Makefile: `workspace_dir/02_sim/42_run/`
- object files: `workspace_dir/02_sim/42_run/build/`
- executable: the platform-selected simulator binary under `workspace_dir/02_sim/42_run/`, resolved by the build/run scripts
- runtime workspace_dir: `workspace_dir/02_sim/42_run/runtime_case/`
- runtime `InOut`: `workspace_dir/02_sim/42_run/runtime_case/InOut/`

Do not compile from the workspace root, do not write objects under `42/Object/`, and do not place simulator executables at the workspace root.

Append step-level status entries to `workspace_dir/AIGNC_Workflow/workflow_log.md` when this skill starts, after validator-status confirmation, build artifact inspection, build decision, build result, runtime assembly check, run start, run completion or failure capture, output presence check, diagnosis artifact writing, and final route recommendation. Entries must use stage `08_run`, current skill `42-build-run-diagnose`, step id or step name, status, timestamp, concise description, key inputs checked, outputs updated, and next action or handoff target. Do not log private reasoning.
Structured progress must also be updated in `workspace_dir/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>_<skill_name>`, matching the numbered stage used for `workspace_dir/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the skill run.


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

If the configuration cannot load due to configuration problems, stop and route back to `42-config-author`.

If the workspace configuration builds, loads, runs to normal completion, and produces the expected basic output files, return `run_pass` even if the simulated behavior or mission performance is poor. Behavior and performance are outside this skill's scope and must not change the verdict.

## Self-Review

Before finishing, check:

1. Did I judge only build/load/parser/runtime-abort/output-presence readiness?
2. Did I avoid silently patching configuration files during diagnosis?
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

The terminal state is a configuration runtime-readiness verdict: either the workspace configuration builds/loads/runs and is marked `run_pass`, or it returns to configuration authoring for correction.
