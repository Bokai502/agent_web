# Execution Gates

Do not run simulation unless CAD produced the simulation artifacts required by
`simulation-skill doctor`. At minimum these must exist:

- `01_cad/geometry_after_power_filtered.step`
- `01_cad/simulation_input.json`

If the simulation CLI reports missing after-state or COMSOL input files,
prepare the required derived files before `simulation-skill run`.

`cad-box-builder` and `cad-real-assembly-builder` are box/review outputs. They
are required for a full CAD review workflow, but they are not blockers for
thermal simulation unless the user explicitly asks to regenerate review GLBs.

CAD geometry quality checks such as bbox overlaps, mount/contact mismatch, or
face occupancy over-capacity are warnings, not blockers, when required CAD
artifacts exist and the selected executor reports success.

Do not run Reviewer or a final report unless simulation succeeded:

- `logs/simulation_run_stage_result.json` must report a successful status.
- COMSOL status must have `ok == true` when present.

If any required gate fails, enter the debug loop instead of continuing.
