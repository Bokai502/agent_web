---
name: fsw-tuning-reviewer
description: Review implemented fixed CFS_FSW behavior after runtime execution, identify likely bug or tuning causes when mission-level performance is wrong, and return bounded debugging directions that feed the next fsw-code-author iteration. Use after 42-build-run-diagnose when code compiles and runs but metrics, mode timing, residuals, or stability are off.
---

# FSW Tuning Reviewer

## Path Contract

- `<workspace>` means the backend-injected `workspace_dir`; this skill must use `workspace_dir` as the only source for the active working directory.
- Shared skills live under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/`.
- Shared knowledge lives under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/`.
- Shared 42, bridge, and reference resources live under `codex_web/AIGNC/42/`, `codex_web/AIGNC/bridge/`, and `codex_web/AIGNC/ref/`.


## Overview

Use this skill after runtime evidence exists and the user needs debugging or tuning guidance rather than first-pass implementation. Its job is to inspect the implemented behavior against the expected behavior, separate likely logic bugs from likely tuning deficiencies, and route the next correction step cleanly.

This skill is a diagnosis and review stage inside the FSW implementation loop. It does not replace `42-build-run-diagnose`, and it does not silently rewrite architecture decisions.

Use `$42-runtime-plotter` as the default source of standard post-run figures when those plots have not yet been generated.

<HARD-GATE>
Do not claim that a performance issue is only a tuning problem if the evidence suggests a logic, interface, estimator, or stage-boundary bug.
</HARD-GATE>

<HARD-GATE>
Do not silently retune code or modify source files from this skill unless the user explicitly asks for implementation changes in the same turn. By default this skill produces diagnosis artifacts and bounded recommendations only.
</HARD-GATE>

## When to Use

Use this skill when:

- `42-build-run-diagnose` or equivalent runtime evidence already exists
- the code compiles and the case runs, but mission-level behavior is wrong
- performance metrics, residuals, settling time, stability, or mode timing are off
- the user wants debugging direction, bug review, or tuning guidance before another code-edit pass

## Inputs

Required:

- `<workspace>/AIGNC_Workflow/08_run/run_report.md` or equivalent runtime evidence
- `<workspace>/AIGNC_Workflow/08_run/run_summary.json`

Recommended:

- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_code_author_report.md`
- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_change_set.json`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/fsw_architecture_plan.md`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/file_change_map.json`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/mode_table.json`
- selected runtime logs or plots relevant to the failing behavior
- standard post-run figures from `$42-runtime-plotter` when available

Optional:

- current workspace configuration files
- prior tuning notes

## Required Local Context

Read `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/fsw-tuning-reviewer/references/repo-sources.md` first.

Default knowledge scope:

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_interfaces.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_extension_rules.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`

Default source scope:

- `<workspace>/FSW/ADCS/src/AcSensors.c`
- `<workspace>/FSW/ADCS/src/AcControl.c`
- `<workspace>/FSW/ADCS/src/AcMode.c`
- `<workspace>/FSW/ADCS/src/AcStateMachine.c`
- `<workspace>/FSW/ADCS/src/AcActuators.c`

Read these native 42 files when the review depends on simulator-side definitions, sensor validity, or actuator semantics:

- `codex_web/AIGNC/42/Source/42sensors.c`
- `codex_web/AIGNC/42/Source/42actuators.c`
- `codex_web/AIGNC/42/Source/42joints.c`
- `codex_web/AIGNC/42/Include/42types.h`
- current workspace configuration files under `<workspace>/Config/`, AI-generated configuration under `<workspace>/AIGNC_Workflow/04_config/`, or runtime `<workspace>/Output/Run/runtime_case/InOut/`

Read these when the issue runs through the optical-link sidecar path:

- `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalPayload.c`
- `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalLink.c`
- `codex_web/AIGNC/bridge/mission_bypass/Include/AcOpticalPayload.h`
- `<workspace>/FSW/ADCS/include/AcFswModules.h`

## Workflow

## Required Checklist

Complete these in order:

1. Confirm runtime evidence exists and isolate the failing metric or behavior.
2. Compare observed behavior against the expected requirement or architecture intent.
3. Classify the dominant issue type.
4. Walk a structured review sequence before recommending retuning.
5. Produce bounded debugging or retune hypotheses ordered by likelihood.
5. Route the next correction step to the right upstream stage, with `fsw-code-author` as the default next hop when the architecture is still valid.

### 1. Identify the failing behavior

Describe the failure concretely, for example:

- mode never entered
- mode entered too early or too late
- residual did not converge
- actuator saturated
- command sign appears reversed
- platform held but payload residual drifted
- runtime passed but mission metric failed

Do not accept vague statements like "performance is bad" without naming the failing observable.

### 2. Classify the issue

Classify each main finding as one of:

- `logic_bug`
- `interface_mismatch`
- `estimation_or_measurement_issue`
- `gain_or_timing_tuning`
- `config_or_case_issue`
- `architecture_gap`

