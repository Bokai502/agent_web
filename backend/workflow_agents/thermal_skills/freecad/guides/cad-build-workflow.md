# FreeCAD: CAD Build Workflow

Build the CAD-stage bundle from the Open Codex Web execution-context workspace:

- `00_inputs/real_bom.json`
- `00_inputs/layout_topology.json`
- `00_inputs/geom.json`

The CLI entry point is `python -m freecad_cli_tools.cli.main cad build`. It prepares non-FreeCAD CAD
stage artifacts, creates or refreshes the placeholder FreeCAD assembly through RPC, exports
full display GLB, exports power-filtered thermal-simulation STEP, exports supplemental
real-CAD GLB for normal satellite/full-model assembly, and updates progress.

## Core Rules

- Resolve the workspace from the Open Codex Web execution context
  `workspace_dir`. Workspace/version selection is request-scoped; `/api/run`,
  checkout, and branch do not update `project root config.json`.
- Always pass the execution context workspace explicitly with
  `--workspace-dir <workspace_dir>` for `config show`, `cad build`, progress
  updates, and follow-up validation. Do not rely on `config.json`, process
  `cwd`, or CLI defaults during Open Codex Web runs.
- `project root config.json` field `workspace.templateDir`,
  `FREECAD_WORKSPACE_DIR`, and `WORKSPACE_DIR` are fallback mechanisms only for
  non-Web/manual CLI use.
- Default inputs are under `<workspace>/00_inputs`.
- Default outputs are under `<workspace>/01_cad`.
- Normal satellite/full-model assembly is complete only when these minimal
  outputs exist:
  - full placeholder display: `geometry_after.glb`
  - real CAD display: `geometry_after_real_cad.glb`
  - simulation input: `geometry_after_power_filtered.step`
- `simulation_input.json` must contain only components with non-null `power_W > 0`.
  Walls are included with `power_W: 0`. Components with zero, null, missing,
  non-numeric, or non-finite power stay in the full display CAD but are excluded
  from the filtered simulation CAD.
- The command must not write root-level `01_cad/coord.txt` or
  `01_cad/channels_input.npz`; COMSOL input files belong under
  `01_cad/comsol_inputs`.

## Command Pattern

```bash
python -m freecad_cli_tools.cli.main config show \
  --workspace-dir <workspace_dir>
```

```bash
python -m freecad_cli_tools.cli.main cad build \
  --workspace-dir <workspace_dir> \
  --real-cad-backend hybrid-link
```

Use `--real-cad-backend none` only when the user explicitly asks to skip the
supplemental real-CAD export. Real-CAD generation must otherwise use
`--real-cad-backend hybrid-link`.

Use explicit `--real-bom`, `--layout-topology`, `--geom`, `--input-dir`, or
`--output-dir` only when intentionally overriding individual files or
directories.

## Output Files

Check these outputs under `<workspace>/01_cad`:

- `geometry_after.glb`
- `geometry_after_power_filtered.step`
- `geometry_after_real_cad.glb`
- `simulation_input.json`
- `cad_agent_output.json`
- `geometry_after.layout_topology.json`
- `geometry_after.geom.json`
- `geometry_after_registry.json`
- `normalized_layout_dataset.json`
- `comsol_inputs/coord.txt`
- `comsol_inputs/channels_input.npz`

The command also updates:

- `<workspace>/logs/progress_percentages.json`
- artifact registry records when registry IDs are supplied

## Output Fields To Check

- `success`
- `save_path`
- `glb_path`
- `simulation_input_path`
- `cad_agent_output_path`
- `progress_percentages`
- `progress_json_path`
- progress log `output_files`
- `layout_completion_percent`
- `modeling_percent`
- `export_file_percent`

## Reporting Template

Report builds in this order:

1. State that the CAD-stage bundle was built from `00_inputs`.
2. State the placeholder display GLB path.
3. State the power-filtered simulation STEP path and `simulation_input.json`.
4. State `cad_agent_output.json`.
5. State the supplemental real-CAD GLB path when present.
6. State `layout_completion_percent`, `modeling_percent`, and `export_file_percent`.
7. State `progress_json_path`.
8. Mention any missing output or partial export as partial success, not full success.
