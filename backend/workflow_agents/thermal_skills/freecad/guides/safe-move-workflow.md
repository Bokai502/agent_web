# FreeCAD: Safe Move Workflow From `layout_topology.json` + `geom.json`

Default workflow for moving an existing component safely. The source of truth is
the layout dataset pair:

- `layout_topology.json`
- `geom.json`

`sample.yaml` is not part of this workflow. The CLI entry point is
`python -m freecad_cli_tools.cli.main layout safe-move`, which always writes updated JSON dataset outputs and
optionally syncs/export CAD artifacts.

## Core Rules

- Prefer the layout-dataset branch. Use `python -m freecad_cli_tools.cli.main layout safe-move`;
  by default it reads `./00_inputs/layout_topology.json` and `./00_inputs/geom.json`
  from the execution-context workspace. Pass `--layout-topology` and `--geom` only
  when intentionally overriding those input files.
- A move is always constrained to the current installation surface. Only the four
  in-plane directions of that surface are valid movement directions.
- Any requested movement component along the surface normal is ignored and should
  be reported via `normal_move_component_ignored`.
- The box/envelope installation face can change when the user explicitly asks to
  install the component on another face.
- The component's own contact/mount face does not change during safe-move. It is
  reused to place the component against the selected box/envelope surface.
- A component can be installed onto any box/envelope face id `0..11`. When the
  target face changes, rotate the component so the original component contact
  face still touches the new box/envelope face.
- Do not rebuild the whole assembly for a move. Write new dataset files under
  `./01_cad`, and when syncing CAD export `geometry_after.step` plus
  sibling GLB there by default.
- During CAD sync, move an existing `<NAME>_part` container by the rigid delta
  from the previous normalized pose to the new normalized pose. Do not directly
  overwrite a container with the new absolute `position`, because replaced STEP
  children may already carry their own local placement and would otherwise detach
  from the selected installation face.

## Dataset Mapping

The move solver still operates on the normalized spec:

- `placement.position`: component local origin in world coordinates
- `placement.mount_face_id`: owner-qualified box/envelope install face id
- `placement.component_mount_face_id`: component-local contact face id
- runtime orientation: derived from the two face ids plus `alignment.in_plane_rotation_deg`

After the move, write the result back to the dataset:

### `layout_topology.json`

- `placements[*].mount_face_id`: updated target install face
- `placements[*].cabin_id`: `null` on external faces, cabin id on internal faces
- `placements[*].component_mount_face_id`: preserved component-local contact face
- `placements[*].alignment.in_plane_rotation_deg`: derived from the final
  runtime orientation

### `geom.json`

- `components[*].position`: updated world-space bbox minimum
- `components[*].mount_face_id`: same target dataset face id as topology
- `components[*].mount_point`: recomputed from the final pose
- `components[*].install_pos`: recomputed from the final pose and clearance
- `components[*].leaf_node_id`: `leaf.outer` for external, `leaf.<cabin>` for internal

## Face Model

The normalized numeric face ids are:

| Face IDs | Meaning | Wall size source | Allowed move axes |
|----------|---------|------------------|-------------------|
| `0`, `1`, `6`, `7` | `-X`, `+X`, external `-X`, external `+X` faces | `inner_bbox` for `0..1`, `outer_bbox` for `6..7` | `±Y`, `±Z` |
| `2`, `3`, `8`, `9` | `-Y`, `+Y`, external `-Y`, external `+Y` faces | `inner_bbox` for `2..3`, `outer_bbox` for `8..9` | `±X`, `±Z` |
| `4`, `5`, `10`, `11` | `-Z`, `+Z`, external `-Z`, external `+Z` faces | `inner_bbox` for `4..5`, `outer_bbox` for `10..11` | `±X`, `±Y` |

Internal faces are `0..5` and use `geom.outer_shell.inner_bbox`.
External faces are `6..11` and use `geom.outer_shell.outer_bbox`.

When the component stays on the same box/envelope face, the component contact
face can be derived from the current normalized placement. When the box/envelope
face changes, preserve that original component contact face and rotate the
component to make it touch the new target face.

## Inputs

Collect these before running a move:

- `component`: target component ID, for example `P022`
- `move`: requested world vector; only the two axes in the installation face
  plane will be applied
- `layout-topology`: source `layout_topology.json`
- `geom`: source `geom.json`
- `layout-topology-output` / `geom-output`: optional output paths. If omitted,
  default to `./01_cad/geometry_after.layout_topology.json` and
  `./01_cad/geometry_after.geom.json`
- `doc-name`: live FreeCAD document name. Defaults to `LayoutAssembly`.
- `step-output`: optional export path or directory. Its basename is always
  forced to `geometry_after.step`, with sibling `geometry_after.glb`
- `no-sync-cad`: JSON-only mode. Use only when the user explicitly does not
  want the CAD document or STEP/GLB artifacts updated.

## Command Patterns

Resolve the workspace from the Open Codex Web execution context `workspace_dir`.
Workspace/version selection is request-scoped; `/api/run`, checkout, and branch
do not update `/data/lbk/codex_web/config.json`. Always pass the execution
context workspace explicitly with `--workspace-dir <workspace_dir>` for
`config show`, `layout safe-move`, progress updates, and follow-up validation.
Do not rely on `config.json`, process `cwd`, or CLI defaults during Open Codex
Web runs. `/data/lbk/codex_web/config.json` field `freecad.workspaceDir`,
`FREECAD_WORKSPACE_DIR`, and `WORKSPACE_DIR` are fallback mechanisms only for
non-Web/manual CLI use.

