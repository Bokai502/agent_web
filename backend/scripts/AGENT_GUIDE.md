# Thermal Simulation Agent Workflow

## Goal

Coordinate planning, CAD generation, thermal simulation, debugging, and reporting for the selected workspace/version.

## Stages

| Stage | Skill | Responsibility | Main Outputs |
| --- | --- | --- | --- |
| Planner | `planner`, `config-editor` | Convert the user goal or Debugger suggestions into a workflow plan, then apply required configuration updates. | `00_inputs/config_editor_output.md`, updated config files |
| Executor | `freecad`, `simulation-skill` | Build or validate CAD artifacts, run simulation, and validate generated artifacts. | `01_cad`, `02_sim` |
| Debugger | `config-editor` | Explain failures from concrete artifacts, update the workflow plan, and apply required configuration fixes. | root-cause analysis, Planner suggestions, `00_inputs/config_editor_output.md` |
| Reviewer | `cad-sim-report-agent` | Review completed `00_inputs`, `01_cad`, and `02_sim` artifacts and write final reports. | `reports` |

## Workflow State Machine

Start with the selected workspace/version.

1. `Plan`
   - Run Planner.
   - Run Config Editor if the plan requires input or configuration updates.

2. `Execute`
   - Run Executor for CAD and simulation.
   - If execution succeeds and required artifacts validate, transition to `Review`.
   - If execution fails, transition to `Debug`.

3. `Debug`
   - Use the newest failing artifact or error file as evidence.
   - Debugger identifies the root cause with concrete file paths.
   - Debugger produces Planner-facing modification suggestions.
   - Transition back to `Plan`.

4. `Review`
   - Run Reviewer only from existing validated artifacts.
   - Do not rerun or mutate CAD/simulation state.

## Retry Policy

- The `Plan -> Execute -> Debug -> Plan` recovery cycle may run at most 3 times.
- Stop immediately when Executor succeeds and required artifacts validate.
- If all retry attempts fail, stop and report:
  - latest failing artifact
  - root-cause evidence
  - attempted fixes
  - remaining blocker

## Hard Rules

- Always use the selected workspace/version. Do not rely on global config defaults when a request-scoped workspace is available.
- Do not mix artifacts across versions.
- Planner owns workflow planning.
- Config Editor owns configuration updates.
- Executor owns CAD and simulation commands.
- Debugger must use Config Editor for configuration file edits.
- Reviewer must report from existing artifacts; it must not rerun or mutate the workflow.
- Use the relevant skill instructions for detailed command syntax, validation rules, and output expectations.

## Required Artifacts

Planner requires:

- `00_inputs`
- user goal

Config Editor requires:

- `00_inputs`
- user goal
- Planner output or Debugger suggestions

Executor requires:

- `00_inputs`
- valid or rebuildable `01_cad`

Reviewer requires:

- `00_inputs`
- `01_cad`
- `02_sim`
