# CAD Builders Module Index

Use this file when you need to quickly understand or query the available
`cad_builders` module capabilities before generating a runner.

## Public Runner APIs

- `cad_builders.box.CadBoxBuildRequest`: request data for placeholder box builds:
  `workspace_dir`, optional `spec_path`, `output_dir`, `doc_name`, `host`, `port`.
- `cad_builders.box.CadBoxBuilder`: builds `geometry_after.glb` and FreeCAD
  screenshots from `cad_build_spec.json`.
- `cad_builders.box.CadBoxGeometryBuilder`: renders the FreeCAD script used by
  `CadBoxBuilder`.
- `cad_builders.box.CadBoxScreenshotCapture`: supplies screenshot helper code and
  checks expected screenshot files.
- `cad_builders.real_assembly.CadRealAssemblyBuildRequest`: request data for
  supplemental real assembly builds: `workspace_dir`, optional `spec_path`,
  `output_dir`, `doc_name`, `host`, `port`.
- `cad_builders.real_assembly.CadRealAssemblyBuilder`: builds
  `geometry_after_real_cad.glb` and `geometry_after_real_cad.hybrid_summary.json`,
  using component STEP files when available and box fallback otherwise.
- `cad_builders.sim_input.CadSimInputBuildRequest`: request data for simulation
  input work: `workspace_dir`, optional `spec_path`, `output_dir`, `doc_name`,
  `host`, `port`, and `grid_shape`.
- `cad_builders.sim_input.CadSimInputBuilder`: builds
  `geometry_after_power_filtered.step` and `simulation_input.json`.
- `cad_builders.sim_input.CadAfterStatePreparer`: derives
  `geometry_after.geom.json`, `geometry_after.layout_topology.json`,
  `geometry_after_registry.json`, and COMSOL grid inputs.
- `cad_builders.validate.CadValidateRequest`: request data for CAD validation:
  `workspace_dir`, optional `spec_path`, `cad_dir`, validation tolerances,
  optional `report_path`, and `echo_validator_output`.
- `cad_builders.validate.CadValidateRunner`: validates required CAD outputs and
  returns a JSON-compatible report.
- `cad_builders.progress.CadProgressRequest`: progress update input:
  `workspace_dir`, `role`, `percentage`, optional `note`, optional `status`.
- `cad_builders.progress.CadProgressUpdater`: updates workflow progress by
  `progressRole`. Allowed statuses are `running`, `completed`, `failed`, and
  `blocked`.

## Shared Helpers

- `cad_builders.common.read_json` / `write_json`: load and write JSON objects.
- `cad_builders.common.write_json_atomic`: atomically write JSON objects.
- `cad_builders.common.default_spec_path`: resolve
  `<workspace_dir>/00_inputs/cad_build_spec.json`.
- `cad_builders.common.default_cad_dir`: resolve `<workspace_dir>/01_cad`.
- `cad_builders.common.default_doc_name`: create a normalized FreeCAD document
  name from a workspace path and optional operation suffix:
  `<thermal-kind>_<user>_<version>_<operation>`.
- `cad_builders.common.load_spec`: read and validate `cad_build_spec/1.0`.
- `cad_builders.common.normalize_runtime_path`: produce an absolute runtime path
  string for generated FreeCAD scripts.
- `cad_builders.common.freecad_rpc_settings`: resolve FreeCAD RPC host/port from
  explicit inputs, `CODEX_WEB_CONFIG_PATH`, or nearest `config.json`.
- `cad_builders.common.execute_freecad_code`: execute code through the FreeCAD RPC
  server and parse the JSON payload from the RPC output.

## Box Internals

- `cad_builders.box.support.freecad_base_script`: combines common FreeCAD imports,
  constants, helpers, and body text into a runnable script.
- `cad_builders.box.support.common_imports`: imports FreeCAD modules and
  package-local `freecad_runtime.py` for placeholder box scripts.
- `cad_builders.freecad_runtime`: package-local FreeCAD helpers for box and real
  assembly scripts, including placement, color, box, envelope, wall, document, and
  view helpers.

## Real Assembly Internals

- `cad_builders.real_assembly.support.component_bbox`: normalize component bbox
  from `bbox` or `position` plus `dims`.
- `cad_builders.real_assembly.support.is_external_face`: identify hybrid-link
  external face ids.
- `cad_builders.real_assembly.support.render_rpc_script`: load an RPC template
  from `cad_builders/rpc_scripts` and apply replacements.
- `cad_builders.rpc_scripts.build_real_assembly_hybrid`: FreeCAD-side hybrid
  assembly script template. Generated runners should use
  `CadRealAssemblyBuilder`, not import this template directly.
- `cad_builders.freecad_glb_exporter.export_component_node_glb`: FreeCAD-side GLB
  exporter used by the hybrid assembly script.

## Sim Input Internals

- `cad_builders.sim_input.support.spec_to_layout_data`: normalize
  `cad_build_spec.json` into layout metadata.
- `cad_builders.sim_input.support.build_simulation_input`: build the
  `simulation_input.json` payload, including heat-source components, install
  faces, wall metadata, cabins, radiators, and selection plans.
- `cad_builders.sim_input.support.install_faces_from_spec`: derive install face
  metadata from component mounts and shell faces.
- `cad_builders.sim_input.support.freecad_base_script`: combines common FreeCAD
  imports, constants, helpers, and body text into a runnable sim-input script.
- `cad_builders.sim_input.freecad_runtime`: package-local FreeCAD helpers used by
  simulation STEP generation.
- `cad_builders.sim_input.after_state.parse_grid_shape`: parse `Nx,Ny,Nz`
  strings.
- `cad_builders.sim_input.after_state.build_geom`: derive geometry metadata from
  layout and simulation input.
- `cad_builders.sim_input.after_state.build_registry`: derive after-state registry
  metadata.
- `cad_builders.sim_input.after_state.write_grid_inputs`: write COMSOL grid input
  files.

## Validate Internals

- `cad_builders.validate.runner.request_to_namespace`: convert
  `CadValidateRequest` to validator script arguments.
- `cad_builders.validate.runner.default_validate_script_path`: resolve the
  package-local validation script path.
- `cad_builders.validate.scripts.validate_spec_outputs.check_simulation_contract`:
  compare expected simulation components from `build_simulation_input` with the
  generated `simulation_input.json`.
- `cad_builders.validate.scripts.validate_spec_outputs.check_bboxes`: check
  invalid boxes, component overlaps, mount contact, wall overlaps, and envelope
  conflicts.
- `cad_builders.validate.scripts.validate_spec_outputs.main`: validate required
  files, simulation contract, and geometry warnings; prints a JSON report.
