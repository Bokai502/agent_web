# Input Schema Notes

## ID Contract

For every component, keep these IDs consistent:

- `real_bom.items[].component_id`
- `layout_topology.placements[].component_id`
- `geom.components.*.component_id`

For every placement, keep:

- `layout_topology.placements[].geometry_id` aligned with the matching
  `geom.components` object.
- `layout_topology.placements[].mount_face_id` present in
  `layout_topology.install_faces[]` and `geom.install_faces`.
- `layout_topology.placements[].component_mount_face_id` present in the
  matching BOM item's `mounting.mount_faces[]`.

## real_bom.json

Required top-level fields:

- `schema_version`
- `units`
- `source`
- `items`

Important item fields:

- `component_id`: stable slot ID, for example `P001`.
- `semantic_name`: device lookup ID used to match CSV `器件ID`.
- `kind`: usually `internal`; use `radiator` for radiator records.
- `category`: subsystem such as `power`, `payload`, `adcs`, `propulsion`.
- `size_mm`: `[x, y, z]`.
- `mass_kg`
- `power_W`
- `material_id`
- `mounting.default_component_mount_face_id`
- `mounting.mount_faces[]`
- `source_ref.cad_path`, `source_ref.cad_rotated_path`, or
  `source_ref.cad_major_path` when real CAD assets are available.

## layout_topology.json

Important fields:

- `outer_shell.id`: shell owner ID used by install faces.
- `install_faces[]`: available target faces.
- `placements[]`: one entry per installed component.
- `cabins[]`: internal volume records.

Each placement should define:

- `component_id`
- `semantic_name`
- `component_mount_face_id`
- `mount_face_id`
- `alignment.normal_alignment`
- `alignment.in_plane_rotation_deg`
- `geometry_id`
- `thermal_id`
- `category`

## geom.json

Important fields:

- `outer_shell.outer_bbox.min/max`
- `outer_shell.inner_bbox.min/max`
- `outer_shell.thickness`
- `install_faces`
- `components`

Each component geometry should define:

- `id`
- `component_id`
- `semantic_name`
- `dims`
- `position`
- `bbox.min/max`
- `mount_face_id`
- `mass`
- `power`
- `thermal_surface.emissivity`
- `thermal_interface.contact_resistance`

All geometry lengths are in millimeters.
