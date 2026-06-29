# Repo Sources

Use this reference as the entry map for `42-build-run-diagnose`.

## Primary spec

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/skills/42-build-run-diagnose-spec.md`

## Primary workflow context

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/skills/42-config-workflow-current.md`

## Reusable post-run plotting skill

- `agent-web/backend/workflow_agents/gnc_skills/skills/42-runtime-plotter/`

## Runtime-relevant context

- generated files under `<workspace>/AIGNC_Workflow/04_config/`
- validator outputs under `<workspace>/AIGNC_Workflow/04_config/validation/`
- final runtime-ready config under `<workspace>/00_inputs/Config/`
- mission-local build entrypoint `<workspace>/00_inputs/Script/build_42.py`; pass `--workspace-dir <workspace>`
- mission-local run entrypoint `<workspace>/00_inputs/Script/run_case.py`; pass `--workspace-dir <workspace>`
- build working directory and Makefile under `<workspace>/02_sim/42_run/`
- object files under `<workspace>/02_sim/42_run/build/`
- platform-selected simulator executable under `<workspace>/02_sim/42_run/`, resolved by the build/run scripts
- runtime workspace `<workspace>/02_sim/42_run/runtime_case/`
- runtime `InOut` directory `<workspace>/02_sim/42_run/runtime_case/InOut/`

## Optional FSW implementation context

- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_code_author_report.md`
- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_change_set.json`

## Intended outputs

- `<workspace>/AIGNC_Workflow/08_run/run_report.md`
- `<workspace>/AIGNC_Workflow/08_run/run_summary.json`
- `gnc_body_angular_velocity_xyz.png`
- `gnc_orbit_attitude_error_xyz.png`
- `gnc_reaction_wheel_speed.png`
