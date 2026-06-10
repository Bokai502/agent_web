---
name: fsw-requirements-extractor
description: Extract fixed CFS_FSW requirements from mission descriptions, including modes, transition conditions, sensor and actuator contracts, control-law constraints, and a user-confirmable GNC interface contract that freezes coordinate, sensor-validity, mode-semantics, timer, and actuator-role assumptions before implementation.
---

# FSW Requirements Extractor

## Path Contract

- `<workspace>` means the backend-injected `workspace_dir`; this skill must use `workspace_dir` as the only source for the active working directory.
- Shared skills live under `open_codex_web/backend/workflow_agents/gnc_skills/skills/`.
- Shared knowledge lives under `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/`.
- Shared 42, bridge, and reference resources live under `codex_web/AIGNC/42/`, `codex_web/AIGNC/bridge/`, and `codex_web/AIGNC/ref/`.


## Overview

Use this skill when the user has already committed to the fixed `CFS_FSW` path and needs the mission description converted into an implementation-ready FSW requirement specification.

This skill extracts and structures requirements. It also drafts the GNC interface contract that must be explicitly confirmed by the user before architecture planning or code implementation. It does not write control code.

## When to Use

Use this skill when the user asks for any of the following:

- mode design inside the fixed `CFS_FSW`
- transition logic or state-machine conditions
- sensor and actuator requirements for FSW
- control-law constraints, targets, or performance metrics
- a structured spec before source-code changes
- a draft `gnc_interface_contract.md` for user confirmation before FSW architecture or implementation

## Inputs

Required:

- natural-language mission or GNC description

Recommended:

- `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`
- `<workspace>/AIGNC_Workflow/03_capability/capability_assessment.json`

Optional:

- existing `CFS_FSW` implementation notes
- current workspace files if the request is incremental

### Input Source Resolution

Resolve the natural-language mission or GNC description in this order:

1. The user's current message, if it contains the mission or GNC behavior request directly.
2. `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`, when it exists; use it as the normalized source of scenario facts.
3. `<workspace>/AIGNC_Workflow/02_scenario/scenario_understanding.md`, when more prose context is needed.
4. `<workspace>/AIGNC_Workflow/01_inputs/` extracted text or AI-consumed copies, such as `*_extracted.txt`, `*_extracted_text.md`, or `input_inventory.*`.
5. `<workspace>/Input/` original user-provided design or task files, only when the workflow input copies or extracted text are missing or insufficient.

Do not invent a mission root. If `<Mission>` is not explicit, infer it only from an unambiguous user path, existing workflow artifacts, or the current task context; otherwise ask which case to use.

When both raw input files and `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json` exist, treat `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json` as the primary structured input and use raw/extracted documents only to clarify gaps or trace requirements.

## Required Local Context

Read `open_codex_web/backend/workflow_agents/gnc_skills/skills/fsw-requirements-extractor/references/repo-sources.md` first. When drafting `gnc_interface_contract.md`, also read and use `open_codex_web/backend/workflow_agents/gnc_skills/skills/fsw-requirements-extractor/references/gnc_interface_contract_template.md` as the required template.

Default knowledge scope:

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_interfaces.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_extension_rules.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`

Default structured indexes:

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_architecture.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_interfaces.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_extension_rules.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/sensors.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/actuators.json`

Use detailed schemas only if the request depends on concrete interface fields.

## Workflow

### 1. Extract complete GNC flight-software semantics

Identify the complete fixed-FSW GNC process, not only the modes mentioned explicitly:

- whether the request is ADCS only or includes orbit control
- the full mode sequence from initialization/safe behavior through terminal mission modes
- which phases are true modes versus transient steps
- which guidance targets, pointing references, guidance rates, and target attitudes exist
- which sensors and actuators are available, required, optional, inhibited, or unavailable in each mode
- which control method family is expected or allowed in each mode
- which mission metrics and per-mode pass criteria are explicit or must be confirmed

### 2. Extract mode sequence, transition logic, and pass criteria

Convert prose into structured transition conditions without directly writing C code. Every mode must have explicit entry logic, exit logic, fallback logic when applicable, and pass/fail criteria for deciding whether that mode has completed its job.