```bash
python -m freecad_cli_tools.cli.main config show \
  --workspace-dir <workspace_dir>
```

### Move On Current Face

Use this when the user only asks to move a component on its current installation
surface.

```bash
python -m freecad_cli_tools.cli.main layout safe-move \
  --workspace-dir <workspace_dir> \
  --component P022 \
  --move 20 0 0
```

If `P022` is on face `11` (`external +Z`), `--move 20 0 0` is valid because
`±X` and `±Y` are in-plane directions for Z faces. If the component is on an X
face, the same `+X` request is normal to the face and will be ignored.

### Change Box/Envelope Installation Face

Use `--install-face <0..11>` only when the user explicitly asks to move the
component to another box/envelope surface.

```bash
python -m freecad_cli_tools.cli.main layout safe-move \
  --workspace-dir <workspace_dir> \
  --component P022 \
  --install-face 10 \
  --move 20 0 0
```

This updates `placements[*].mount_face_id` to the selected dataset face and
recomputes `alignment.in_plane_rotation_deg` so the same component-local contact
face continues to touch the box.

### Offline Dataset-Only Analysis

Use this when FreeCAD is not running or the user only wants an updated dataset.

```bash
python -m freecad_cli_tools.cli.main layout safe-move \
  --workspace-dir <workspace_dir> \
  --component P022 \
  --move 20 0 0 \
  --no-sync-cad
```

This writes new dataset files under `./01_cad` only. It does not update the
FreeCAD document, STEP, or GLB.

## Execution Steps

1. Read `layout_topology.json`.
2. Read `geom.json`.
3. Normalize the two files into the internal assembly spec.
4. Identify the current normalized `placement.mount_face_id`.
5. Derive the current component contact face from the normalized component.
6. Decide the target box/envelope face. If the user did not request a face
   change, keep the current face.
7. If the user requested a face change, pass `--install-face <0..11>` and
   rotate the component so the original component contact face is used on the
   new target face.
8. Check whether the requested vector lies in the target face plane.
9. Run `python -m freecad_cli_tools.cli.main layout safe-move --workspace-dir <workspace_dir>` with the dataset paths.
10. Write the updated normalized result into the non-destructive output dataset files.
11. CAD artifacts are updated by default. Include `--doc-name` only when the
   active FreeCAD document is not `LayoutAssembly`, and optionally include
   `--step-output` to choose a different export directory.
12. Confirm CAD sync used the previous normalized pose and new normalized pose
   as a rigid transform for `<NAME>_part` when the component is represented by a
   container.
13. Read the output fields and report the effective move, ignored normal
   component, blockers, dataset paths, STEP path, and GLB path.

## Safety Behavior

- If the full in-plane move is safe, it is applied directly.
- If collision or face-boundary violation is detected, the tool searches for the
  closest safe prefix along the requested segment.
- If no safe point exists, the constrained result is written to the dataset and
  the failure or adjustment must be reported.
- Internal-face boundary violations appear as `ENVELOPE_BOUNDARY`.
- External-face boundary violations appear as `FACE_BOUNDARY`.
- Post-move CAD sync can return partial success if the dataset was updated but
  STEP or GLB export failed. Report this clearly.

## Output Fields To Check

- `output_layout_topology_path`: updated `layout_topology.json`
- `output_geom_path`: updated `geom.json`
- `step_path`: updated STEP path unless `--no-sync-cad` is used
- `glb_path`: updated GLB path unless `--no-sync-cad` is used
- `progress_percentages`: grouped progress percentages
- `progress_json_path`: JSON log path under
  `<workspace>/logs/progress_percentages.json`; use
  `python -m freecad_cli_tools.cli.main config show --workspace-dir <workspace_dir>`
  to inspect the resolved workspace root before running
  the move command
- progress log `output_files`: produced `layout_topology`, `geom`, `step`, and
  `glb` paths with existence checks
- `layout_completion_percent`: dataset update completion percentage
- `modeling_percent`: CAD sync/modeling completion percentage; `0.0` only in
  `--no-sync-cad` JSON-only runs or failed sync attempts
- `export_file_percent`: STEP/GLB export completion percentage; STEP and GLB
  each contribute 50%, and dataset-only runs report `0.0`
- `target_envelope_face`: final numeric box/envelope installation face
- `component_contact_face`: numeric component contact face used for placement
- runtime orientation: derived orientation used to keep the original component
  contact face seated on the target box/envelope face
- `normal_move_component_ignored`: normal-direction move component that was
  removed
- `requested_move_is_safe`: whether the original in-plane request was safe
- `applied_move`: actual move after projection and safety adjustment
- `final_position`: final normalized local-origin position
- `final_mount_point`: recomputed normalized mount point
- `cad_sync_result`: FreeCAD document sync and export result

## Reporting Template

Report moves in this order:

1. State whether the requested move was applied exactly or adjusted.
2. State the final box/envelope face and confirm that the component contact face
   stayed the same.
3. State any ignored normal component.
4. State blockers if any.
5. State `layout_completion_percent`, `modeling_percent`, and `export_file_percent`.
6. State `progress_json_path`.
7. State the updated `layout_topology.json`, `geom.json`, `STEP`, and `GLB` paths from the payload and progress log `output_files`.

Do not say the operation fully succeeded unless the dataset, STEP, and GLB are
all updated when CAD sync was requested.
