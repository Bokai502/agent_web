# Repo Sources

Use this reference as the entry map for `fsw-code-author`.

## Primary spec

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/skills/fsw-code-author-spec.md`

## Upstream architecture package

- `<workspace>/AIGNC_Workflow/06_fsw_architecture/fsw_architecture_plan.md`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/file_change_map.json`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/blocking_architecture_questions.json`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/truth_model_extension_boundary.json`

`file_change_map.json` is the implementation source of truth and must be consumed by ownership group, not only by filename. Expected groups include `mode_ownership`, `transition_ownership`, `pass_criteria_ownership`, `sensor_interface_ownership`, `actuator_interface_ownership`, `control_target_ownership`, `guidance_rate_ownership`, `target_frame_ownership`, `target_attitude_ownership`, `target_vector_or_los_ownership`, `command_output_ownership`, and `extension_boundary_items`. If a requested implementation depends on a missing or vague group, return to `fsw-architecture-planner` instead of inventing the mapping.

## Upstream extracted FSW package

- `<workspace>/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/mode_table.json`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/sensor_actuator_contract.json`

## Recommended supporting case artifacts

- `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`
- `<workspace>/AIGNC_Workflow/03_capability/capability_assessment.json`
- `<workspace>/AIGNC_Workflow/04_config/generated_config_manifest.json`

## Primary 42 knowledge

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_interfaces.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_extension_rules.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`

## Default implementation files

- `<workspace>/FSW/ADCS/src/AcSensors.c`
- `<workspace>/FSW/ADCS/src/AcControl.c`
- `<workspace>/FSW/ADCS/src/AcMode.c`
- `<workspace>/FSW/ADCS/src/AcStateMachine.c`
- `<workspace>/FSW/ADCS/src/AcActuators.c`

## Sidecar optical-link implementation files

- `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalPayload.c`
- `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalLink.c`
- `codex_web/AIGNC/bridge/mission_bypass/Include/AcOpticalPayload.h`
- `<workspace>/FSW/ADCS/include/AcFswModules.h`

## Native 42 files only when explicitly in scope

- `codex_web/AIGNC/42/Source/42init.c`
- `codex_web/AIGNC/42/Source/42sensors.c`
- `codex_web/AIGNC/42/Source/42joints.c`
- `codex_web/AIGNC/42/Include/42types.h`

## Intended outputs

- code changes in owned files
- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_code_author_report.md`
- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_change_set.json`

The report and JSON must identify implemented ownership groups, deferred ownership groups, files touched per ownership group, compile status, and unresolved items.
