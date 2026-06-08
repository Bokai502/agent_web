# FreeCAD: Create CAD-Asset Assembly From Component Info

Build a brand-new FreeCAD assembly from real BOM CAD assets:

- `00_inputs/real_bom.json`
- `00_inputs/layout_topology.json`
- `00_inputs/geom.json`

It is the CAD-asset build path: resolve real STEP/STP component assets from
`real_bom.source.template_csv`, import them when available, and fall back to
simple boxes only for components whose CAD asset is missing, unreadable, not
STEP/STP, or too large. `--geom-component-info` remains available as an
explicit override, but it is no longer required by default.

This workflow creates a new document, builds the envelope from
`geom.outer_shell`, imports real STEP components from template CSV
`CAD_rotated_path`, `CAD_MAJOR_PATH`, `Rotated CAD Path`, or `CAD路径` when
available, falls back to box placeholders when needed, and exports:

- `component_info_assembly.step`
- `component_info_assembly.glb`

## Core Rules

- `layout_topology.json` provides installation-face truth:
  - `mount_face_id`
  - `component_mount_face_id`
  - `alignment`
- `geom.json` provides envelope truth through `outer_shell`.
- `real_bom.json` provides BOM truth and `source.template_csv`.
- `geom.json` provides component target geometry through `components[*].position + dims`.
- The template CSV is matched by `real_bom.items[*].semantic_name` to CSV `器件ID`.
- If `CAD_rotated_path`, `CAD_MAJOR_PATH`, `Rotated CAD Path`, or `CAD路径`
  resolves to a readable STEP/STP, import it.
- If the STEP path is missing, unreadable, not a STEP/STP, or exceeds
  `--max-step-size-mb`, generate an axis-aligned box from the target bbox
  instead.
- Identical STEP paths are imported once within a single build and then reused
  for later components that reference the same resolved STEP/STP path.
- This workflow creates a new assembly. It does not preserve objects from an
  older STEP assembly and does not modify `layout_topology.json`,
  `geom.json`, optional `geom_component_info.json`, or synthesized component info.

## Inputs

| Flag | Required | Description |
|------|----------|-------------|
| `--real-bom` | no | Source `real_bom.json`. Defaults to `./00_inputs/real_bom.json`. |
| `--layout-topology` | no | Source `layout_topology.json`. Defaults to `./00_inputs/layout_topology.json`. |
| `--geom` | no | Source `geom.json`. Defaults to `./00_inputs/geom.json`. |
| `--geom-component-info` | no | Optional source `geom_component_info.json`; when omitted, component info is synthesized from `real_bom.json` and `geom.json`. |
| `--doc-name` | yes | FreeCAD document name to create. |
| `--output` | no | Optional STEP output path or directory. Export names remain `component_info_assembly.step` and `component_info_assembly.glb`. |
| `--max-step-size-mb` | no | Maximum STEP/STP size to import before falling back to a box. Defaults to the value reported by `python -m freecad_cli_tools.cli.main config show` as `component_info_max_step_size_mb`; use `-1` to disable the limit. |
| `--no-fit-view` | no | Skip GUI fit/view update. |
| `--host`, `--port` | no | FreeCAD RPC settings. Defaults come from `FREECAD_RPC_HOST` / `FREECAD_RPC_PORT`, then `project root config.json` fields `workspace.rpcHost` / `workspace.rpcPort`. |

## Data Mapping

### Envelope

Use `geom.outer_shell`:

- `outer_bbox.min/max` -> envelope outer size
- `inner_bbox.min/max` -> envelope inner size
- `thickness` -> shell thickness

### Components

For each candidate component from `real_bom.items`:

1. Keep it only when its `component_id` can be found in `geom.components`.
2. Require the same `component_id` in `layout_topology.placements[*].component_id`.
3. Read:
   - `mount_face_id`
   - `component_mount_face_id`
   - `alignment`
4. Read the target geometry from `geom.json` component `position + dims`.
5. Match `real_bom.items[*].semantic_name` to template CSV `器件ID`, then read
   STEP path candidates from `CAD_rotated_path`, `CAD_MAJOR_PATH`,
   `Rotated CAD Path`, or `CAD路径`.
6. If the STEP exists and is within the allowed size threshold, import it,
   derive the runtime orientation from `component_mount_face_id ->
   mount_face_id` plus `alignment.in_plane_rotation_deg`, rotate the geometry
   into that orientation first, then align the rotated bbox to the target bbox.
7. If the STEP is unavailable or oversized, create a `Part::Box` exactly
   covering the target bbox.

## Command Pattern

Resolve the workspace from the Open Codex Web execution context `workspace_dir`.
Workspace/version selection is request-scoped; `/api/run`, checkout, and branch
do not update `project root config.json`. Always pass the execution
context workspace explicitly with `--workspace-dir <workspace_dir>` for
`config show` and `assembly create-from-component-info`. Do not rely on
`config.json`, process `cwd`, or CLI defaults during Open Codex Web runs.
`project root config.json` field `workspace.templateDir`,
`FREECAD_WORKSPACE_DIR`, and `WORKSPACE_DIR` are fallback mechanisms only for
non-Web/manual CLI use.

```bash
python -m freecad_cli_tools.cli.main config show \
  --workspace-dir <workspace_dir>
```

```bash
python -m freecad_cli_tools.cli.main assembly create-from-component-info \
  --workspace-dir <workspace_dir> \
  --doc-name DirectAssembly
```

Use explicit `--real-bom`, `--layout-topology`, and `--geom` only when you need
to override individual files inside or outside the execution-context workspace.

## Output Files

Note: this command can be slow when it imports real STEP/STP CAD assets and
exports STEP/GLB files. Be patient and wait for the progress log or final
artifacts before assuming the build has stalled.

The command writes CAD artifacts under the execution-context workspace reported
by `python -m freecad_cli_tools.cli.main config show --workspace-dir <workspace_dir>`:

- STEP: `<workspace>/01_cad/component_info_assembly.step`
- GLB: `<workspace>/01_cad/component_info_assembly.glb`
- Progress JSON: `<workspace>/logs/progress_percentages.json`

If `--output` is provided, it only selects the output directory or parent path.
The exported filenames still remain `component_info_assembly.step` and
`component_info_assembly.glb`.

The workflow does not write replacement dataset files. In particular, it does
not produce `geometry_after.layout_topology.json` or `geometry_after.geom.json`;
those are produced by the safe-move workflow.

## Output Fields To Check

- `success`
- `save_path`
- `glb_path`
- `component_count`
- `progress_percentages`
- `progress_json_path`
- progress log `output_files.step` and `output_files.glb`
- `layout_completion_percent`
- `modeling_percent`
- `export_file_percent`
- `step_component_ids`
- `box_component_ids`
- `fallback_box_component_ids`
- `fallback_components_by_reason`

Within each `components[*]` record, also check:

- `source_step_path`
- `requested_step_path`
- `step_size_bytes`
- `fallback_reason`
- `cache_hit`
- `shape_object_count`

## Reporting Template

Report direct builds in this order:

1. State that a new assembly was created from `real_bom.json + layout_topology.json + geom.json`.
2. State how many components were imported from STEP.
3. State how many components fell back to box placeholders.
4. If any boxes were fallbacks, state the main `fallback_reason` categories.
5. State `layout_completion_percent`, `modeling_percent`, and `export_file_percent`.
6. State `progress_json_path`.
7. State the output STEP and GLB paths from the payload and progress log `output_files`.
