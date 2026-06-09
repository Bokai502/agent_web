---
name: fsw-code-author
description: Implement planned complete-GNC fixed CFS_FSW changes from fsw-architecture-planner in concrete 42 source files, sidecar optical-link modules, and build metadata. Use after fsw-architecture-planner when blockers are resolved and the user wants real code changes rather than more planning.
---

# FSW Code Author

## Path Contract

- `<workspace>` means the backend-injected `workspace_dir`; this skill must use `workspace_dir` as the only source for the active working directory.
- Shared skills live under `open_codex_web/backend/workflow_agents/gnc_skills/skills/`.
- Shared knowledge lives under `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/`.
- Shared 42, bridge, and reference resources live under `codex_web/AIGNC/42/`, `codex_web/AIGNC/bridge/`, and `codex_web/AIGNC/ref/`.


## Overview

Use this skill after `fsw-architecture-planner` has already mapped complete GNC requirements onto concrete files. Its job is to implement that plan in the repository, keep edits bounded to the planned ownership files, and leave the codebase in a compilable state.

This skill writes code. It is the implementation stage between architecture planning and runtime diagnosis.

<HARD-GATE>
Do not invent architecture while implementing. If `<workspace>/AIGNC_Workflow/06_fsw_architecture/blocking_architecture_questions.json` still contains unresolved blockers that affect the requested scope, stop and surface the blocker instead of silently choosing an implementation.
</HARD-GATE>

## When to Use

Use this skill when:

- `fsw-architecture-planner` output already exists
- the user wants actual `CFS_FSW` code changes
- the file ownership map is known
- the requested work is implementation, not further planning

## Inputs

Required:

- `<workspace>/AIGNC_Workflow/06_fsw_architecture/fsw_architecture_plan.md`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/file_change_map.json`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/blocking_architecture_questions.json`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/truth_model_extension_boundary.json`

Recommended:

- `<workspace>/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/mode_table.json`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/sensor_actuator_contract.json`
- `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`
- `<workspace>/AIGNC_Workflow/03_capability/capability_assessment.json`

Optional:

- current workspace configuration files
- prior implementation notes

## Required Local Context

Read `open_codex_web/backend/workflow_agents/gnc_skills/skills/fsw-code-author/references/repo-sources.md` first.

Workspace-local layout and writable-boundary rules are governed by `codex_web/AIGNC/AGENT.md`.

