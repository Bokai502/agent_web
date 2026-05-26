---
name: fsw-requirements-extractor
description: Extract fixed CFS_FSW requirements from mission descriptions, including modes, transition conditions, sensor and actuator contracts, and control-law constraints.
---

# FSW Requirements Extractor

## Overview

Use this skill when the user has already committed to the fixed `CFS_FSW` path and needs the mission description converted into an implementation-ready FSW requirement specification.

This skill extracts and structures requirements. It does not write control code.

## When to Use

Use this skill when the user asks for any of the following:

- mode design inside the fixed `CFS_FSW`
- transition logic or state-machine conditions
- sensor and actuator requirements for FSW
- control-law constraints, targets, or performance metrics
- a structured spec before source-code changes

## Inputs

Required:

- natural-language mission or GNC description

Recommended:

- `scenario_facts.json`
- `capability_assessment.json`

Optional:

- existing `CFS_FSW` implementation notes
- current case files if the request is incremental

## Required Local Context

Read `references/repo-sources.md` first.

Default knowledge scope:

- `knowledge/42/cfs_fsw_architecture.md`
- `knowledge/42/cfs_fsw_interfaces.md`
- `knowledge/42/cfs_fsw_extension_rules.md`
- `knowledge/42/sensors.md`
- `knowledge/42/actuators.md`
- `knowledge/42/limitations.md`

Default structured indexes:

- `knowledge/42/capabilities/cfs_fsw_architecture.json`
- `knowledge/42/capabilities/cfs_fsw_interfaces.json`
- `knowledge/42/capabilities/cfs_fsw_extension_rules.json`
- `knowledge/42/capabilities/sensors.json`
- `knowledge/42/capabilities/actuators.json`

Use detailed schemas only if the request depends on concrete interface fields.

## Workflow

### 1. Extract control semantics

Identify:

- whether the request is ADCS only or includes orbit control
- which guidance targets exist
- which phases are true modes versus transient steps
- which mission metrics are explicit

### 2. Extract mode and transition logic

Convert prose into structured transition conditions without directly writing C code.

Typical condition families:

- angular-rate thresholds
- attitude-error thresholds
- sensor-validity conditions
- hold times
- momentum or actuator thresholds

### 3. Extract implementation constraints

Capture requirements such as:

- quaternion versus Euler error representation
- rate-feedback form
- need for feedforward
- momentum management or unloading policy
- truth-state versus measurement-based control assumptions

### 4. Check whether the request exceeds fixed `CFS_FSW`

Flag separately when the request actually implies:

- new truth-model sensors
- new truth-model actuators
- full estimation architecture beyond current `CFS_FSW`

Do not hide these behind ordinary control-law wording.

## Output Contract

Produce:

- `fsw_requirement_spec.md`
- `mode_table.json`
- `sensor_actuator_contract.json`

The mode table should include mode purpose, entry conditions, exit conditions, primary sensors, and primary actuators.

## Stop Conditions

Stop and ask for clarification if:

- the physical meaning of a pointing objective is ambiguous
- the request depends on unspecified available sensors or actuators
- multiple mutually different state-machine interpretations are possible
- the user mixes estimator requirements with truth-state assumptions without resolving the boundary

## Boundaries

Do not:

- write `AcControl.c`, `AcStateMachine.c`, or other source files
- decide truth-model extension details
- silently translate ambiguous prose into hard-coded logic

The next downstream skill is typically an FSW architecture or implementation planner.
