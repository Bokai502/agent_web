# 42 Build Run Diagnose Skill Spec

## Purpose

`42-build-run-diagnose` is the configuration runtime-readiness smoke test for the configuration-only chain.

It answers:

> Can the generated 42 workspace files be compiled, loaded, parsed, and executed by 42 without configuration-format or immediate runtime aborts?

This skill is configuration-focused. It is not a mission-level control diagnosis stage, does not inspect FSW behavior, and does not judge performance. Runtime plots are optional auxiliary evidence, not pass/fail criteria.

## Position in Workflow

```text
aignc-42-orchestrator
 -> aignc-scenario-brainstorm
 -> 42-capability-auditor
 -> 42-config-author
 -> 42-config-validator
 -> 42-build-run-diagnose
```

## Inputs

Required:

- validated `<workspace>/00_inputs/Config/` package or validated `<workspace>/AIGNC_Workflow/04_config/` package
- `config_validation_summary.json`

Optional:

- compile target if rebuild is required
- runtime mode preference such as GUI off for batch validation

## Core Responsibilities

1. Decide whether the existing 42 executable is sufficient or whether rebuild is required.
2. Run the generated case in the least risky validation mode.
3. Capture:
   - load failures
   - missing-file failures
   - parser failures
   - immediate runtime aborts
   - existence of expected output files
4. Separate configuration load/parser failures from non-configuration concerns.
5. Return pass as soon as the workspace package builds, loads, runs to normal completion, and expected basic outputs exist.
6. Produce a bounded diagnosis report.

## Evidence Freshness

This stage must not diagnose from stale logs or stale reports.

Before citing `run_stdout.log`, `run_stderr.log`, `run_report.md`, `run_summary.json`, or existing `.42`/CSV outputs, compare their mtimes against the active source configuration in `<workspace>/00_inputs/Config/`.

The active config freshness set includes:

- `<workspace>/00_inputs/Config/Inp_Sim.txt`
- orbit files referenced by `Inp_Sim.txt`
- spacecraft files referenced by `Inp_Sim.txt`

Also compare the matching runtime files under `<workspace>/02_sim/42_run/runtime_case/InOut/`.

If existing logs or reports are older than the newest active config, they are stale and must not be used as the latest run verdict. If source config is newer than runtime `InOut`, the latest execution did not produce a trustworthy 42 load/run result; classify it as an executor/workflow interruption or stale-evidence condition until `run_case.py` performs a fresh copy and a new 42 process writes fresh logs.

Route to `42-config-author` only when fresh logs from the current runtime copy prove a configuration parser/load failure. Do not route to `42-config-author` merely because an older report contains a previous `Bogus input` failure.

## Explicit Non-Goals

Do not:

- redesign the case automatically
- tune `CFS_FSW`
- route behavior or performance concerns to `fsw-tuning-reviewer` from this stage
- judge pointing quality, control quality, mode correctness, or mission performance
- declare mission success from mere runtime pass

## Output Contract

Produce:

- `run_report.md`
- `run_summary.json`

Use the deterministic template:

- `open_codex_web/backend/workflow_agents/gnc_skills/skills/42-build-run-diagnose/references/run_summary_template.json`

Every `run_summary.json` must keep the template shape. Fill unavailable or unevaluated values with `null`, empty strings, or empty arrays rather than omitting keys.

Mode transitions must be written in the form consumed by the current dashboard plotting code:

- `mode_result.transitions[]`: `time_s`, `mode_id`, `mode`

Metrics and acceptance items are task-specific arrays. Add only metrics and criteria that are actually defined or evaluated for the current task; do not copy mission-specific example names into unrelated cases.

Required summary fields:

- `schema_version`
- `status`: `run_pass`, `run_fail_config`, or `run_fail_runtime`
- `build_action_taken`
- `run_mode`
- `output_files_detected`
- `primary_failure_cause`
- `recommended_return_stage`
- `configuration_runtime_ready`
- `runtime_directory`
- `build_status`
- `load_parse_status`
- `normal_completion`
- `sim_duration_sec`
- `samples`
- `mode_telemetry_exported`
- `mode_result`
- `terminal_mode`
- `metrics`
- `acceptance`
- `limitations`

## Return Paths

- `run_pass` -> configuration runtime-readiness complete
- `run_fail_config` -> return to `42-config-author`
- `run_fail_runtime` -> return to `42-config-author` or human review depending on whether the failure is clearly caused by malformed configuration or by the simulator/build environment

## Knowledge Sources

Primary:

- generated workspace files
- `generated_config_manifest.json`
- `config_validation_summary.json`

Secondary:

- current build instructions in repository
- existing `InOut` patterns for batch execution

## Product Rationale

Without this stage, the workflow only proves that files were written. It does not prove that 42 can actually use them.
