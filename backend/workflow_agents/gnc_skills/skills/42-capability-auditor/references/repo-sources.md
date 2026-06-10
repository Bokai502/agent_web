# Repo Sources

Use this reference as the entry map for `42-capability-auditor`.

## Primary spec

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/skills/42-capability-auditor-spec.md`

## Primary 42 knowledge

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_interfaces.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_extension_rules.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/orbit_env.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/examples.md`

## Structured indexes

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/inputs.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/sensors.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/actuators.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_architecture.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_interfaces.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_extension_rules.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/orbit_env.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/limitations.json`

## Detail layer

Consult `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/` only when the verdict depends on a concrete file field, sensor parameter, or actuator configuration rule.

## Intended outputs

- `42_capability_assessment.md`
- `<workspace>/AIGNC_Workflow/03_capability/capability_assessment.json`

## Optical payload implementation references

Use these when the task includes inter-satellite optical links, `FSM`, focal-plane camera, or DWS-like payload behavior:

- `codex_web/AIGNC/bridge/mission_bypass/knowledge_base/README.md`
- `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalPayload.c`
- `codex_web/AIGNC/bridge/mission_bypass/Source/AcOpticalLink.c`
- `codex_web/AIGNC/bridge/mission_bypass/Include/AcOpticalPayload.h`
- `<workspace>/FSW/ADCS/src/AcControl.c`
