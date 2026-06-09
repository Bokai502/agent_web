# Repo Sources

Use this reference as the entry map for `fsw-tuning-reviewer`.

## Primary spec

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/skills/fsw-tuning-reviewer-spec.md`

## Reusable post-run plotting skill

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/42-runtime-plotter/`

## Upstream runtime evidence

- `<workspace>/AIGNC_Workflow/08_run/run_report.md`
- `<workspace>/AIGNC_Workflow/08_run/run_summary.json`

## Recommended upstream FSW implementation package

- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_code_author_report.md`
- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_change_set.json`

## Recommended upstream architecture package

- `<workspace>/AIGNC_Workflow/06_fsw_architecture/fsw_architecture_plan.md`
- `<workspace>/AIGNC_Workflow/06_fsw_architecture/file_change_map.json`

## Recommended upstream FSW requirements package

- `<workspace>/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/mode_table.json`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/sensor_actuator_contract.json`

## Primary 42 knowledge

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_interfaces.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_extension_rules.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`

## Default source files for review

- `<workspace>/FSW/ADCS/src/AcSensors.c`
- `<workspace>/FSW/ADCS/src/AcControl.c`
- `<workspace>/FSW/ADCS/src/AcMode.c`
- `<workspace>/FSW/ADCS/src/AcStateMachine.c`
- `<workspace>/FSW/ADCS/src/AcActuators.c`

## Optical-link sidecar review files when relevant

- `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalPayload.c`
- `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalLink.c`
- `codex_web/AIGNC/bridge/mission_bypass/Include/AcOpticalPayload.h`
- `<workspace>/FSW/ADCS/include/AcFswModules.h`

## Native 42 definition files when consistency or validity checks require them

- `codex_web/AIGNC/42/Source/42sensors.c`
- `codex_web/AIGNC/42/Source/42actuators.c`
- `codex_web/AIGNC/42/Source/42joints.c`
- `codex_web/AIGNC/42/Include/42types.h`

## Runtime and configuration artifacts to cross-check intent and validity

- final config under `<workspace>/Config/`
- AI-generated config under `<workspace>/AIGNC_Workflow/04_config/`
- runtime logs and plots under `<workspace>/Output/Run/runtime_case/InOut/`

## Intended outputs

- `<workspace>/AIGNC_Workflow/09_tuning_review/fsw_tuning_review.md`
- `<workspace>/AIGNC_Workflow/09_tuning_review/fsw_tuning_hypotheses.json`
