# Repo Sources

Use this reference as the entry map for `fsw-tuning-reviewer`.

## Primary spec

- `knowledge/skills/fsw-tuning-reviewer-spec.md`

## Reusable post-run plotting skill

- `skills/42-runtime-plotter/`

## Upstream runtime evidence

- `workspace_dir/AIGNC_Workflow/08_run/run_report.md`
- `workspace_dir/AIGNC_Workflow/08_run/run_summary.json`

## Recommended upstream FSW implementation package

- `workspace_dir/AIGNC_Workflow/07_fsw_implementation/fsw_code_author_report.md`
- `workspace_dir/AIGNC_Workflow/07_fsw_implementation/fsw_change_set.json`

## Recommended upstream architecture artifact bundle

- `workspace_dir/AIGNC_Workflow/06_fsw_architecture/fsw_architecture_plan.md`
- `workspace_dir/AIGNC_Workflow/06_fsw_architecture/file_change_map.json`

## Recommended upstream FSW requirements package

- `workspace_dir/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`
- `workspace_dir/AIGNC_Workflow/05_fsw_requirements/mode_table.json`
- `workspace_dir/AIGNC_Workflow/05_fsw_requirements/sensor_actuator_contract.json`

## Primary 42 knowledge

- `knowledge/42/cfs_fsw_architecture.md`
- `knowledge/42/cfs_fsw_interfaces.md`
- `knowledge/42/cfs_fsw_extension_rules.md`
- `knowledge/42/limitations.md`

## Default source files for review

- `workspace_dir/00_inputs/FSW/ADCS/src/AcSensors.c`
- `workspace_dir/00_inputs/FSW/ADCS/src/AcControl.c`
- `workspace_dir/00_inputs/FSW/ADCS/src/AcMode.c`
- `workspace_dir/00_inputs/FSW/ADCS/src/AcStateMachine.c`
- `workspace_dir/00_inputs/FSW/ADCS/src/AcActuators.c`

## Optical-link sidecar review files when relevant

- `bridge/mission_bypass/Source/AcOpticalPayload.c`
- `bridge/mission_bypass/Source/AcOpticalLink.c`
- `bridge/mission_bypass/Include/AcOpticalPayload.h`
- `workspace_dir/00_inputs/FSW/ADCS/include/AcFswModules.h`

## Native 42 definition files when consistency or validity checks require them

- `42/Source/42sensors.c`
- `42/Source/42actuators.c`
- `42/Source/42joints.c`
- `42/Include/42types.h`

## Runtime and configuration artifacts to cross-check intent and validity

- final config under `workspace_dir/00_inputs/Config/`
- AI-generated config under `workspace_dir/AIGNC_Workflow/04_config/`
- runtime logs and plots under `workspace_dir/02_sim/42_run/runtime_case/InOut/`

## Intended outputs

- `workspace_dir/AIGNC_Workflow/09_tuning_review/fsw_tuning_review.md`
- `workspace_dir/AIGNC_Workflow/09_tuning_review/fsw_tuning_hypotheses.json`
