# Workflow Overview

Coordinate planning, configuration editing, CAD generation, thermal simulation,
debugging, and reporting for the selected workspace/version.

| Stage | Skill | Responsibility | Main Outputs |
| --- | --- | --- | --- |
| Planner | `planner` | Convert the user goal or Debugger suggestions into a concrete CAD/simulation execution plan. | plan summary and ordered next steps |
| Workflow Diagram Writer | `workflow-diagram-writer` | Write the frontend execution flow JSON after the plan is known. | `00_inputs/workflow_diagram/executionFlowData.json` |
| Config Editor | `config-editor` | Apply the plan's required configuration updates to workspace inputs. | `00_inputs/config_editor_output.md`, updated config files |
| CAD Box Builder | `cad-box-builder` | Build the placeholder box GLB from `00_inputs/cad_build_spec.json`. | `01_cad/geometry_after.glb` |
| CAD Real Assembly Builder | `cad-real-assembly-builder` | Build the supplemental real assembly GLB from `components[].real_cad.step_path` using hybrid-link. | `01_cad/geometry_after_real_cad.glb` |
| CAD Simulation Input Builder | `cad-sim-input-builder` | Build the power-filtered thermal simulation STEP and `simulation_input.json`. | `01_cad/geometry_after_power_filtered.step`, `01_cad/simulation_input.json` |
| Simulation Executor | `simulation-skill` | Run thermal simulation and validate generated artifacts. | `02_sim` |
| Debugger | none required | Explain failures from concrete artifacts and propose changes for Planner. | root-cause analysis, Planner suggestions |
| Reviewer | `cad-sim-report-agent` | Review completed `00_inputs`, `01_cad`, and `02_sim` artifacts and write final reports. | `reports` |

Main flow:

1. Run Planner.
2. Run Workflow Diagram Writer when the frontend execution flow should be generated or refreshed.
3. Run Config Editor when the plan requires input configuration changes.
4. Run the selected CAD or simulation executor.
5. If the executor fails, run the debug loop.
6. Run Reviewer only after required execution artifacts exist and validate.
