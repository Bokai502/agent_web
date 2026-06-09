# FSW Architecture Planner Skill Spec

## Purpose

Convert complete extracted fixed `CFS_FSW` GNC requirements into a concrete architecture mapping for the existing 42 `CFS_FSW` codebase before implementation begins.

This skill exists between:

- `fsw-requirements-extractor`
- future FSW code-generation / implementation skills

It is not a code-writing skill.

## Trigger

Use when:

- `fsw_requirement_spec.md` already exists
- the user asks how to implement the extracted modes, transitions, sensor/actuator contracts, control targets, guidance rates, target attitudes, pass criteria, or control logic in fixed `CFS_FSW`
- the user wants file-level planning before code changes

## Inputs

### Required

- `fsw_requirement_spec.md`
- `mode_table.json`
- `sensor_actuator_contract.json`

### Recommended

- `scenario_facts.json`
- `capability_assessment.json`
- `generated_config_manifest.json`
- `requirements_trace.json`

## Core Responsibilities

1. verify that the extracted package contains the complete-GNC fields required by `fsw-requirements-extractor`
2. classify each mode field and interface requirement as:
   - `cfs_fsw_internal`
   - `truth_model_extension`
   - `cross_boundary`
3. map each required mode, transition family, fallback, and pass criterion to:
   - `Source/AcMode.c`
   - `Source/AcStateMachine.c`
4. map each control method, control target, guidance rate, target frame, target attitude, target vector/LOS, and command output to:
   - `Source/AcControl.c`
   - `Source/AcActuators.c` when allocation / dispatch is the primary concern
   - `Source/AcMode.c` or `Source/AcStateMachine.c` when the item is metadata or completion logic
5. map each sensor / actuator contract to:
   - existing `AcType` interfaces
   - required preprocessing in `Source/AcSensors.c`
   - required dispatch, enable/inhibit logic, allocation, saturation, and fault handling in `Source/AcActuators.c`
6. emit unresolved architecture blockers without silently resolving them
7. separate fixed `CFS_FSW` work from truth-model extension work

## Required Outputs

- `fsw_architecture_plan.md`
- `file_change_map.json`
- `blocking_architecture_questions.json`
- `truth_model_extension_boundary.json`

## Output Semantics

### `fsw_architecture_plan.md`

Human-readable architecture mapping that covers:

- mode ownership
- transition and fallback ownership
- pass-criteria ownership
- sensor and actuator interface ownership
- control-method ownership
- control-target, guidance-rate, target-frame, target-attitude, target-vector/LOS, and command-output ownership
- extension boundaries

### `file_change_map.json`

Machine-readable mapping from requirement families and complete-GNC mode fields to source files and responsibilities. It must include entries for mode, transition, pass-criteria, sensor, actuator, control-target, guidance-rate, target-frame, target-attitude, target-vector/LOS, command-output, and extension-boundary ownership.

### `blocking_architecture_questions.json`

Explicit unresolved questions that must be answered before deterministic implementation.

### `truth_model_extension_boundary.json`

Clear split between:

- work that can stay entirely inside fixed `CFS_FSW`
- work that requires changes to 42 truth-model code

## Hard Gates

- Must not modify source code
- Must not silently choose unresolved estimator / geometry / actuator / control-target / pass-criteria semantics
- Must not collapse truth-model extension work into ordinary `CFS_FSW` edits

## Typical Blockers

- exact lunar-orbit navigation source
- exact relative-geometry source during optical link alignment
- exact target-geometry source for target tracking
- exact safe/detumble use of thruster assist
- missing target frame, target attitude, guidance rate, or pass criteria in a mode
- unclear command-output ownership between `AcControl.c` and `AcActuators.c`

## Exit Condition

The skill is complete when a downstream implementation skill could open the four outputs and know:

- which files must change
- which requirements and per-mode fields belong to each file
- which transition, control-target, interface, command-output, and pass-criteria decisions are still blocked
- which items are outside fixed `CFS_FSW` and must be handled as truth-model extensions
