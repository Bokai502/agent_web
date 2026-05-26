# Repo Sources

Use this reference as the entry map for `42-capability-auditor`.

## Primary spec

- `knowledge/skills/42-capability-auditor-spec.md`

## Primary 42 knowledge

- `knowledge/42/inputs.md`
- `knowledge/42/sensors.md`
- `knowledge/42/actuators.md`
- `knowledge/42/cfs_fsw_architecture.md`
- `knowledge/42/cfs_fsw_interfaces.md`
- `knowledge/42/cfs_fsw_extension_rules.md`
- `knowledge/42/orbit_env.md`
- `knowledge/42/limitations.md`
- `knowledge/42/examples.md`

## Structured indexes

- `knowledge/42/capabilities/inputs.json`
- `knowledge/42/capabilities/sensors.json`
- `knowledge/42/capabilities/actuators.json`
- `knowledge/42/capabilities/cfs_fsw_architecture.json`
- `knowledge/42/capabilities/cfs_fsw_interfaces.json`
- `knowledge/42/capabilities/cfs_fsw_extension_rules.json`
- `knowledge/42/capabilities/orbit_env.json`
- `knowledge/42/capabilities/limitations.json`

## Detail layer

Consult `knowledge/42/details/` only when the verdict depends on a concrete file field, sensor parameter, or actuator configuration rule.

## Intended outputs

- `42_capability_assessment.md`
- `capability_assessment.json`

## Optical payload implementation references

Use these when the task includes inter-satellite optical links, `FSM`, focal-plane camera, or DWS-like payload behavior:

- `Development/OpticalPayloadDraft/OpticalLinkReusableReference.md`
- `Development/OpticalPayloadDraft/OpticalLinkAcquisitionWorkflow.md`
- `bridge/mission_bypass/Source/AcOpticalPayload.c`
- `bridge/mission_bypass/Source/AcOpticalLink.c`
- `bridge/mission_bypass/Include/AcOpticalPayload.h`
- `fsw/overlay/Source/AcControl.c`
