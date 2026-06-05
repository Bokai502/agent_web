# FreeCAD: CAD Build Workflow

Build the CAD-stage bundle from the Open Codex Web execution-context workspace:

- `00_inputs/real_bom.json`
- `00_inputs/layout_topology.json`
- `00_inputs/geom.json`

The CLI entry point is `python -m freecad_cli_tools.cli.main cad build`. It prepares non-FreeCAD CAD
stage artifacts, creates or refreshes the placeholder FreeCAD assembly through RPC, exports
thermal-simulation STEP/GLB, exports supplemental real-CAD STEP/GLB with the
hybrid App::Link backend for normal satellite/full-model assembly, and updates progress.

## Core Rules

- Resolve the workspace from the Open Codex Web execution context
  `workspace_dir`. Workspace/version selection is request-scoped; `/api/run`,
  checkout, and branch do not update `/data/lbk/codex_web/open_codex_web/config.json`.
- Always pass the execution context workspace explicitly with
  `--workspace-dir <workspace_dir>` for `config show`, `cad build`, progress
  updates, and follow-up validation. Do not rely on `config.json`, process
  `cwd`, or CLI defaults during Open Codex Web runs.
- `/data/lbk/codex_web/open_codex_web/config.json` field `freecad.workspaceDir`,
  `FREECAD_WORKSPACE_DIR`, and `WORKSPACE_DIR` are fallback mechanisms only for
  non-Web/manual CLI use.
- Default inputs are under `<workspace>/00_inputs`.
- Default outputs are under `<workspace>/01_cad`.
- Normal satellite/full-model assembly is complete only when both output pairs
  exist:
  - placeholder/simulation: `geometry_after.step` and `geometry_after.glb`
  - real CAD display: `geometry_after_real_cad.step` and `geometry_after_real_cad.glb`
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
supplemental real-CAD export. Use `--real-cad-backend static` only to debug the
direct real-CAD assembly without App::Link replacement.

Use explicit `--real-bom`, `--layout-topology`, `--geom`, `--input-dir`, or
`--output-dir` only when intentionally overriding individual files or
directories.

## Output Files

Check these outputs under `<workspace>/01_cad`:

- `geometry_after.step`
- `geometry_after.glb`
- `geometry_after_real_cad.step`
- `geometry_after_real_cad.glb`
- `geometry_after_real_cad.hybrid_summary.json`
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
2. State the placeholder STEP and GLB paths.
3. State `simulation_input.json` and `cad_agent_output.json` paths.
4. State the supplemental real-CAD STEP/GLB paths when present.
5. State `layout_completion_percent`, `modeling_percent`, and `export_file_percent`.
6. State `progress_json_path`.
7. Mention any missing output or partial export as partial success, not full success.
