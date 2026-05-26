---
name: fsw-architecture-planner
description: Map extracted fixed CFS_FSW requirements onto concrete 42 source modules, file boundaries, unresolved blockers, and truth-model extension decisions before implementation. Use after fsw-requirements-extractor and before any CFS_FSW code changes.
---

# FSW Architecture Planner

## Overview

Use this skill after fixed `CFS_FSW` requirements have already been extracted and before any source code is modified. The job is to convert mission-level FSW requirements into a concrete architecture plan for the existing 42 `CFS_FSW` codebase.

This skill writes planning artifacts only. It does not edit `AcControl.c`, `AcStateMachine.c`, or any other source file.

<HARD-GATE>
Do not write or modify `CFS_FSW` source code from this skill. If a requirement cannot yet be mapped cleanly because of unresolved architecture blockers, record the blocker explicitly instead of silently choosing an implementation.
</HARD-GATE>

## When to Use

Use this skill when:

- `fsw-requirements-extractor` output already exists
- the user wants to know which `CFS_FSW` files must change
- the user wants a file-by-file architecture mapping before implementation
- the request includes new modes, transition logic, control laws, sensor preprocessing, or actuator dispatch changes inside fixed `CFS_FSW`

## Inputs

Required:

- `fsw_requirement_spec.md`
- `mode_table.json`
- `sensor_actuator_contract.json`

Recommended:

- `scenario_facts.json`
- `capability_assessment.json`
- `generated_config_manifest.json`
- `requirements_trace.json`

Optional:

- current `CFS_FSW` implementation notes
- current case configuration files if an interface question depends on actual configured hardware

## Required Local Context

Read `references/repo-sources.md` first.

Default knowledge scope:

- `knowledge/42/cfs_fsw_architecture.md`
- `knowledge/42/cfs_fsw_interfaces.md`
- `knowledge/42/cfs_fsw_extension_rules.md`
- `knowledge/42/limitations.md`

Default structured indexes:

- `knowledge/42/capabilities/cfs_fsw_architecture.json`
- `knowledge/42/capabilities/cfs_fsw_interfaces.json`
- `knowledge/42/capabilities/cfs_fsw_extension_rules.json`

Read source files only as needed to verify file ownership or existing extension seams:

- `fsw/overlay/Source/AcSensors.c`
- `fsw/overlay/Source/AcControl.c`
- `fsw/overlay/Source/AcMode.c`
- `fsw/overlay/Source/AcStateMachine.c`
- `fsw/overlay/Source/AcActuators.c`

## Workflow

## Required Checklist

Complete these in order:

1. Verify the extracted FSW requirement package exists and is internally consistent.
2. Separate fixed `CFS_FSW` work from truth-model extension work.
3. Map every required mode and transition to concrete `CFS_FSW` ownership files.
4. Map every sensor and actuator contract to concrete `CFS_FSW` ownership files.
5. Map every control-law family to concrete `CFS_FSW` ownership files.
6. Record unresolved blockers instead of guessing implementation choices.
7. Emit architecture-planning artifacts and self-review them for full requirement coverage.

### 1. Confirm the planning boundary

Before mapping anything, classify each requirement as one of:

- `cfs_fsw_internal`
- `truth_model_extension`
- `cross_boundary`

Use `truth_model_extension` for items such as:

- native new sensor dynamics in `sim/42_baseline/Source/42sensors.c`
- native new actuator dynamics in `sim/42_baseline/Source/42actuators.c` or `sim/42_baseline/Source/42joints.c`

Do not pretend these are ordinary `CFS_FSW` edits.

### 2. Map modes and transitions

Use `mode_table.json` to produce a deterministic mapping for:

- mode enumerations
- mode entry logic
- mode exit logic
- health-supervisor logic
- required substate supervisors such as link-alignment substates

Default file ownership:

- new mode labels and mode-specific evaluation helpers -> `fsw/overlay/Source/AcMode.c`
- top-level state progression and mode dispatch -> `fsw/overlay/Source/AcStateMachine.c`

### 3. Map control methods

For each required control family, decide whether it belongs in:

- `fsw/overlay/Source/AcControl.c`
- `fsw/overlay/Source/AcActuators.c`

Typical categories:

- detumble law
- sun acquisition law
- lunar nadir hold law
- target tracking law
- link alignment bus-pointing law
- momentum-dump supervisory law

Use `cross_boundary` when a bus-pointing law depends on a truth-model actuator that does not yet exist, such as a native FSM.

### 4. Map sensor and actuator interfaces

Use `sensor_actuator_contract.json` and `knowledge/42/cfs_fsw_interfaces.md` to decide:

- which existing `AcType` fields are already sufficient
- which preprocessing belongs in `fsw/overlay/Source/AcSensors.c`
- which actuator command generation or allocation belongs in `fsw/overlay/Source/AcActuators.c`
- which required interfaces do not yet exist in fixed `CFS_FSW`

Do not silently assume truth-fed quantities are already valid estimator outputs.

### 5. Record architecture blockers

If any requirement depends on an unresolved design choice, record it explicitly in `blocking_architecture_questions.json`.

Examples:

- exact lunar orbit navigation source inside fixed `CFS_FSW`
- exact relative-geometry source and estimation boundary in `link_alignment`
- exact target-geometry source in `target_track`
- exact safe/detumble wheel-plus-thruster assist policy

Blockers do not invalidate the planner. The planner must still map the rest of the system cleanly.

### 6. Separate extension boundaries

Produce a dedicated truth-model boundary artifact that states:

- what can be implemented entirely inside fixed `CFS_FSW`
- what requires modifications to `sim/42_baseline/Include/42types.h`, `sim/42_baseline/Source/42init.c`, `sim/42_baseline/Source/42sensors.c`, `sim/42_baseline/Source/42actuators.c`, or `sim/42_baseline/Source/42joints.c`
- what can be bridged temporarily with surrogates versus what cannot

## Output Contract

Produce:

- `fsw_architecture_plan.md`
- `file_change_map.json`
- `blocking_architecture_questions.json`
- `truth_model_extension_boundary.json`

The architecture plan must map every required mode, transition family, control family, sensor contract, and actuator contract to concrete file ownership or explicit extension boundaries.

## Stop Conditions

Stop and ask for clarification if:

- the extracted FSW package is missing one of the required three core artifacts
- required modes and transition logic are mutually inconsistent
- a requirement cannot be classified as `cfs_fsw_internal`, `truth_model_extension`, or `cross_boundary`
- the user asks for code implementation rather than planning

## Self-Review

Before handoff, check:

1. Does every mode in `mode_table.json` appear in `fsw_architecture_plan.md`?
2. Does every transition family have an owning file or explicit blocker?
3. Does every sensor and actuator contract have an owning file or explicit extension boundary?
4. Are truth-model extensions kept separate from ordinary `CFS_FSW` edits?
5. Are all unresolved implementation choices listed in `blocking_architecture_questions.json` instead of being silently guessed?

Fix issues inline before declaring architecture planning complete.

## Boundaries

Do not:

- modify `fsw/overlay/Source/AcSensors.c`, `fsw/overlay/Source/AcControl.c`, `fsw/overlay/Source/AcMode.c`, `fsw/overlay/Source/AcStateMachine.c`, or `fsw/overlay/Source/AcActuators.c`
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
