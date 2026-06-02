# Repo Sources

Use this reference as the entry map for `fsw-architecture-planner`.

## Primary spec

- `knowledge/skills/fsw-architecture-planner-spec.md`

## Upstream extracted FSW artifact bundle

- `workspace_dir/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`
- `workspace_dir/AIGNC_Workflow/05_fsw_requirements/mode_table.json`
- `workspace_dir/AIGNC_Workflow/05_fsw_requirements/sensor_actuator_contract.json`

The planner must consume the complete-GNC fields produced by `fsw-requirements-extractor`: mode sequence, entry/exit/fallback transitions, per-mode sensor and actuator configuration, control method, control target, guidance rate, target frame, target attitude, target vector/LOS, command outputs, and pass criteria. Missing fields become architecture blockers unless the upstream requirement artifact bundle already records them as unresolved questions.

## Recommended supporting case artifacts

- `workspace_dir/AIGNC_Workflow/02_scenario/scenario_facts.json`
- `workspace_dir/AIGNC_Workflow/03_capability/capability_assessment.json`
- `workspace_dir/AIGNC_Workflow/04_config/generated_config_manifest.json`

## Primary 42 knowledge

- `knowledge/42/cfs_fsw_architecture.md`
- `knowledge/42/cfs_fsw_interfaces.md`
- `knowledge/42/cfs_fsw_extension_rules.md`
- `knowledge/42/limitations.md`

## Structured indexes

- `knowledge/42/capabilities/cfs_fsw_architecture.json`
- `knowledge/42/capabilities/cfs_fsw_interfaces.json`
- `knowledge/42/capabilities/cfs_fsw_extension_rules.json`

## Source files for ownership checks

- `workspace_dir/00_inputs/FSW/ADCS/src/AcSensors.c`
- `workspace_dir/00_inputs/FSW/ADCS/src/AcControl.c`
- `workspace_dir/00_inputs/FSW/ADCS/src/AcMode.c`
- `workspace_dir/00_inputs/FSW/ADCS/src/AcStateMachine.c`
- `workspace_dir/00_inputs/FSW/ADCS/src/AcActuators.c`

## Intended outputs

- `workspace_dir/AIGNC_Workflow/06_fsw_architecture/fsw_architecture_plan.md`
- `workspace_dir/AIGNC_Workflow/06_fsw_architecture/file_change_map.json`
- `workspace_dir/AIGNC_Workflow/06_fsw_architecture/blocking_architecture_questions.json`
- `workspace_dir/AIGNC_Workflow/06_fsw_architecture/truth_model_extension_boundary.json`

`file_change_map.json` must provide machine-readable coverage for mode ownership, transition ownership, pass-criteria ownership, sensor interface ownership, actuator interface ownership, control target ownership, guidance-rate ownership, target-frame ownership, target-attitude ownership, target-vector/LOS ownership, command-output ownership, and extension-boundary items.
