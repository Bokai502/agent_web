---
name: planner
description: "Plan CAD and thermal simulation workflow steps from the user's goal, workspace context, and failure evidence without editing configuration files."
---

# Planner

Use this skill to decide what the CAD/thermal workflow should do before any
configuration edits or execution commands run.

## Workflow

Coordinate planning, configuration editing, CAD generation, thermal simulation,
debugging, and reporting for the selected workspace/version.

| Stage | Skill | Responsibility | Main Outputs |
| --- | --- | --- | --- |
| Planner | `planner` | Convert the user goal or Debugger suggestions into a concrete CAD/simulation execution plan. | plan summary and ordered next steps |
| Config Editor | `config-editor` | Apply the plan's required configuration updates to workspace inputs. | `00_inputs/config_editor_output.md`, updated config files |
| Executor | `freecad`, `simulation-skill` | Build or validate CAD artifacts, run simulation, and validate generated artifacts. | `01_cad`, `02_sim` |
| Debugger | none required | Explain failures from concrete artifacts and propose changes for Planner. | root-cause analysis, Planner suggestions |
| Reviewer | `cad-sim-report-agent` | Review completed `00_inputs`, `01_cad`, and `02_sim` artifacts and write final reports. | `reports` |

Main flow:

1. Run Planner.
2. Run Config Editor when the plan requires input configuration changes.
3. Run Executor.
4. If Executor fails, run the Debug loop.
5. Run Reviewer only after required execution artifacts exist and validate.

Execution gates:

- Do not run simulation unless CAD validation produced required CAD artifacts:
  `01_cad/cad_agent_output.json` must have `validation.success == true`.
  CAD geometry quality checks such as bbox overlaps, mount/contact mismatch, or
  face occupancy over-capacity are warnings, not blockers, when the validation
  report still has `success == true`.
- Do not run Reviewer or a final report unless simulation succeeded:
  `logs/simulation_run_stage_result.json` must report a successful status, and
  COMSOL status must have `ok == true` when present.
- If any gate fails, enter the Debug loop instead of continuing.

Debug loop, up to 3 attempts:

1. Debugger explains the root cause using file paths and evidence.
2. Debugger gives concrete modification suggestions for Planner.
3. Planner updates the execution plan.
4. Config Editor applies needed configuration updates and writes
   `00_inputs/config_editor_output.md`.
5. Executor reruns from the updated inputs.
6. Stop the loop when Executor succeeds.

If all attempts fail, stop and report the unresolved failure with the latest
failing artifact.

Report policy:

- Any user request that includes report generation, report regeneration,
  report summary, report review, "输出报告", "生成报告", "重新生成报告", or a
  full CAD/thermal workflow ending in a report must include the Reviewer stage
  using `cad-sim-report-agent`.
- `cad-sim-report-agent` may generate a final report after CAD validation
  `success == true` and simulation passes; CAD validation warnings must be
  reported as residual geometry risk, not treated as a failed gate.
- When final chat output or a report summary includes CAD validation warnings,
  ask the user whether they want to enter a CAD/layout modification step to
  resolve those warnings.
- If the Debug loop reaches 3 failed attempts, generate only a failure report
  from the latest failing artifacts.
- Do not label a failed CAD or simulation run as a completed final engineering
  result.
- Planner, Config Editor, FreeCAD executor, and Simulation executor must not
  hand-write Markdown/JSON report files as a substitute for
  `cad-sim-report-agent`. They may only report transient status in chat.

## Flow

1. Resolve the selected `workspace_dir`, `workspace_id`, and `version_id` from
   the execution context.
2. Inspect only lightweight workspace state needed to plan: manifest metadata,
   `00_inputs` filenames, progress summaries, stage result summaries, and
   failure snippets when relevant.
3. Convert the user goal or Debugger suggestions into an ordered plan.
4. Identify which specialist should perform each step:
   - `config-editor` for `00_inputs` configuration changes.
   - `freecad` for CAD build, validation, geometry edits, and visual checks.
   - `simulation-skill` for thermal simulation and postprocess artifacts.
   - `cad-sim-report-agent` for final artifact review and report writing.
5. State required inputs, expected artifacts, validation gates, and stop
   conditions.

## Rules

- Do not edit files.
- Do not run CAD or simulation commands.
- Planner owns workflow planning; it must not edit configuration files
  directly.
- Config Editor owns configuration updates.
- Executor owns CAD and simulation commands.
- Debugger must not edit configuration files directly.
- Reviewer must report from existing artifacts; it must not rerun or mutate the
  workflow.
- If the user asks only to summarize or regenerate an existing report, hand off
  directly to `cad-sim-report-agent`; do not select CAD or simulation executor
  skills unless the user also asks to rerun upstream artifacts.
- Do not read full large logs by default; use structured summaries or targeted
  snippets.
- If the goal is already a direct execution request with no ambiguity, produce
  a short plan and hand off to the needed specialist skill.
- If required workspace/version context is missing, ask for it instead of
  guessing.
- Keep the final chat response brief unless the user asks for the full plan.
