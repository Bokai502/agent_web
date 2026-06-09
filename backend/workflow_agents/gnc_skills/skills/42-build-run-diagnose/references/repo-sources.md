# Repo Sources

Use this reference as the entry map for `42-build-run-diagnose`.

## Primary spec

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/skills/42-build-run-diagnose-spec.md`

## Primary workflow context

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/skills/42-config-workflow-current.md`

## Reusable post-run plotting skill

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/42-runtime-plotter/`

## Runtime-relevant context

- generated files under `<workspace>/AIGNC_Workflow/04_config/`
- validator outputs under `<workspace>/AIGNC_Workflow/04_config/validation/`
- final runtime-ready config under `<workspace>/Config/`
- mission-local build entrypoint `<workspace>/Script/build_42.py`; shell and PowerShell wrappers may delegate to it
- mission-local run entrypoint `<workspace>/Script/run_case.py`; shell and PowerShell wrappers may delegate to it
- build working directory and Makefile under `<workspace>/Output/Run/`
- object files under `<workspace>/Output/Run/build/`
- platform-selected simulator executable under `<workspace>/Output/Run/`, resolved by the build/run scripts
- runtime workspace `<workspace>/Output/Run/runtime_case/`
- runtime `InOut` directory `<workspace>/Output/Run/runtime_case/InOut/`

## Optional FSW implementation context

- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_code_author_report.md`
- `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_change_set.json`

## Intended outputs

- `<workspace>/AIGNC_Workflow/08_run/run_report.md`
- `<workspace>/AIGNC_Workflow/08_run/run_summary.json`
- `gnc_body_angular_velocity_xyz.png`
- `gnc_orbit_attitude_error_xyz.png`
- `gnc_reaction_wheel_speed.png`
