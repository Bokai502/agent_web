---
name: 42-runtime-plotter
description: Generate standard post-run 42 telemetry plots from a runtime InOut directory. Use after any 42 simulation run when Codex should produce and show tri-axis spacecraft body angular velocity, orbit-frame attitude error, and reaction-wheel speed figures for quick review.
---

# 42 Runtime Plotter

## Path Contract

- `<workspace>` means the backend-injected `workspace_dir`; this skill must use `workspace_dir` as the only source for the active working directory.
- Shared skills live under `open_codex_web/backend/workflow_agents/gnc_skills/skills/`.
- Shared knowledge lives under `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/`.
- Shared 42, bridge, and reference resources live under `codex_web/AIGNC/42/`, `codex_web/AIGNC/bridge/`, and `codex_web/AIGNC/ref/`.


## Overview

Use this skill after a 42 workspace package has already run and an `InOut/` directory exists. Its job is to generate a standard visualization bundle that is reusable across scenarios rather than tied to a specific mission workspace.

This skill is a post-processing stage. It does not run the simulation itself and it does not diagnose control performance beyond generating the standard figures.

## When to Use

Use this skill when:

- a 42 runtime `InOut/` directory already exists
- the user wants standard plots after a run
- `42-build-run-diagnose` or `fsw-tuning-reviewer` needs common post-run figures
- Codex should show, for every simulation run:
  - body angular velocity, with the three body axes separated
  - inertial-frame attitude angles, with the three axes separated
  - orbit-frame attitude angles or orbit-frame attitude error, with the three axes separated
  - reaction-wheel speed, with wheels separated
  - thruster output when thruster telemetry exists
  - the mode sequence and switching timeline

## Inputs

Required:

- path to a runtime `InOut/` directory

Expected telemetry, when available:

- `Sc*.csv`

Quaternion convention note:

- 42 runtime `Sc*.csv` attitude quaternions use `vector-first, scalar-last`
  ordering: `[q1, q2, q3, qs]`
- when reconstructing `CBN` from `Sc_qn_1..4`, do not treat `Sc_qn_1` as the
  scalar term
- if this convention is handled incorrectly, the orbit-frame Euler attitude
  error plot can show false `180/360 deg` jumps

Optional telemetry:

- `AcWhl*.csv`
- `Hwhl.42`
- `AcThr*.csv`, `Thr*.csv`, or other thruster command/output telemetry when present
- `ModeTrace_SC*.csv` or equivalent mode trace telemetry
- `time.42`

## Required Local Context

Read `open_codex_web/backend/workflow_agents/gnc_skills/skills/42-runtime-plotter/references/repo-sources.md` first.

Use the bundled script:

- `open_codex_web/backend/workflow_agents/gnc_skills/skills/42-runtime-plotter/scripts/plot_runtime_gnc.py`

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
python3 open_codex_web/backend/workflow_agents/gnc_skills/skills/42-runtime-plotter/scripts/plot_runtime_gnc.py --inout <runtime InOut path>
```

## Output Contract

Generate these standard per-run outputs under the provided `InOut/` directory, and copy or reference them from `<workspace>/AIGNC_Workflow/08_run/plots/` when the runtime belongs to a case:

- `gnc_body_angular_velocity_xyz.png`: body angular velocity with X/Y/Z axes separated.
- `gnc_inertial_attitude_xyz.png`: inertial-frame attitude angles with three axes separated.
- `gnc_orbit_attitude_xyz.png` or `gnc_orbit_attitude_error_xyz.png`: orbit-frame attitude angles or attitude error with three axes separated.
- `gnc_reaction_wheel_speed.png`: reaction-wheel speed with each wheel separated.
- `gnc_thruster_output.png`: thruster force/command/output with channels separated, when thruster telemetry exists.
- `gnc_mode_timeline.png`: mode sequence switching process over time, when mode telemetry exists.

If a telemetry source is absent, still generate the available plots and explicitly record missing plots in the handoff/report. The plots should be scenario-agnostic and derived only from available runtime telemetry.

When the runtime `InOut/` path belongs to `<workspace>/02_sim/42_run/runtime_case/InOut/`, append step-level status entries to `<workspace>/AIGNC_Workflow/workflow_log.md` when this skill starts, after runtime path verification, telemetry discovery, each plot-generation group, missing-telemetry detection, image verification, and final plot handoff. Entries must use stage `08_run`, current skill `42-runtime-plotter`, step id or step name, status, timestamp, concise description, key inputs checked, outputs updated, and next action or handoff target. Do not log private reasoning.
Structured progress must also be updated in `<workspace>/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>`, matching the numbered stage used for `<workspace>/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the stage run. Keep the current skill name in the `--skill` field instead of embedding it in the loop name. Set `--note` according to the shared frontend-display note contract in `open_codex_web/backend/workflow_agents/gnc_skills/skills/README.md`.


## Stop Conditions

Stop and report missing required telemetry if:

- the `InOut/` directory does not exist
- no `Sc*.csv` files exist

If optional wheel, thruster, or mode telemetry is partially unavailable, still generate the other plots and mark the missing plot categories clearly.

## Boundaries

Do not:

- rerun the simulation
- patch runtime telemetry files
- infer mission success from the plots alone
- assume a specific mission geometry or scenario

## Terminal State

The terminal state is a reusable post-run plotting bundle plus rendered figure paths that downstream diagnosis or review skills can consume.
