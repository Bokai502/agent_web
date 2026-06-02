# Repo Sources

Use this reference as the entry map for `fsw-requirements-extractor`.

## Primary spec

- `knowledge/skills/fsw-requirements-extractor-spec.md`

## Primary 42 knowledge

- `knowledge/42/cfs_fsw_architecture.md`
- `knowledge/42/cfs_fsw_interfaces.md`
- `knowledge/42/cfs_fsw_extension_rules.md`
- `knowledge/42/sensors.md`
- `knowledge/42/actuators.md`
- `knowledge/42/limitations.md`

## Structured indexes

- `knowledge/42/capabilities/cfs_fsw_architecture.json`
- `knowledge/42/capabilities/cfs_fsw_interfaces.json`
- `knowledge/42/capabilities/cfs_fsw_extension_rules.json`
- `knowledge/42/capabilities/sensors.json`
- `knowledge/42/capabilities/actuators.json`

## Detail layer

Use detailed sensor or actuator schemas only when requirement extraction depends on a concrete interface field or configuration limitation.

## Intended outputs

- `workspace_dir/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`
- `workspace_dir/AIGNC_Workflow/05_fsw_requirements/mode_table.json`
- `workspace_dir/AIGNC_Workflow/05_fsw_requirements/sensor_actuator_contract.json`

These outputs must jointly describe the complete fixed-FSW GNC process: mode-switching sequence and conditions, per-mode sensor and actuator configuration, per-mode control method, control target, pointing guidance rate, target attitude/frame/vector, command outputs, and per-mode pass/completion criteria. Missing per-mode fields must become blocking questions rather than implicit assumptions.
