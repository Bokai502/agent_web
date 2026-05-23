# Thermal Simulation Agent Workflow

## Goal

Coordinate planning, CAD generation, thermal simulation, debugging, and reporting for the selected workspace/version.

## Stages

| Stage | Skill | Responsibility | Main Outputs |
| --- | --- | --- | --- |
| Planner | `planner` | Convert the user goal or Debugger suggestions into configuration updates. | `00_inputs/planner_output.md`, updated config files |
| Executor | `freecad`, `simulation-skill` | Build or validate CAD artifacts, run simulation, and validate generated artifacts. | `01_cad`, `02_sim` |
| Debugger | none required | Explain failures from concrete artifacts and propose changes for Planner. | root-cause analysis, Planner suggestions |
| Reviewer | `cad-sim-report-agent` | Review completed `00_inputs`, `01_cad`, and `02_sim` artifacts and write final reports. | `reports` |

## Main Flow

1. Run Planner.
2. Run Executor.
3. If Executor fails, run the Debug loop.
4. Run Reviewer only after required execution artifacts exist and validate.

## Debug Loop

Use the newest failing artifact or error file as the current failure.

Repeat up to 3 times:

1. Debugger explains the root cause using file paths and evidence.
2. Debugger gives concrete modification suggestions for Planner.
3. Planner applies the needed configuration updates and writes `00_inputs/planner_output.md`.
4. Executor reruns from the updated inputs.
5. Stop the loop when Executor succeeds.

If all attempts fail, stop and report the unresolved failure with the latest failing artifact.

## Hard Rules

- Always use the selected workspace/version. Do not rely on global config defaults when a request-scoped workspace is available.
- Do not mix artifacts across versions.
- Planner owns configuration updates.
- Executor owns CAD and simulation commands.
- Debugger must not edit configuration files directly.
- Reviewer must report from existing artifacts; it must not rerun or mutate the workflow.
- Use the relevant skill instructions for detailed command syntax, validation rules, and output expectations.

## Required Artifacts

Planner requires:

- `00_inputs`
- user goal or Debugger suggestions

Executor requires:

- `00_inputs`
- valid or rebuildable `01_cad`

Reviewer requires:

- `00_inputs`
- `01_cad`
- `02_sim`