Default planning context:

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_interfaces.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_extension_rules.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`

Default source scope:

- `<workspace>/FSW/ADCS/src/AcSensors.c`
- `<workspace>/FSW/ADCS/src/AcControl.c`
- `<workspace>/FSW/ADCS/src/AcMode.c`
- `<workspace>/FSW/ADCS/src/AcStateMachine.c`
- `<workspace>/FSW/ADCS/src/AcActuators.c`

Read these when the architecture plan explicitly routes work through the optical-link sidecar path:

- `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalPayload.c`
- `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalLink.c`
- `codex_web/AIGNC/bridge/mission_bypass/Include/AcOpticalPayload.h`
- `<workspace>/FSW/ADCS/include/AcFswModules.h`

Files under `codex_web/AIGNC/bridge/` may be read for context, but must not be modified unless the user explicitly approves bridge changes in the current task.

Only read native 42 files such as `codex_web/AIGNC/42/Source/42init.c`, `codex_web/AIGNC/42/Source/42sensors.c`, `codex_web/AIGNC/42/Source/42joints.c`, or `codex_web/AIGNC/42/Include/42types.h` when `<workspace>/AIGNC_Workflow/06_fsw_architecture/truth_model_extension_boundary.json` explicitly puts them in scope. These files are read-only unless the user explicitly approves simulator-platform changes.

## Workflow

## Required Checklist

Complete these in order:

1. Verify that the architecture package exists, the intended scope has no unresolved blockers, and `file_change_map.json` contains the complete-GNC ownership groups required by `fsw-architecture-planner`.
2. Convert the file-change map into a bounded implementation ownership list grouped by mode, transition, pass criteria, sensors, actuators, control targets, guidance rates, target frames, target attitudes, target vectors/LOS, and command outputs.
3. Implement fixed `CFS_FSW` and approved sidecar changes without drifting outside planned boundaries.
4. Update public declarations and build wiring as needed.
5. Compile the affected build and record results.
6. Emit implementation artifacts and self-review them against the plan and every complete-GNC ownership group.

### 1. Confirm implementation scope

Before editing, classify planned work as one of:

- `cfs_fsw_internal`
- `sidecar_optical_link`
- `native_truth_model_extension`

If the user asked only for fixed `CFS_FSW` implementation, do not silently expand into native truth-model work.

### 2. Implement only planned ownership files

Use `<workspace>/AIGNC_Workflow/06_fsw_architecture/file_change_map.json` as the ownership source of truth. It must include the ownership groups produced by the updated `fsw-architecture-planner`:

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

Typical file ownership:

- modes, mode labels, mode metadata, and target descriptors -> `<workspace>/FSW/ADCS/src/AcMode.c`
- mode transitions, phase progression, fallback paths, dwell/timeout tracking, and pass/fail routing -> `<workspace>/FSW/ADCS/src/AcStateMachine.c`
- pass-criteria helper calculations -> `<workspace>/FSW/ADCS/src/AcMode.c` or `<workspace>/FSW/ADCS/src/AcStateMachine.c`, exactly as mapped
- target attitude construction, target frame handling, target vector/LOS handling, guidance-rate feedforward, attitude/rate errors, and control laws -> `<workspace>/FSW/ADCS/src/AcControl.c` unless the map assigns metadata to `AcMode.c`
- sensor preprocessing, validity gates, fallback sensor selection, and estimator/truth-state feed-in -> `<workspace>/FSW/ADCS/src/AcSensors.c`
- actuator command outputs, command limiting, allocation, enable/inhibit rules, saturation handling, and dispatch -> `<workspace>/FSW/ADCS/src/AcActuators.c`
- optical sidecar and optical-link supervisor -> `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalPayload.c`, `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalLink.c`, only after explicit user approval for `codex_web/AIGNC/bridge/` edits

If a needed edit falls outside the mapped files, or if a complete-GNC ownership group is missing or too vague to implement deterministically, stop and surface the mismatch instead of improvising.

### 3. Keep implementation boundaries clean

Use:

- fixed `CFS_FSW` files for spacecraft control logic
- sidecar files for optical payload middleware and optical-link supervisor
- native 42 files only when truth-model extension is explicitly in scope

Do not hide native truth-model edits inside ordinary `CFS_FSW` implementation.

### 4. Compile before handoff

Run the narrowest meaningful compile step after implementation.

Preferred baseline:

- `python3 <workspace>/Script/build_42.py --headless`

The build script must compile through the workspace-local run directory: Makefile and working directory `<workspace>/Output/Run/`, object files `<workspace>/Output/Run/build/`, and the platform-selected simulator executable under `<workspace>/Output/Run/`. Do not expect root-level `Makefile`, root-level simulator executables, or `codex_web/AIGNC/42/Object/` outputs.

If the build succeeds, record that result. If it fails, diagnose the failure before handoff.

### 5. Emit implementation artifacts

Produce implementation reports under `<workspace>/AIGNC_Workflow/07_fsw_implementation/`:

- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_code_author_report.md`
- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_change_set.json`

Append step-level status entries to `<workspace>/AIGNC_Workflow/workflow_log.md` when this skill starts, after implementation-scope verification, blocker review, each bounded source-edit group, declaration/build-wiring update, build execution, build diagnosis if needed, implementation artifact writing, and final handoff to runtime diagnosis. Entries must use stage `07_fsw_implementation`, current skill `fsw-code-author`, step id or step name, status, timestamp, concise description, key inputs checked, outputs updated, and next action or handoff target. Do not log private reasoning.
Structured progress must also be updated in `<workspace>/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>`, matching the numbered stage used for `<workspace>/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the stage run. Keep the current skill name in the `--skill` field instead of embedding it in the loop name. Set `--note` to one concise frontend-display sentence, no more than 160 characters, describing the current action, blocker, failure, or completion result for the stage.


The report should summarize:

- implemented files
- implemented ownership groups from `file_change_map.json`
- intentionally untouched planned files and deferred ownership groups
- compile status
- remaining risks or deferred items

The JSON should summarize:

- changed files
- implementation scope classification
- compile status
- implemented ownership groups
- deferred ownership groups
- source files touched per ownership group
- unresolved items

## Output Contract

Produce:

- code changes in the owned source files
- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_code_author_report.md`
- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_change_set.json`

## Stop Conditions

Stop and ask for clarification if:

- `<workspace>/AIGNC_Workflow/06_fsw_architecture/blocking_architecture_questions.json` contains unresolved items that affect the requested scope
- a required change falls outside the mapped ownership files
- `file_change_map.json` lacks a required complete-GNC ownership group for the requested implementation scope
- an ownership group is too vague to implement deterministically, such as missing target frame, target attitude, guidance-rate, command-output, or pass-criteria ownership
- implementation requires native truth-model edits that the plan marked out of scope
- the upstream requirement package and architecture plan contradict each other

## Self-Review

Before handoff, check:

1. Does every changed file appear in `<workspace>/AIGNC_Workflow/06_fsw_architecture/file_change_map.json` or an explicitly allowed boundary?
2. Does every implemented complete-GNC ownership group trace back to `file_change_map.json`?
3. Were unresolved blockers kept unresolved instead of being silently guessed?
4. Are sidecar optical-link edits kept separate from native 42 truth-model edits?
5. Does the build compile?
6. Do the implementation artifacts accurately reflect what changed and which ownership groups remain deferred?

Fix issues inline before declaring implementation complete.

## Boundaries

Do not:

- rewrite architecture decisions that belong in `fsw-architecture-planner`
- silently modify native 42 files when only fixed `CFS_FSW` work was planned
- skip compilation
- claim runtime behavior is verified; that belongs to `42-build-run-diagnose`

The next downstream stage is typically `42-build-run-diagnose` for build/load/run smoke testing. That downstream stage only verifies that the case compiles, loads, runs to normal completion, and emits basic outputs; it is not a behavior or performance verdict. Route to `fsw-tuning-reviewer` only if the user explicitly requests a post-run FSW behavior or performance review from runtime evidence.

## Terminal State

The terminal state is a bounded set of implemented source changes plus implementation artifacts, with the codebase compiling and ready for runtime validation.