Typical condition families:

- angular-rate thresholds
- attitude-error thresholds
- pointing-vector or line-of-sight error thresholds
- commanded guidance-rate thresholds or tracking residuals
- sensor-validity conditions
- hold times and dwell times
- momentum, saturation, or actuator thresholds
- timeout, safe-mode, or fault fallback conditions

### 3. Extract per-mode control and interface constraints

For each mode, capture requirements such as:

- sensor inputs, validity gates, fallback sensors, and estimator or truth-state assumptions
- actuator outputs, actuator enable/inhibit state, allocation rules, saturation handling, and unloading policy
- control method family, such as rate damping, quaternion feedback, LVLH pointing, inertial pointing, target-line tracking, feedforward tracking, or momentum management
- guidance rate, target attitude, target frame, target vector, attitude-error representation, and rate-feedback form
- pass criteria, such as final attitude error, body-rate residual, target-line residual, dwell time, sensor-valid dwell, momentum bound, or safe timeout

### 4. Draft the GNC interface contract for user confirmation

Create `<workspace>/AIGNC_Workflow/05_fsw_requirements/gnc_interface_contract.md` from `references/gnc_interface_contract_template.md` with `Status: Pending_User_Confirmation` unless the current conversation contains an explicit user confirmation for the exact contract contents. The contract is task-specific but uses a mission-independent structure and must freeze, at minimum:

- coordinate and state semantics: quaternion ordering and frame direction, angular-rate frame and units, body-axis meanings, orbit-frame convention, Euler plot convention, attitude-error direction, and quaternion composition order for relative targets
- guidance target semantics: safe, sun, nadir/Earth, inertial, slew, tracking, and any payload target definitions; whether each target is absolute, relative, sampled, locked, or continuous
- sensor validity semantics: valid/invalid definitions and invalid handling for every required sensor or truth-fed input
- environment visibility semantics: eclipse, target occultation, exclusion-angle, or other non-observability conditions; whether each condition is sensor failure; and whether timers pause, continue, or reset
- mode semantics: entry, exit, abort, fallback, and timer/dwell interpretation for each mode
- actuator allocation semantics: which actuator classes are primary, inhibited, unload-only, or unavailable in each phase
- control-law and guidance commitments: error definitions, rate references, feedforward policy, saturation handling, guidance profiles, and terminal conditions
- verification metrics: telemetry source and pass condition for each mission-level GNC requirement

The contract must include metadata fields:

```text
Status: Pending_User_Confirmation | Frozen_By_User | Revised
Prepared By: Agent
Confirmed By: <TBD until explicit user confirmation>
Confirmed At: <TBD until explicit user confirmation>
Implementation Gate: FSW architecture planning and code authoring are blocked until Status is Frozen_By_User.
```

For every row whose meaning could affect implementation, include a `User Confirmation` or equivalent status column. Before presenting the contract for confirmation, fill every mission-relevant semantic cell with a concrete value or `N/A - <reason>`; do not leave `TBD`, `Unknown`, blank required fields, or unresolved alternatives. Use `Pending` only in the user-confirmation column while awaiting review. Do not mark `Frozen_By_User` without explicit user confirmation in the conversation.

At the end of the requirements response, present a concise confirmation summary listing only the highest-risk semantics the user must confirm, and ask the user to reply with an explicit confirmation or corrections.

### 5. Check whether the request exceeds fixed `CFS_FSW`

Flag separately when the request actually implies:

- new truth-model sensors
- new truth-model actuators
- full estimation architecture beyond current `CFS_FSW`

Do not hide these behind ordinary control-law wording.

## Output Contract

Produce under `<workspace>/AIGNC_Workflow/05_fsw_requirements/`:

- `<workspace>/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/mode_table.json`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/sensor_actuator_contract.json`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/gnc_interface_contract.md`

