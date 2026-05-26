# FreeCAD: CAD Build Workflow

Build the CAD-stage bundle from the configured workspace:

- `00_inputs/real_bom.json`
- `00_inputs/layout_topology.json`
- `00_inputs/geom.json`

The CLI entry point is `python -m freecad_cli_tools.cli.main cad build`. It prepares non-FreeCAD CAD
stage artifacts, creates or refreshes the FreeCAD assembly through RPC, exports
STEP/GLB, and updates progress.

## Core Rules

- Use `python -m freecad_cli_tools.cli.main config show` first to inspect the configured workspace,
  default inputs, RPC host/port, output directory, and progress paths.
- The workspace source of truth is `/data/lbk/codex_web/config.json` field
  `freecad.workspaceDir`. Deprecated `--workspace`, `FREECAD_WORKSPACE_DIR`,
  and `WORKSPACE_DIR` values must not be used to switch datasets.
- Default inputs are under `./00_inputs` in the configured workspace.
- Default outputs are under `./01_cad` in the configured workspace.
- The command must not write root-level `01_cad/coord.txt` or
  `01_cad/channels_input.npz`; COMSOL input files belong under
  `01_cad/comsol_inputs`.

## Command Pattern

```bash
python -m freecad_cli_tools.cli.main config show
```

```bash
python -m freecad_cli_tools.cli.main cad build
```

Use explicit `--real-bom`, `--layout-topology`, `--geom`, `--input-dir`, or
`--output-dir` only when intentionally overriding individual files or
directories.

## Output Files

Check these outputs under `<configured workspace>/01_cad`:

- `geometry_after.step`
- `geometry_after.glb`
- `simulation_input.json`
- `cad_agent_output.json`
- `geometry_after.layout_topology.json`
- `geometry_after.geom.json`
- `geometry_after_registry.json`
- `normalized_layout_dataset.json`
- `comsol_inputs/coord.txt`
- `comsol_inputs/channels_input.npz`

The command also updates:

- `<configured workspace>/logs/progress_percentages.json`
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
2. State the output STEP and GLB paths.
3. State `simulation_input.json` and `cad_agent_output.json` paths.
4. State `layout_completion_percent`, `modeling_percent`, and `export_file_percent`.
5. State `progress_json_path`.
6. Mention any missing output or partial export as partial success, not full success.
