# Skill Spec: fsw-code-author

## Goal

Implement planned complete-GNC fixed `CFS_FSW` changes from the architecture package into concrete repository code, keep edits bounded to planned ownership files, and leave the codebase compiling.

This skill is the implementation stage after `fsw-architecture-planner`.

## Core Inputs

Required:

- `fsw_architecture_plan.md`
- `file_change_map.json`
- `blocking_architecture_questions.json`
- `truth_model_extension_boundary.json`

Recommended:

- `fsw_requirement_spec.md`
- `mode_table.json`
- `sensor_actuator_contract.json`

## Core Outputs

- code changes in planned ownership files
- `fsw_code_author_report.md`
- `fsw_change_set.json`

Recommended JSON shape:

```json
{
  "implementation_scope": [
    "cfs_fsw_internal",
    "sidecar_optical_link"
  ],
  "changed_files": [],
  "compile_status": "success",
  "implemented_ownership_groups": [],
  "deferred_ownership_groups": [],
  "files_by_ownership_group": {},
  "unresolved_items": []
}
```

## Scope Classification

Every implementation item should be classified as one of:

- `cfs_fsw_internal`
- `sidecar_optical_link`
- `native_truth_model_extension`

If the user requested only fixed `CFS_FSW` work, do not silently expand into native truth-model edits.

## Default Ownership Files

Typical implementation ownership:

- `Source/AcMode.c`
- `Source/AcStateMachine.c`
- `Source/AcControl.c`
- `Source/AcSensors.c`
- `Source/AcActuators.c`

Sidecar optical-link ownership:

- `Source/AcOpticalPayload.c`
- `Source/AcOpticalLink.c`
- `Include/AcOpticalPayload.h`
- `Include/AcFswModules.h`

Native 42 ownership only when explicitly in scope:

- `Source/42init.c`
- `Source/42sensors.c`
- `Source/42joints.c`
- `Include/42types.h`

## Required Behavior

The skill must:

1. verify blockers before editing
2. verify that `file_change_map.json` contains the complete-GNC ownership groups from `fsw-architecture-planner`
3. restrict edits to mapped ownership files
4. implement or explicitly defer mapped groups such as mode, transition, pass-criteria, sensor, actuator, control-target, guidance-rate, target-frame, target-attitude, target-vector/LOS, and command-output ownership
5. keep sidecar optical-link work separate from native 42 truth-model work
6. compile the code after implementation
7. emit an implementation report and change-set summary

## Stop Conditions

Stop and surface a blocker if:

- `blocking_architecture_questions.json` still contains unresolved blockers in the requested scope
- a required implementation falls outside the mapped ownership files
- `file_change_map.json` lacks a complete-GNC ownership group needed by the requested implementation scope
- an ownership group is too vague to implement deterministically, such as missing target frame, target attitude, guidance rate, command output, or pass criteria
- the plan says native truth-model work is out of scope but implementation would require it
- architecture outputs contradict upstream FSW requirements

## Success Criteria

The skill is successful when:

1. the planned source changes are implemented in the correct files
2. each implemented change traces to a complete-GNC ownership group in `file_change_map.json`
3. deferred ownership groups are explicit
4. the code compiles
5. sidecar versus native-truth-model boundaries remain explicit
6. downstream build/load/run smoke testing can proceed through `42-build-run-diagnose`