Append step-level status entries to `<workspace>/AIGNC_Workflow/workflow_log.md` when this skill starts, after source input review, control-semantics extraction, mode/transition extraction, sensor/actuator contract extraction, implementation-constraint extraction, fixed-FSW boundary check, artifact writing, and final FSW-requirements handoff. Entries must use stage `05_fsw_requirements`, current skill `fsw-requirements-extractor`, step id or step name, status, timestamp, concise description, key inputs checked, outputs updated, and next action or handoff target. Do not log private reasoning.
Structured progress must also be updated in `<workspace>/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>`, matching the numbered stage used for `<workspace>/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the stage run. Keep the current skill name in the `--skill` field instead of embedding it in the loop name. Set `--note` according to the shared frontend-display note contract in `open_codex_web/backend/workflow_agents/gnc_skills/skills/README.md`.


The four output files are not optional summaries. Together they must describe all fixed-FSW requirements and the user-confirmable interface semantics needed for the complete GNC process. Do not leave a mode with implicit control targets, implicit sensors, implicit actuators, or implicit completion criteria.

`fsw_requirement_spec.md` must include, at minimum:

1. Mission-level GNC process overview and ordered mode sequence.
2. Mode-switching process and all transition conditions, including nominal progression, fallback/safe transitions, timeout behavior, and unresolved transition assumptions.
3. For every mode: sensor configuration, actuator configuration, control method candidates or required method, control target, pointing target, guidance rate, target frame, target attitude representation, and expected command outputs.
4. For every mode: pass/fail or completion criteria, including thresholds, dwell times, validity windows, and evidence required to judge the mode.
5. Items that exceed current fixed `CFS_FSW` support, separated from implementable requirements.
6. Blocking questions if any of the required per-mode fields cannot be resolved from input facts or approved assumptions.

`mode_table.json` must be a machine-readable list of modes. Every mode object must include these keys:

- `mode_id`
- `mode_name`
- `purpose`
- `mode_sequence_index`
- `entry_conditions`
- `exit_conditions`
- `fallback_or_fault_transitions`
- `required_sensors`
- `optional_or_fallback_sensors`
- `required_actuators`
- `inhibited_actuators`
- `control_method`
- `control_target`
- `guidance_rate`
- `target_frame`
- `target_attitude`
- `target_vector_or_los`
- `command_outputs`
- `pass_criteria`
- `unresolved_questions`

`sensor_actuator_contract.json` must describe the FSW sensor/actuator interface contract across the whole mode table and must include these keys:

- `mode_sensor_actuator_matrix` with one entry per mode
- `required_sensor_inputs`
- `sensor_validity_requirements`
- `estimation_or_truth_state_assumptions`
- `required_actuator_outputs`
- `actuator_enable_inhibit_rules`
- `allocation_requirements`
- `saturation_and_fault_handling`
- `mode_specific_control_methods`
- `mode_specific_pass_criteria`
- `open_interface_questions`

`gnc_interface_contract.md` must be generated from `references/gnc_interface_contract_template.md`, remain concise, table-driven, and implementation-gating, and must not become a long design report. It must contain the template sections for confirmation summary, coordinate/state semantics, guidance target semantics, sensor validity semantics, environment visibility semantics, mode semantics, timer/dwell semantics, actuator allocation semantics, control-law commitments, guidance profile commitments, verification metrics, and open issues/assumptions. It must start as `Status: Pending_User_Confirmation` unless explicit user confirmation is already present. It is invalid if any mission-relevant semantic cell remains `TBD`, `Unknown`, blank, or expressed as unresolved alternatives.

## Stop Conditions

Stop and ask for clarification if:

- the physical meaning of a pointing objective is ambiguous
- a mode lacks a control target, guidance rate, target attitude, or target frame needed to implement it
- a mode lacks pass/fail criteria or completion criteria
- the request depends on unspecified available sensors or actuators
- multiple mutually different state-machine interpretations are possible
- coordinate, target, sensor-validity, environment-visibility, actuator-role, control-law, guidance-profile, verification, or timer/dwell semantics needed for implementation cannot be fully populated in the contract template
- the user mixes estimator requirements with truth-state assumptions without resolving the boundary

## Boundaries

Do not:

- write `AcControl.c`, `AcStateMachine.c`, or other source files
- decide truth-model extension details
- silently translate ambiguous prose into hard-coded logic

The next downstream skill is typically an FSW architecture or implementation planner.
