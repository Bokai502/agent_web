# Skill Spec: 42-runtime-plotter

## Goal

Generate a standard, scenario-agnostic post-run telemetry plot bundle from a 42 runtime `InOut/` directory.

## Core Inputs

Required:

- runtime `InOut/` directory

Expected telemetry:

- `Sc*.csv`

Optional telemetry:

- `AcWhl*.csv`
- `Hwhl.42`
- `time.42`

## Core Outputs

- `gnc_body_angular_velocity_xyz.png`
- `gnc_orbit_attitude_error_xyz.png`
- `gnc_reaction_wheel_speed.png`

## Standard Command

```text
python demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/42-runtime-plotter/scripts/plot_runtime_gnc.py --inout <runtime InOut path>
```

## Required Behavior

The skill must:

1. work on any scenario with standard 42 runtime telemetry
2. avoid assuming a specific mission geometry or case name
3. generate body-rate, orbit-attitude-error, and wheel-speed plots when telemetry exists
4. degrade gracefully when wheel telemetry is partially missing

## Success Criteria

The skill is successful when the three standard plots are generated from the runtime output directory and are ready for display in downstream review or diagnosis steps.
