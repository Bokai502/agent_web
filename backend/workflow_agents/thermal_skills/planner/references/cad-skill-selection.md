# CAD Skill Selection

Use the focused CAD build skills for normal CAD generation from
`00_inputs/cad_build_spec.json`.

| User Goal | Planned CAD Skills | Notes |
| --- | --- | --- |
| Generate or refresh all CAD artifacts | `cad-box-builder` -> `cad-real-assembly-builder` -> `cad-sim-input-builder` | Run in this order so box geometry, real assembly review, and simulation inputs are all current. |
| Generate only placeholder box geometry | `cad-box-builder` | Produces only `geometry_after.glb`. |
| Generate only real assembly visualization | `cad-real-assembly-builder` | Must use hybrid-link and real STEP files where available. Produces only `geometry_after_real_cad.glb`. |
| Prepare thermal simulation inputs | `cad-sim-input-builder` | Produces only `geometry_after_power_filtered.step` and `simulation_input.json`; downstream simulation may require after-state preparation if doctor reports missing derived files. |
| Run thermal simulation after CAD | `cad-sim-input-builder` if simulation inputs are stale or missing, then `simulation-skill` | `geometry_after.glb` and `geometry_after_real_cad.glb` are not simulation inputs. |

`cad-real-assembly-builder` must use hybrid-link and real STEP files where readable
STEP paths exist. Do not replace that path with placeholder boxes when real CAD
inputs are available.