Use `architecture_gap` when the code is behaving consistently with an incomplete or weak architecture choice rather than a local implementation bug.

### 3. Use the default review sequence

Unless the evidence clearly points elsewhere, review in this order:

1. **User-intent confirmation**
   - restate the intended sensor set, actuator set, control mode structure, and switching policy
   - make sure the current workspace is actually testing the intended architecture rather than a stale configuration
2. **Implementation consistency review**
   - inspect coordinate-frame definitions
   - inspect guidance-frame construction
   - inspect attitude-error and rate-error definitions
   - inspect sign conventions and axis ordering
   - inspect whether `CFS_FSW` logic matches the simulator-side 42 definitions
3. **Measurement and actuator validity review**
   - inspect whether the expected sensor data are actually valid
   - inspect whether occlusion, exclusion angles, FOV, timing, or sample-and-hold behavior explain the result
   - inspect whether actuator limits, rate limits, or saturation explain the observed performance
4. **State-machine and timing review**
   - inspect mode-entry conditions
   - inspect mode-exit conditions
   - inspect debounce, hold-time, timeout, and reset logic
   - inspect whether the run is too short for the expected transition or convergence

Use this as the default checklist, not as a hard limit. If the evidence points to a different dominant cause, say so and follow the evidence.

### 4. Keep tuning and bug review separate

For each finding, state whether the next step should return to:

- `fsw-code-author`
- `fsw-architecture-planner`
- `42-config-author`

Default to `fsw-code-author` when the architecture is still sound and the issue is implementation, sign, timing, gain, threshold, or local mode logic. Route back to `fsw-architecture-planner` only when the evidence suggests an architecture gap rather than a local coding problem.

### 5. Suggest bounded next changes

For each likely cause, recommend only bounded actions such as:

- confirm the intended sensor, actuator, or switching policy with the user when the runtime case may not reflect the intended architecture
- inspect sign conventions in a named file and function
- inspect whether simulator-side definitions in `42sensors.c`, `42actuators.c`, `42joints.c`, or `42types.h` match the FSW-side assumptions
- inspect whether guidance-frame construction and body/reference transforms are consistent
- inspect mode-entry debounce or hold-time logic
- inspect whether a residual uses truth or measured quantities incorrectly
- inspect whether a sensor is invalid because of occlusion, exclusion, FOV, or sample timing
- inspect whether actuator limits or rate limits explain the response
- extend runtime duration when the intended transition or settling event may not yet have had time to occur
- reduce or increase a named gain range
- change a sample time or timeout parameter
- add or inspect a plot for a specific internal state

Avoid open-ended advice like "retune controller."

## Output Contract

Produce:

- `<workspace>/AIGNC_Workflow/09_tuning_review/fsw_tuning_review.md`
- `<workspace>/AIGNC_Workflow/09_tuning_review/fsw_tuning_hypotheses.json`

Write these outputs under `<workspace>/AIGNC_Workflow/09_tuning_review/`.

Append step-level status entries to `<workspace>/AIGNC_Workflow/workflow_log.md` when this skill starts, after runtime-evidence confirmation, failing-behavior isolation, requirement comparison, issue classification, review-sequence checks, hypothesis ranking, corrective-action selection, review artifact writing, and final return-stage recommendation. Entries must use stage `09_tuning_review`, current skill `fsw-tuning-reviewer`, step id or step name, status, timestamp, concise description, key inputs checked, outputs updated, and next action or handoff target. Do not log private reasoning.
Structured progress must also be updated in `<workspace>/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>_<skill_name>`, matching the numbered stage used for `<workspace>/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the skill run.


The review must include:

1. failing behaviors
2. likely cause classification
3. ranked hypotheses
4. recommended next stage
5. bounded corrective actions

The JSON should include fields such as:

- `primary_failure_modes`
- `hypotheses`
- `recommended_return_stage`
- `suggested_parameter_targets`
- `suggested_code_focus`

## Stop Conditions

Stop and say the evidence is insufficient if:

- runtime logs or plots do not contain the failing observable
- the user asks for performance diagnosis before any runnable implementation exists
- the observed behavior cannot be compared to a requirement because the requirement package is missing

## Self-Review

Before finishing, check:

1. Did I separate logic bugs from tuning issues?
2. Did I tie each hypothesis to a concrete observable?
3. Did I check user-intent, implementation consistency, measurement validity, and state-machine timing before defaulting to tuning?
4. Did I recommend a bounded return stage?
5. Did I avoid silently redesigning the architecture?

Fix issues before returning.

## Boundaries

Do not:

- declare runtime diagnosis complete if the behavior still violates mission intent
- rewrite architecture inside this skill
- silently patch code by default
- treat configuration mistakes as tuning mistakes

## Terminal State

The terminal state is a bounded performance-review package that tells the next stage whether to revise implementation, revise architecture, or revise the workspace configuration, and why. In the normal FSW loop, this package is intended to feed the next `fsw-code-author` iteration.
