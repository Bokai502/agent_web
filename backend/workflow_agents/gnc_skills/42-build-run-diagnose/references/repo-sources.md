# Repo Sources

Use this reference as the entry map for `42-build-run-diagnose`.

## Primary spec

- `knowledge/skills/42-build-run-diagnose-spec.md`

## Primary workflow context

- `knowledge/skills/42-config-workflow-current.md`

## Reusable post-run plotting skill

- `skills/42-runtime-plotter/`

## Runtime-relevant context

- generated files under `workspace_dir/AIGNC_Workflow/04_config/`
- validator outputs under `workspace_dir/AIGNC_Workflow/04_config/validation/`
- final runtime-ready config under `workspace_dir/00_inputs/Config/`
- version-workspace build entrypoint `workspace_dir/00_inputs/Script/build_42.py --workspace-dir <workspace_dir>`; shell and PowerShell wrappers may delegate to it
- version-workspace run entrypoint `workspace_dir/00_inputs/Script/run_case.py --workspace-dir <workspace_dir>`; shell and PowerShell wrappers may delegate to it
- build working directory and Makefile under `workspace_dir/02_sim/42_run/`
- object files under `workspace_dir/02_sim/42_run/build/`
- platform-selected simulator executable under `workspace_dir/02_sim/42_run/`, resolved by the build/run scripts
- runtime workspace_dir `workspace_dir/02_sim/42_run/runtime_case/`
- runtime `InOut` directory `workspace_dir/02_sim/42_run/runtime_case/InOut/`

## Optional FSW implementation context

- `workspace_dir/AIGNC_Workflow/07_fsw_implementation/fsw_code_author_report.md`
- `workspace_dir/AIGNC_Workflow/07_fsw_implementation/fsw_change_set.json`

## Intended outputs

- `workspace_dir/AIGNC_Workflow/08_run/run_report.md`
- `workspace_dir/AIGNC_Workflow/08_run/run_summary.json`
- `gnc_body_angular_velocity_xyz.png`
- `gnc_orbit_attitude_error_xyz.png`
- `gnc_reaction_wheel_speed.png`
