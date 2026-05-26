---
name: fsw-code-author
description: Implement planned fixed CFS_FSW changes from fsw-architecture-planner in concrete 42 source files, sidecar optical-link modules, and build metadata. Use after fsw-architecture-planner when blockers are resolved and the user wants real code changes rather than more planning.
---

# FSW Code Author

## Overview

Use this skill after `fsw-architecture-planner` has already mapped requirements onto concrete files. Its job is to implement that plan in the repository, keep edits bounded to the planned ownership files, and leave the codebase in a compilable state.

This skill writes code. It is the implementation stage between architecture planning and runtime diagnosis.

<HARD-GATE>
Do not invent architecture while implementing. If `blocking_architecture_questions.json` still contains unresolved blockers that affect the requested scope, stop and surface the blocker instead of silently choosing an implementation.
</HARD-GATE>

## When to Use

Use this skill when:

- `fsw-architecture-planner` output already exists
- the user wants actual `CFS_FSW` code changes
- the file ownership map is known
- the requested work is implementation, not further planning

## Inputs

Required:

- `fsw_architecture_plan.md`
- `file_change_map.json`
- `blocking_architecture_questions.json`
- `truth_model_extension_boundary.json`

Recommended:

- `fsw_requirement_spec.md`
- `mode_table.json`
- `sensor_actuator_contract.json`
- `scenario_facts.json`
- `capability_assessment.json`

Optional:

- current case configuration files
- prior implementation notes

## Required Local Context

Read `references/repo-sources.md` first.

Workspace-local case layout and writable-boundary rules are governed by `WORKSPACE_RULES_FOR_AI.md` at the current workspace root.

Default planning context:

- `knowledge/42/cfs_fsw_architecture.md`
- `knowledge/42/cfs_fsw_interfaces.md`
- `knowledge/42/cfs_fsw_extension_rules.md`
- `knowledge/42/limitations.md`

Default source scope:

- `fsw/overlay/Source/AcSensors.c`
- `fsw/overlay/Source/AcControl.c`
- `fsw/overlay/Source/AcMode.c`
- `fsw/overlay/Source/AcStateMachine.c`
- `fsw/overlay/Source/AcActuators.c`

Read these when the architecture plan explicitly routes work through the optical-link sidecar path:

- `bridge/mission_bypass/Source/AcOpticalPayload.c`
- `bridge/mission_bypass/Source/AcOpticalLink.c`
- `bridge/mission_bypass/Include/AcOpticalPayload.h`
- `fsw/overlay/Include/AcFswModules.h`

Only read native 42 files such as `sim/42_baseline/Source/42init.c`, `sim/42_baseline/Source/42sensors.c`, `sim/42_baseline/Source/42joints.c`, or `sim/42_baseline/Include/42types.h` when `truth_model_extension_boundary.json` explicitly puts them in scope.

## Workflow

## Required Checklist

Complete these in order:

1. Verify that the architecture package exists and the intended scope has no unresolved blockers.
2. Convert the file-change map into a bounded implementation ownership list.
3. Implement fixed `CFS_FSW` and approved sidecar changes without drifting outside planned boundaries.
4. Update public declarations and build wiring as needed.
5. Compile the affected build and record results.
6. Emit implementation artifacts and self-review them against the plan.

### 1. Confirm implementation scope

Before editing, classify planned work as one of:

- `cfs_fsw_internal`
- `sidecar_optical_link`
- `native_truth_model_extension`

If the user asked only for fixed `CFS_FSW` implementation, do not silently expand into native truth-model work.

### 2. Implement only planned ownership files

Use `file_change_map.json` as the ownership source of truth.

Typical file ownership:

- modes and mode labels -> `fsw/overlay/Source/AcMode.c`
- mode transitions and phase progression -> `fsw/overlay/Source/AcStateMachine.c`
- attitude or payload control laws -> `fsw/overlay/Source/AcControl.c`
- sensor preprocessing and feed-in -> `fsw/overlay/Source/AcSensors.c`
- actuator command allocation -> `fsw/overlay/Source/AcActuators.c`
- optical sidecar and optical-link supervisor -> `bridge/mission_bypass/Source/AcOpticalPayload.c`, `bridge/mission_bypass/Source/AcOpticalLink.c`

If a needed edit falls outside the mapped files, stop and surface the mismatch instead of improvising.

### 3. Keep implementation boundaries clean

Use:

- fixed `CFS_FSW` files for spacecraft control logic
- sidecar files for optical payload middleware and optical-link supervisor
- native 42 files only when truth-model extension is explicitly in scope

Do not hide native truth-model edits inside ordinary `CFS_FSW` implementation.

### 4. Compile before handoff

Run the narrowest meaningful compile step after implementation.

Preferred baseline:

- `make -j4`

If the build succeeds, record that result. If it fails, diagnose the failure before handoff.

### 5. Emit implementation artifacts

Produce:

- `fsw_code_author_report.md`
- `fsw_change_set.json`

The report should summarize:

- implemented files
- intentionally untouched planned files
- compile status
- remaining risks or deferred items

The JSON should summarize:

- changed files
- implementation scope classification
- compile status
- unresolved items

## Output Contract

Produce:

- code changes in the owned source files
- `fsw_code_author_report.md`
- `fsw_change_set.json`

## Stop Conditions

Stop and ask for clarification if:

- `blocking_architecture_questions.json` contains unresolved items that affect the requested scope
- a required change falls outside the mapped ownership files
- implementation requires native truth-model edits that the plan marked out of scope
- the upstream requirement package and architecture plan contradict each other

## Self-Review

Before handoff, check:

1. Does every changed file appear in `file_change_map.json` or an explicitly allowed boundary?
2. Were unresolved blockers kept unresolved instead of being silently guessed?
3. Are sidecar optical-link edits kept separate from native 42 truth-model edits?
4. Does the build compile?
5. Do the implementation artifacts accurately reflect what changed?

Fix issues inline before declaring implementation complete.

## Boundaries

Do not:

- rewrite architecture decisions that belong in `fsw-architecture-planner`
- silently modify native 42 files when only fixed `CFS_FSW` work was planned
- skip compilation
- claim runtime behavior is verified; that belongs to `42-build-run-diagnose`

The next downstream stage is typically:

- `42-build-run-diagnose` to collect runtime evidence
- then `fsw-tuning-reviewer` if the code runs but the behavior or metrics are still wrong

Treat `fsw-tuning-reviewer` as the bounded review loop that feeds the next `fsw-code-author` iteration.

## Terminal State

The terminal state is a bounded set of implemented source changes plus implementation artifacts, with the codebase compiling and ready for runtime validation.
