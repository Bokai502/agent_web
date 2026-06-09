# Repo Sources

Use this reference as the entry map for `fsw-requirements-extractor`.

## Primary spec

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/skills/fsw-requirements-extractor-spec.md`

## Primary 42 knowledge

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_interfaces.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_extension_rules.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`

## Structured indexes

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_architecture.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_interfaces.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_extension_rules.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/sensors.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/actuators.json`

## Detail layer

Use detailed sensor or actuator schemas only when requirement extraction depends on a concrete interface field or configuration limitation.

## Intended outputs

- `<workspace>/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/mode_table.json`
- `<workspace>/AIGNC_Workflow/05_fsw_requirements/sensor_actuator_contract.json`

These outputs must jointly describe the complete fixed-FSW GNC process: mode-switching sequence and conditions, per-mode sensor and actuator configuration, per-mode control method, control target, pointing guidance rate, target attitude/frame/vector, command outputs, and per-mode pass/completion criteria. Missing per-mode fields must become blocking questions rather than implicit assumptions.
