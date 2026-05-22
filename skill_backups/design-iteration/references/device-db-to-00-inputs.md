# Device Database to 00_inputs

Read this reference only when the user asks to add, replace, or select devices
from the thermal simulation database and write them into a version workspace's
`00_inputs` files.

## Contents

- Source and Matching
- Target Files
- ID and Replacement Rules
- Field Mapping
- Placement and Mounting
- Validation

## Source and Matching

Read:

```text
/data/wqn/cad2comsol2paraview/data/module_db/热仿真数据库.xlsx
```

If `openpyxl` is unavailable, inspect the `.xlsx` as a zip and parse workbook
XML. Do not install dependencies just to inspect or update JSON.

Match user requirements against model/name, Chinese name, component ID,
subsystem/category, dimensions, mass, power, temperature limits, material,
thermal properties, and CAD availability. Use fuzzy matching only for search.
Before writing JSON, choose one exact database row and record the source fields
in `source_ref`.

If multiple rows satisfy the request with materially different dimensions,
power, mass, or CAD availability, present the top candidates and ask before
writing. If the user named an exact model/component ID and only one row matches,
proceed.

Prefer CAD paths in this order:

```text
CAD_MAJOR_PATH
CAD_rotated_path
Rotated CAD Path
CAD路径
```

## Target Files

Update all three files inside the selected version workspace:

```text
<workspace_dir>/00_inputs/real_bom.json
<workspace_dir>/00_inputs/geom.json
<workspace_dir>/00_inputs/layout_topology.json
```

Never write to a source/template workspace such as
`/data/lbk/codex_web/FreeCAD_data/v9_data`. Use the request-scoped
`workspace_dir`.

Before editing:

1. Confirm `workspace_dir` points under
   `FreeCAD_data/workspaces/<workspaceId>/versions/<versionId>`.
2. Backup the three JSON files with a timestamp suffix.
3. Parse and rewrite JSON with structured JSON APIs. Do not use regex edits.

## ID and Replacement Rules

Preserve existing IDs. For a new device:

- `component_id`: next `P###` after the highest existing `P` number, unless
  replacing an existing component.
- `geometry_id`: next `G###`.
- `thermal_id`: next `T###`.
- `geom.components` key: `${geometry_id}_${component_id}`.
- `layout_topology.placements[].geometry_id`: bare `G###`.
- `layout_topology.placements[].thermal_id`: bare `T###`.

When replacing an existing component, keep its component, geometry, thermal,
mount target, and position IDs unless the user asks to change them.

## Field Mapping

- Dimensions: use millimeters. Prefer STEP dimensions, then body dimensions,
  then explicit length/width/height, then parsed `尺寸`.
- Mass: convert database grams to kilograms.
- Power: use watts. Prefer main-mode power. Use calibration/cooling only for
  requested worst-case sizing.
- Category: map subsystem/category conservatively, for example ADCS,
  propulsion, thermal, power, payload, and communication.
- Kind: use `internal` unless the user or replaced slot says external.
- Material: normalize to a snake-case `material_id` and keep raw material in
  `source_ref.selected_material`.
- CAD provenance: record available CAD paths in `source_ref`.

Normalize numeric strings with units before writing. Preserve the raw database
values in `source_ref` when conversion required assumptions.

## Placement and Mounting

Database mount-face values map to local component faces:

```text
+X -> local_xmax
-X -> local_xmin
+Y -> local_ymax
-Y -> local_ymin
+Z -> local_zmax
-Z -> local_zmin
```

Use `component_mount_face_id = "<P###>.<local_face>"`. Choose the target
`mount_face_id` from existing install faces. If the user does not specify a
target, ask or reuse the replaced component's target.

If the user gives a center position, compute:

```text
position = center - dims / 2
bbox.min = position
bbox.max = position + dims
```

If no placement is provided for a new device, do not invent a final location.
Use a clearly marked temporary placement only if the workflow will resolve it
with layout/safe-move before CAD validation.

## Validation

After editing:

1. Parse all three JSON files.
2. Check exactly one BOM item, one geom component, and one placement exist for
   the component ID.
3. Check `size_mm == dims`, `mass_kg == mass`, and `power_W == power`.
4. Check geometry/thermal IDs are unique and match placement references.
5. Check mount face references match between BOM and placement.
6. Check `bbox.max - bbox.min == dims`.
7. Run the relevant FreeCAD validation workflow with the same `workspace_dir`.

If validation fails, restore from backups or leave the edited files with a clear
failure report. Do not register a successful checkpoint.
