---
name: fsw-architecture-planner
description: Map extracted fixed CFS_FSW requirements and the user-frozen GNC interface contract onto concrete 42 source modules, file boundaries, unresolved blockers, and truth-model extension decisions before implementation. Use after fsw-requirements-extractor and before any CFS_FSW code changes.
---

# FSW Architecture Planner

## Path Contract

- `<workspace>` means the backend-injected `workspace_dir`; this skill must use `workspace_dir` as the only source for the active working directory.
- Shared skills live under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/`.
- Shared knowledge lives under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/`.
- Shared 42, bridge, and reference resources live under `codex_web/AIGNC/42/`, `codex_web/AIGNC/bridge/`, and `codex_web/AIGNC/ref/`.


## Overview

Use this skill after fixed `CFS_FSW` requirements have already been extracted and before any source code is modified. The job is to convert mission-level FSW requirements into a concrete architecture plan for the existing 42 `CFS_FSW` codebase.

This skill writes planning artifacts only. It does not edit `AcControl.c`, `AcStateMachine.c`, or any other source file.

<HARD-GATE>
Do not write or modify `CFS_FSW` source code from this skill. If a requirement cannot yet be mapped cleanly because of unresolved architecture blockers, record the blocker explicitly instead of silently choosing an implementation.
</HARD-GATE>

<HARD-GATE>
Do not architecture-plan FSW behavior from implicit coordinate, sensor-validity, environment-visibility, mode-timer, target, control-law, guidance-profile, verification, or actuator-role assumptions. Require `<workspace>/AIGNC_Workflow/05_fsw_requirements/gnc_interface_contract.md` created from the required template and marked `Status: Frozen_By_User`. If the contract is missing, pending user confirmation, contains required `TBD`, `Unknown`, blank fields, unresolved alternatives, or contradicts the requirement package, stop and route back to requirements clarification instead of planning.
</HARD-GATE>

## When to Use

Use this skill when:

- `fsw-requirements-extractor` output already exists
- the user wants to know which `CFS_FSW` files must change
- the user wants a file-by-file architecture mapping before implementation
- the request includes new modes, transition logic, control laws, sensor preprocessing, or actuator dispatch changes inside fixed `CFS_FSW`

## Inputs

Required:

- `<workspace>/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/mode_table.json`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/sensor_actuator_contract.json`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/gnc_interface_contract.md` with `Status: Frozen_By_User`

Recommended:

- `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`
- `<workspace>/AIGNC_Workflow/03_capability/capability_assessment.json`
- `<workspace>/AIGNC_Workflow/04_config/generated_config_manifest.json`
- `<workspace>/AIGNC_Workflow/04_config/validation/requirements_trace.json`

Optional:

- current `CFS_FSW` implementation notes
- current workspace configuration files if an interface question depends on actual configured hardware

## Required Local Context

Read `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/fsw-architecture-planner/references/repo-sources.md` first.

Default knowledge scope:

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_interfaces.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_extension_rules.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`

Default structured indexes:

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_architecture.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_interfaces.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_extension_rules.json`

Read source files only as needed to verify file ownership or existing extension seams:

- `<workspace>/FSW/ADCS/src/AcSensors.c`
- `<workspace>/FSW/ADCS/src/AcControl.c`
- `<workspace>/FSW/ADCS/src/AcMode.c`
- `<workspace>/FSW/ADCS/src/AcStateMachine.c`
- `<workspace>/FSW/ADCS/src/AcActuators.c`

## Workflow

## Required Checklist

Complete these in order:

1. Verify the extracted FSW requirement package exists and contains the required complete-GNC fields from `fsw-requirements-extractor`.
2. Verify the GNC interface contract exists, follows the required template sections, is `Frozen_By_User`, and has no required pending confirmations, `TBD`, `Unknown`, blank fields, or unresolved alternatives.
3. Reject or block incomplete modes instead of mapping implicit requirements.
4. Separate fixed `CFS_FSW` work from truth-model extension work for each mode, interface, target, and pass criterion.
5. Map every required mode, transition, fallback, and pass criterion to concrete `CFS_FSW` ownership files.
6. Map every per-mode sensor and actuator configuration to concrete `CFS_FSW` ownership files.
7. Map every control method, control target, guidance rate, target frame, target attitude, target vector/LOS, and command output to concrete `CFS_FSW` ownership files.
8. Record unresolved blockers instead of guessing implementation choices.
9. Emit architecture-planning artifacts and self-review them for full requirement coverage.

### 1. Verify the complete-GNC requirement package and frozen interface contract

Before mapping anything, verify that `mode_table.json` and `sensor_actuator_contract.json` contain the complete fields required by `fsw-requirements-extractor`. Every mode must provide:

- `mode_id`, `mode_name`, and `mode_sequence_index`
- `entry_conditions`, `exit_conditions`, and `fallback_or_fault_transitions`
- `required_sensors`, `optional_or_fallback_sensors`, `required_actuators`, and `inhibited_actuators`
- `control_method`, `control_target`, `guidance_rate`, `target_frame`, `target_attitude`, and `target_vector_or_los`
- `command_outputs`, `pass_criteria`, and `unresolved_questions`

If a required field is absent, empty, contradictory, or says `TBD` without an explicit unresolved question, record it in `blocking_architecture_questions.json` and do not silently map an invented implementation.

Also read `<workspace>/AIGNC_Workflow/05_fsw_requirements/gnc_interface_contract.md`. Block architecture planning if its status is not `Frozen_By_User`, if any implementation-relevant row remains `Pending`, `TBD`, `Unknown`, blank, or expressed as unresolved alternatives, or if the contract lacks template sections for confirmation summary, coordinate/state semantics, guidance target semantics, sensor validity semantics, environment visibility semantics, mode/timer semantics, actuator allocation semantics, control-law commitments, guidance profile commitments, verification metrics, and open issues/assumptions.

When planning proceeds, treat the frozen contract as authoritative for ambiguous implementation choices. If `mode_table.json` or `sensor_actuator_contract.json` conflicts with the frozen contract, record the conflict and route back to `fsw-requirements-extractor`; do not silently choose one.

### 2. Confirm the planning boundary

For each mode field, classify the work as one of:

- `cfs_fsw_internal`
- `truth_model_extension`
- `cross_boundary`

Use `truth_model_extension` for items such as:

- native new sensor dynamics in `codex_web/AIGNC/42/Source/42sensors.c`
- native new actuator dynamics in `codex_web/AIGNC/42/Source/42actuators.c` or `codex_web/AIGNC/42/Source/42joints.c`
- target geometry or measurement truth that is unavailable through existing fixed `CFS_FSW` interfaces

Do not pretend these are ordinary `CFS_FSW` edits.

### 3. Map modes, transitions, and pass criteria

Use `<workspace>/AIGNC_Workflow/05_fsw_requirements/mode_table.json` to produce a deterministic mapping for:

- mode enumerations and labels
- ordered mode progression from `mode_sequence_index`
- mode entry logic
- mode exit logic
- fallback, timeout, and safe-mode transitions
- health-supervisor logic
- per-mode `pass_criteria` evaluation helpers
- required substate supervisors such as link-alignment substates

Default file ownership:

- new mode labels, mode metadata, target descriptors, and mode-specific evaluation helpers -> `<workspace>/FSW/ADCS/src/AcMode.c`
- top-level state progression, entry/exit/fallback dispatch, dwell/timeout tracking, and pass/fail routing -> `<workspace>/FSW/ADCS/src/AcStateMachine.c`

### 4. Map control targets, guidance, and control methods

For each mode, map these `mode_table.json` fields to ownership files:

- `control_method`
- `control_target`
- `guidance_rate`
- `target_frame`
- `target_attitude`
- `target_vector_or_los`
- `command_outputs`
- control-related `pass_criteria`

Default ownership:

- target attitude construction, attitude/rate error calculation, guidance-rate feedforward, and control-law computation -> `<workspace>/FSW/ADCS/src/AcControl.c`
- command limiting, allocation, actuator enable/inhibit handling, and actuator-specific dispatch -> `<workspace>/FSW/ADCS/src/AcActuators.c`
- mode target metadata or helper selection that does not compute commands -> `<workspace>/FSW/ADCS/src/AcMode.c`
- mode completion decisions that compare control residuals against pass criteria -> `<workspace>/FSW/ADCS/src/AcStateMachine.c` or `<workspace>/FSW/ADCS/src/AcMode.c`, with ownership stated explicitly

Typical categories:

- detumble law
- sun acquisition law
- lunar nadir hold law
- inertial or LVLH pointing law
- target tracking law
- link alignment bus-pointing law
- feedforward guidance-rate tracking
- momentum-dump supervisory law

Use `cross_boundary` when a bus-pointing law depends on a truth-model actuator or target measurement that does not yet exist, such as a native FSM or unavailable optical target state.

### 5. Map per-mode sensor and actuator interfaces

Use `<workspace>/AIGNC_Workflow/05_fsw_requirements/sensor_actuator_contract.json`, the per-mode sensor/actuator fields in `mode_table.json`, and `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_interfaces.md` to decide:

- which existing `AcType` fields are already sufficient
- which sensor validity gates, preprocessing, estimator/truth-state assumptions, and fallback selections belong in `<workspace>/FSW/ADCS/src/AcSensors.c`
- which actuator command generation, allocation, enable/inhibit logic, saturation handling, and fault handling belong in `<workspace>/FSW/ADCS/src/AcActuators.c`
- which mode-specific sensor/actuator availability checks belong in `<workspace>/FSW/ADCS/src/AcStateMachine.c` or `<workspace>/FSW/ADCS/src/AcMode.c`
- which required interfaces do not yet exist in fixed `CFS_FSW`

Do not silently assume truth-fed quantities are already valid estimator outputs. If `estimation_or_truth_state_assumptions` is unresolved or conflicts with `control_target`, record a blocker.

### 6. Record architecture blockers

If any requirement depends on an unresolved design choice, record it explicitly in `<workspace>/AIGNC_Workflow/06_fsw_architecture/blocking_architecture_questions.json`.

Examples:

- missing or contradictory `mode_table.json` field required for implementation
- exact lunar orbit navigation source inside fixed `CFS_FSW`
- exact relative-geometry source and estimation boundary in `link_alignment`
- exact target-geometry source in `target_track`
- exact target frame or target attitude definition for a pointing mode
- missing guidance-rate definition for a tracking mode
- missing pass criteria for mode completion
- exact safe/detumble wheel-plus-thruster assist policy

Blockers do not invalidate the planner. The planner must still map the rest of the system cleanly.

### 7. Separate extension boundaries

Produce a dedicated truth-model boundary artifact that states:

- what can be implemented entirely inside fixed `CFS_FSW`
- what requires modifications to read-only simulator files such as `codex_web/AIGNC/42/Include/42types.h`, `codex_web/AIGNC/42/Source/42init.c`, `codex_web/AIGNC/42/Source/42sensors.c`, `codex_web/AIGNC/42/Source/42actuators.c`, or `codex_web/AIGNC/42/Source/42joints.c`
- what can be bridged temporarily with surrogates versus what cannot

## Output Contract

Produce under `<workspace>/AIGNC_Workflow/06_fsw_architecture/`:

- `<workspace>/AIGNC_Workflow/06_fsw_architecture/fsw_architecture_plan.md`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/file_change_map.json`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/blocking_architecture_questions.json`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/truth_model_extension_boundary.json`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/gnc_interface_contract_trace.md`

