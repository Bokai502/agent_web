# Repo Sources

Use this reference as the entry map for `fsw-tuning-reviewer`.

## Primary spec

- `knowledge/skills/fsw-tuning-reviewer-spec.md`

## Reusable post-run plotting skill

- `skills/42-runtime-plotter/`

## Upstream runtime evidence

- `cases/<mission>/08_run/run_report.md`
- `cases/<mission>/08_run/run_summary.json`

## Recommended upstream FSW implementation package

- `cases/<mission>/07_fsw_implementation/fsw_code_author_report.md`
- `cases/<mission>/07_fsw_implementation/fsw_change_set.json`

## Recommended upstream architecture package

- `cases/<mission>/06_fsw_architecture/fsw_architecture_plan.md`
- `cases/<mission>/06_fsw_architecture/file_change_map.json`

## Recommended upstream FSW requirements package

- `cases/<mission>/05_fsw_requirements/fsw_requirement_spec.md`
- `cases/<mission>/05_fsw_requirements/mode_table.json`
- `cases/<mission>/05_fsw_requirements/sensor_actuator_contract.json`

## Primary 42 knowledge

- `knowledge/42/cfs_fsw_architecture.md`
- `knowledge/42/cfs_fsw_interfaces.md`
- `knowledge/42/cfs_fsw_extension_rules.md`
- `knowledge/42/limitations.md`

## Default source files for review

- `fsw/overlay/Source/AcSensors.c`
- `fsw/overlay/Source/AcControl.c`
- `fsw/overlay/Source/AcMode.c`
- `fsw/overlay/Source/AcStateMachine.c`
- `fsw/overlay/Source/AcActuators.c`

## Optical-link sidecar review files when relevant

- `bridge/mission_bypass/Source/AcOpticalPayload.c`
- `bridge/mission_bypass/Source/AcOpticalLink.c`
- `bridge/mission_bypass/Include/AcOpticalPayload.h`
- `fsw/overlay/Include/AcFswModules.h`

## Native 42 definition files when consistency or validity checks require them

- `sim/42_baseline/Source/42sensors.c`
- `sim/42_baseline/Source/42actuators.c`
- `sim/42_baseline/Source/42joints.c`
- `sim/42_baseline/Include/42types.h`

## Runtime and configuration artifacts to cross-check intent and validity

- `cases/<mission>/04_config/`
- `cases/<mission>/08_run/`
- runtime `InOut/` logs and plots

## Intended outputs

- `fsw_tuning_review.md`
- `fsw_tuning_hypotheses.json`
