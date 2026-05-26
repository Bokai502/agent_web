# CAD/Simulation Workspace Reference

## File Roles

- `00_inputs/real_bom.json`: source component list.
- `00_inputs/geom.json`: source component geometry and envelope.
- `00_inputs/layout_topology.json`: source placement/mount topology.
- `01_cad/cad_agent_output.json`: CAD build and validation status.
- `01_cad/geometry_after.step`: rebuilt CAD geometry for COMSOL import.
- `01_cad/geometry_after.glb`: visual CAD preview.
- `01_cad/geometry_after_registry.json`: component bounding boxes, shape metadata, mount face ids.
- `01_cad/simulation_input.json`: simulation-oriented component and thermal metadata.
- `01_cad/comsol_inputs/coord.txt`: COMSOL coordinate export input.
- `01_cad/comsol_inputs/channels_input.npz`: channel/field input array.
- `02_sim/run_manifest.json`: pipeline stage status.
- `02_sim/sample.yaml`: COMSOL runtime sample description.
- `02_sim/simulation/_comsol_work/sim/status.json`: detailed COMSOL runtime status.
- `02_sim/simulation/_comsol_work/sim/work.mph`: current COMSOL model snapshot.
- `02_sim/simulation/_comsol_work/sim/native.vtu`: ParaView-compatible field export when present.
- `logs/progress_percentages.json`: latest pipeline progress and errors.

## Interpretation Rules

- `run_manifest.ok == true` means the pipeline wrapper succeeded, but still inspect simulation artifacts if the user asks for result quality.
- `status.json.ok == false` with `stage` set to `update_selections`, `update_sources`, `mesh`, `solve`, or `export` identifies the actual failing step.
- Selection validation with `empty_tags: []` means the geometry-to-selection stage passed.
- A failure at `update_sources` with `root.comp1.ht.<component-id>.Q0` usually means the COMSOL physics feature tag used an unsafe component id containing `-`.
- A failure at `solve` after heat sources and selections pass is more likely numerical/mesh/physics setup than CAD import.
- CAD validation warnings are still relevant even if a STEP exists; include them in the report as residual geometry risk.

## Recommendation Priorities

Use this order when proposing fixes:

1. Data consistency: all source and derived JSON files agree on the active component set.
2. CAD importability: `geometry_after.step` exists and COMSOL geometry check passes.
3. Selection validity: every heat-producing component has a non-empty domain selection.
4. Physics feature validity: COMSOL feature tags are safe and stale `work.mph` nodes are cleaned.
5. Solver/export stability: mesh and solver changes only after the previous checks pass.
