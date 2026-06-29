# Skill Spec: 42-capability-auditor

## Goal

Assess whether a requested mission or payload concept is supported by the current 42 repository state and fixed `CFS_FSW` architecture.

This skill does not generate final 42 configuration files and does not modify FSW code. Its job is to establish a trustworthy capability boundary for downstream skills.

## Core Inputs

Required:

- `scenario_facts.json`
- `open_questions.json`

Optional:

- user clarification answers
- prior workspace templates
- mission text or task description

## Core Outputs

- `42_capability_assessment.md`
- `capability_assessment.json`

Recommended JSON shape:

```json
{
  "overall_status": "supported_with_assumptions",
  "sim_config_support": "supported",
  "cfs_fsw_support": "supported_with_assumptions",
  "truth_model_extension_required": false,
  "supported_items": [],
  "assumption_bound_items": [],
  "requires_extension_items": [],
  "blocking_questions": []
}
```

For optical-payload tasks, also include when relevant:

```json
{
  "native_42_optical_payload_support": "requires_extension",
  "sidecar_optical_payload_support": "supported",
  "optical_link_fsw_support": "supported",
  "native_truth_model_extension_required": true
}
```

## Knowledge Scope

Default reading set:

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_interfaces.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_extension_rules.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/orbit_env.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/examples.md`

Structured indexes:

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/inputs.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/sensors.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/actuators.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_architecture.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_interfaces.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/cfs_fsw_extension_rules.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/orbit_env.json`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/limitations.json`

For inter-satellite optical-link tasks, also read:

- `Development/OpticalPayloadDraft/OpticalLinkReusableReference.md`
- `Development/OpticalPayloadDraft/OpticalLinkAcquisitionWorkflow.md`
- `Source/AcOpticalPayload.c`
- `Source/AcOpticalLink.c`
- `Include/AcOpticalPayload.h`

## Audit Breakdown

Audit separately:

- orbit and environment
- spacecraft multiplicity / formation assumptions
- sensors
- actuators
- integrated payload subsystems
- `CFS_FSW` architectural fit
- outputs and diagnostics

Integrated payload subsystems explicitly include cases like:

- `FSM + focal-plane camera`
- `FSM + DWS-like sensor`
- inter-satellite optical payloads with scan / acquisition / fine-track logic

## Allowed Verdicts

Every audited item must be classified as exactly one of:

- `supported`
- `supported_with_assumptions`
- `requires_extension`

Do not use vague verdicts.

## Optical Payload Boundary Rule

For optical payload tasks, the auditor must distinguish two different paths:

1. **native 42 truth-model path**
   - parser / object / sensor / joint support inside:
     - `42init.c`
     - `42sensors.c`
     - `42joints.c`
     - `42types.h`
2. **current repo sidecar / FSW path**
   - platform `OPTICAL_BUS_HOLD`
   - `AcOpticalPayload` sidecar
   - `AcOpticalLink` scan / acquisition / hold / fine-track logic

Current repo interpretation:

- native 42 optical payload object support is **not** native support
- current repo optical-payload simulation through sidecar + FSW is an available supported path

Therefore:

- if the user accepts the current repo architecture, `FSM + focal-plane camera/DWS` optical payload simulation is not an unsupported boundary
- if the user explicitly requires a native 42 payload object or native 42 parser/truth-model integration, the verdict must be `requires_extension`

## Blockers

Create blockers when:

- the user requires a native optical payload object but only sidecar support exists
- sensor or actuator meaning remains physically ambiguous
- mission support depends on choosing between native truth-model and sidecar / FSW implementation
- the requested environment invalidates a required model

## Stop Conditions

Stop and ask for clarification when:

- the user has not resolved whether sidecar support is acceptable
- multiple incompatible physical interpretations exist
- a required extension boundary is still unclear

## Prohibited Claims

Do not:

- equate template reuse with native support
- report `AcOpticalPayload` / `AcOpticalLink` as native 42 support
- silently downgrade `requires_extension` to `supported_with_assumptions`
- modify `CFS_FSW`

## Success Criteria

The skill is successful when:

1. downstream configuration or FSW work does not rediscover a capability boundary late
2. optical payload tasks do not get blocked by a false “42 has no such payload” claim when sidecar support already exists
3. native truth-model gaps remain clearly visible when the user actually needs native support
