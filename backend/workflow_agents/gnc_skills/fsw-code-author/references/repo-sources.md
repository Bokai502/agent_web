# Repo Sources

Use this reference as the entry map for `fsw-code-author`.

## Primary spec

- `knowledge/skills/fsw-code-author-spec.md`

## Upstream architecture package

- `cases/<mission>/06_fsw_architecture/fsw_architecture_plan.md`
- `cases/<mission>/06_fsw_architecture/file_change_map.json`
- `cases/<mission>/06_fsw_architecture/blocking_architecture_questions.json`
- `cases/<mission>/06_fsw_architecture/truth_model_extension_boundary.json`

## Upstream extracted FSW package

- `cases/<mission>/05_fsw_requirements/fsw_requirement_spec.md`
- `cases/<mission>/05_fsw_requirements/mode_table.json`
- `cases/<mission>/05_fsw_requirements/sensor_actuator_contract.json`

## Recommended supporting case artifacts

- `cases/<mission>/02_scenario/scenario_facts.json`
- `cases/<mission>/03_capability/capability_assessment.json`
- `cases/<mission>/04_config/generated_config_manifest.json`

## Primary 42 knowledge

- `knowledge/42/cfs_fsw_architecture.md`
- `knowledge/42/cfs_fsw_interfaces.md`
- `knowledge/42/cfs_fsw_extension_rules.md`
- `knowledge/42/limitations.md`

## Default implementation files

- `fsw/overlay/Source/AcSensors.c`
- `fsw/overlay/Source/AcControl.c`
- `fsw/overlay/Source/AcMode.c`
- `fsw/overlay/Source/AcStateMachine.c`
- `fsw/overlay/Source/AcActuators.c`

## Sidecar optical-link implementation files

- `bridge/mission_bypass/Source/AcOpticalPayload.c`
- `bridge/mission_bypass/Source/AcOpticalLink.c`
- `bridge/mission_bypass/Include/AcOpticalPayload.h`
- `fsw/overlay/Include/AcFswModules.h`

## Native 42 files only when explicitly in scope

- `sim/42_baseline/Source/42init.c`
- `sim/42_baseline/Source/42sensors.c`
- `sim/42_baseline/Source/42joints.c`
- `sim/42_baseline/Include/42types.h`

## Intended outputs

- code changes in owned files
- `fsw_code_author_report.md`
- `fsw_change_set.json`
