# CAD Skill Selection

Use `cad-builder` for normal CAD generation and validation from
`00_inputs/cad_build_spec.json`.

| User Goal | Planned CAD Skill | Notes |
| --- | --- | --- |
| Generate or refresh all CAD artifacts | `cad-builder` | Run its box, real-assembly, and sim-input operations in that order. |
| Generate only placeholder box geometry | `cad-builder` | Run only the box operation; produces only `geometry_after.glb`. |
| Generate only real assembly visualization | `cad-builder` | Run only the real-assembly operation; must use hybrid-link and real STEP files where available. |
| Prepare thermal simulation inputs | `cad-builder` | Run only the sim-input operation; produces the simulation STEP/input and after-state files. |
| Validate CAD outputs | `cad-builder` | Run only the validate operation. |
| Run thermal simulation after CAD | `cad-builder` if simulation inputs are stale or missing, then `simulation-skill` | `geometry_after.glb` and `geometry_after_real_cad.glb` are not simulation inputs. |

The real-assembly operation must use hybrid-link and real STEP files where
readable STEP paths exist. Do not replace that path with placeholder boxes when
real CAD inputs are available.
