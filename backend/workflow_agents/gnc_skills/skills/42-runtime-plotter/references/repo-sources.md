# Repo Sources

Use this reference as the entry map for `42-runtime-plotter`.

## Primary spec

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/skills/42-runtime-plotter-spec.md`

## Bundled script

- `open_codex_web/backend/workflow_agents/gnc_skills/skills/42-runtime-plotter/scripts/plot_runtime_gnc.py`

## Expected runtime telemetry

- runtime `InOut/Sc*.csv`

## Quaternion convention

- 42 writes `Sc_qn_1..4` as `vector-first, scalar-last`: `[q1, q2, q3, qs]`
- any plotting or post-processing code that reconstructs `CBN` must preserve
  that ordering
- interpreting the same telemetry as `scalar-first` produces incorrect
  orbit-frame Euler error plots and can create false `180/360 deg` jumps

## Optional runtime telemetry

- runtime `InOut/AcWhl*.csv`
- runtime `InOut/Hwhl.42`
- runtime `InOut/time.42`

## Intended outputs

- `gnc_body_angular_velocity_xyz.png`
- `gnc_orbit_attitude_error_xyz.png`
- `gnc_reaction_wheel_speed.png`
