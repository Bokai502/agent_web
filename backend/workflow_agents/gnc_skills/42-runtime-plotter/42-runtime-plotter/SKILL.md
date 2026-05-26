---
name: 42-runtime-plotter
description: Generate standard post-run 42 telemetry plots from a runtime InOut directory. Use after any 42 simulation run when Codex should produce and show tri-axis spacecraft body angular velocity, orbit-frame attitude error, and reaction-wheel speed figures for quick review.
---

# 42 Runtime Plotter

## Overview

Use this skill after a 42 case has already run and an `InOut/` directory exists. Its job is to generate a standard visualization bundle that is reusable across scenarios rather than tied to a specific mission case.

This skill is a post-processing stage. It does not run the simulation itself and it does not diagnose control performance beyond generating the standard figures.

## When to Use

Use this skill when:

- a 42 runtime `InOut/` directory already exists
- the user wants standard plots after a run
- `42-build-run-diagnose` or `fsw-tuning-reviewer` needs common post-run figures
- Codex should show:
  - three-axis spacecraft body angular velocity
  - orbit-frame attitude error by axis
  - reaction wheel speed

## Inputs

Required:

- path to a runtime `InOut/` directory

Expected telemetry, when available:

- `Sc*.csv`

Optional telemetry:

- `AcWhl*.csv`
- `Hwhl.42`
- `time.42`

## Required Local Context

Read `references/repo-sources.md` first.

Use the bundled script:

- `scripts/plot_runtime_gnc.py`

## Workflow

## Required Checklist

Complete these in order:

1. Confirm the runtime `InOut/` directory exists.
2. Confirm at least one `Sc*.csv` file exists.
3. Run the plotting script.
4. Verify the standard output images were created.
5. Show the resulting image paths and render them when the client supports local images.

## Standard Command

Preferred command:

```bash
python skills/42-runtime-plotter/scripts/plot_runtime_gnc.py --inout <runtime InOut path>
```

## Output Contract

Generate these standard image files under the provided `InOut/` directory:

- `gnc_body_angular_velocity_xyz.png`
- `gnc_orbit_attitude_error_xyz.png`
- `gnc_reaction_wheel_speed.png`

The plots should be scenario-agnostic and derived only from available runtime telemetry.

## Stop Conditions

Stop and report missing telemetry if:

- the `InOut/` directory does not exist
- no `Sc*.csv` files exist
- wheel-speed telemetry is unavailable for some spacecraft

If wheel telemetry is partially unavailable, still generate the other plots and mark missing wheel plots clearly.

## Boundaries

Do not:

- rerun the simulation
- patch runtime telemetry files
- infer mission success from the plots alone
- assume a specific mission geometry or scenario

## Terminal State

The terminal state is a reusable post-run plotting bundle plus rendered figure paths that downstream diagnosis or review skills can consume.
