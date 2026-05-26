# Vendor Runtime Layout

This directory contains the runtime code and data used by the `codex_agents`
thermal simulation pipeline. It is added to `sys.path` by
`codex_agents.bootstrap.prefer_vendor_imports()` so the bundled vendor packages
can keep their existing top-level import names such as `apps`, `pipeline`,
`core`, `formats`, and `py3dbp`.

## Active Runtime Areas

- `layout_runtime/`: BOM layout orchestration, component info materialization,
  layout sampling, and bundled `py3dbp` packing code.
- `geometry_edit_runtime/`: geometry-edit stage logic and optional FreeCAD
  agent templates.
- `simulation_runtime/`: simulation stage logic, local COMSOL runtime, and
  active COMSOL templates.
- `paraview_runtime/`: field export, ParaView postprocess stage, and rendering
  helpers.
- `shared_contracts/`: shared stage contracts, JSON helpers, validators,
  input normalization, case build, analysis, and suggestion stages.
- `pipeline/` and `core/`: compatibility packages that expose the relocated
  runtime modules under their historical import names.
- `data/module_db/`: thermal database used for component lookup.
- `simulation_runtime/pipeline_resources/templates/comsol/thermal_template.mph`:
  active COMSOL template referenced by the runtime configs.

## Archived Files

`archive/` holds files that are not referenced by active configs or imports but
are kept for manual rollback/reference instead of being deleted immediately.

Current archive contents:

- `pipeline_resources/templates/comsol/thermal_template_backup.mph`: previous
  COMSOL template backup. The active configs point to
  `simulation_runtime/pipeline_resources/templates/comsol/thermal_template.mph`.

## Cleanup Policy

Generated Python caches (`__pycache__`, `*.pyc`, `*.pyo`) are not source files
and can be deleted at any time. Python will recreate them as needed.
