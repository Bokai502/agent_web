# Repo Sources

Use this reference as the entry map for `42-config-validator`.

## Primary spec

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/skills/42-config-validator-spec.md`

## Primary workflow context

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/skills/42-config-workflow-current.md`
- `agent-web/backend/workflow_agents/gnc_skills/skills/42-config-author/SKILL.md`
- `agent-web/backend/workflow_agents/gnc_skills/skills/42-config-author/references/repo-sources.md`

The validator must enforce the current config-author contract: for ordinary satellite cases the core authored set is `Inp_Sim.txt`, every `Orb_*.txt` referenced by `Inp_Sim.txt`, and every `SC_*.txt` referenced by `Inp_Sim.txt`. Template support files may be copied unchanged, but support-file modifications require a scenario-driven reason recorded in `generated_config_manifest.json`.

## Primary 42 knowledge

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`

## Structured indexes

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/inputs.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/limitations.json`

## Detail layer

Load only the detailed schemas needed for the generated files under review:

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/*.json`
- relevant `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/details/sensors/*.json`
- relevant `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/details/actuators/*.json`

## Intended outputs

- `<workspace>/AIGNC_Workflow/04_config/validation/config_validation_report.md`
- `<workspace>/AIGNC_Workflow/04_config/validation/config_validation_summary.json`
- `<workspace>/AIGNC_Workflow/04_config/validation/requirements_trace.md`
- `<workspace>/AIGNC_Workflow/04_config/validation/requirements_trace.json`

The summary must include the core/support audit fields from `agent-web/backend/workflow_agents/gnc_skills/skills/42-config-validator/SKILL.md`, especially `core_files_checked`, `support_files_checked`, `missing_core_field_decisions`, `unjustified_template_defaults`, and `unexpected_support_file_modifications`.

## Local implementation

- `agent-web/backend/workflow_agents/gnc_skills/skills/42-config-validator/scripts/validate_42_config.py`