Append step-level status entries to `<workspace>/AIGNC_Workflow/workflow_log.md` when this skill starts, after requirement-package verification, boundary classification, mode ownership mapping, control ownership mapping, sensor/actuator ownership mapping, blocker recording, extension-boundary recording, artifact writing, and final architecture handoff. Entries must use stage `06_fsw_architecture`, current skill `fsw-architecture-planner`, step id or step name, status, timestamp, concise description, key inputs checked, outputs updated, and next action or handoff target. Do not log private reasoning.
Structured progress must also be updated in `<workspace>/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>_<skill_name>`, matching the numbered stage used for `<workspace>/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the skill run.


The architecture plan must map every required mode, transition family, fallback, pass criterion, sensor contract, actuator contract, control method, control target, guidance rate, target frame, target attitude, target vector/LOS, command output, and frozen GNC interface-contract commitment to concrete file ownership or explicit extension boundaries. `gnc_interface_contract_trace.md` must state, row by row or section by section, where each frozen contract commitment will be implemented or verified.

`file_change_map.json` must include machine-readable coverage for the new complete-GNC fields, with entries for:

- `mode_ownership`
- `transition_ownership`
- `pass_criteria_ownership`
- `sensor_interface_ownership`
- `actuator_interface_ownership`
- `control_target_ownership`
- `guidance_rate_ownership`
- `target_frame_ownership`
- `target_attitude_ownership`
- `target_vector_or_los_ownership`
- `command_output_ownership`
- `extension_boundary_items`

## Stop Conditions

Stop and ask for clarification if:

- the extracted FSW package is missing one of the required four core artifacts, including `gnc_interface_contract.md`
- `mode_table.json` lacks the required complete-GNC fields and the missing fields are not already represented as unresolved questions
- `gnc_interface_contract.md` is missing, not template-complete, not `Frozen_By_User`, still has required `Pending`/`TBD`/`Unknown`/blank/unresolved-alternative entries, or has no explicit user confirmation evidence
- required modes, transition logic, control targets, guidance rates, target attitudes, or pass criteria are mutually inconsistent
- a requirement cannot be classified as `cfs_fsw_internal`, `truth_model_extension`, or `cross_boundary`
- the user asks for code implementation rather than planning

## Self-Review

Before handoff, check:

1. Does every mode in `<workspace>/AIGNC_Workflow/05_fsw_requirements/mode_table.json` appear in `<workspace>/AIGNC_Workflow/06_fsw_architecture/fsw_architecture_plan.md`?
2. Does every transition family, fallback path, and pass criterion have an owning file or explicit blocker?
3. Does every sensor and actuator contract have an owning file or explicit extension boundary?
4. Does every control method, control target, guidance rate, target frame, target attitude, target vector/LOS, and command output have an owning file or explicit blocker?
5. Are truth-model extensions kept separate from ordinary `CFS_FSW` edits?
6. Does `gnc_interface_contract_trace.md` map every frozen coordinate, target, sensor-validity, environment-visibility, mode-timer, actuator-allocation, control-law, guidance-profile, and verification commitment to owning files or verification artifacts?
7. Are all unresolved implementation choices listed in `<workspace>/AIGNC_Workflow/06_fsw_architecture/blocking_architecture_questions.json` instead of being silently guessed?

Fix issues inline before declaring architecture planning complete.

## Boundaries

Do not:

- modify `<workspace>/FSW/ADCS/src/AcSensors.c`, `<workspace>/FSW/ADCS/src/AcControl.c`, `<workspace>/FSW/ADCS/src/AcMode.c`, `<workspace>/FSW/ADCS/src/AcStateMachine.c`, or `<workspace>/FSW/ADCS/src/AcActuators.c`
- generate detailed task-by-task implementation checklists
- decide final numeric tuning values unless they were already fixed in the extracted requirement package
- hide missing truth-model support behind surrogate wording

The next downstream skill is a future implementation-oriented FSW code author or execution planner.

## Terminal State

The terminal state is a file-level architecture package that tells a downstream implementation skill exactly:

- what belongs in fixed `CFS_FSW`
- which files own each change
- which items are blocked pending clarification
- which items require truth-model extensions outside fixed `CFS_FSW`
