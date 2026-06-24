---
name: planner
description: "Plan CAD and thermal simulation workflow steps from the user's goal, workspace context, and failure evidence without editing configuration files."
---

# Planner

Use this skill to decide what the CAD/thermal workflow should do before any
configuration edits or execution commands run.

Planner is a planning and handoff skill. It must not edit files, run CAD
commands, run simulation commands, or write final report artifacts.

## Core Flow

1. Resolve the selected `workspace_dir`, `workspace_id`, and `version_id` from
   the execution context.
2. Inspect only lightweight workspace state needed to plan: manifest metadata,
   `00_inputs` filenames, progress summaries, stage result summaries, and
   targeted failure snippets when relevant.
3. Convert the user goal or Debugger suggestions into an ordered workflow plan.
4. Identify the specialist skill that should perform each step.
5. State required inputs, expected artifacts, validation gates, and stop
   conditions.
6. Use `workflow-diagram-writer` for every planned thermal workflow that
  will proceed to execution workflow.
7. Treat `executionFlowData.json` as the source of progress loop names:
   only nodes with `kind: "run"` become `<workspace>/logs/progress.json`
   loop keys, and each node carries its frontend display `progress` field.

## Main Handoffs

- `config-editor` applies required `00_inputs` configuration changes.
- `cad-builder` builds and validates CAD artifacts, including placeholder box
  GLB, supplemental real assembly GLB, simulation STEP/input files, after-state
  metadata, and CAD output validation.
- `simulation-skill` runs thermal simulation and postprocess validation.
- `cad-sim-report-agent` reviews existing artifacts and writes final reports.
- `workflow-diagram-writer` writes
  `00_inputs/workflow_diagram/executionFlowData.json` after the plan is known.

The standard CAD build input is `00_inputs/cad_build_spec.json`. Do not ask for
screenshot-provided JSON files as CAD build inputs.

## Common Plans

For a full CAD plus thermal workflow, plan this sequence:

1. `workflow-diagram-writer`.
2. `config-editor` if `00_inputs/cad_build_spec.json` must change.
3. `cad-builder`.
4. `simulation-skill run`.
5. `cad-sim-report-agent` only when the user asks for reporting or review.

If the goal is already a direct execution request with no ambiguity, produce a
short plan and hand off to the needed specialist skill only after applying the
mandatory workflow-diagram handoff rule below.

## References

Read only the references needed for the current request:

- `references/cad-skill-selection.md` for choosing CAD build skills.
- `references/execution-gates.md` for simulation and report readiness gates.
- `references/debug-loop.md` for failed executor reruns and retry planning.
- `references/report-policy.md` for report, review, summary, or final-report
  requests.
- `references/workflow-overview.md` when a full stage-by-stage workflow summary
  is needed.

## Rules

- Do not edit files.
- Do not write `<workspace>/logs/progress.json` or node `progress` fields
  directly. Progress is updated by
  `open_codex_web/backend/workflow_agents/agents/progress_cli.py` after
  `workflow-diagram-writer` creates `executionFlowData.json`.
- If required workspace/version context is missing, ask for it instead of
  guessing.
- Keep the final chat response brief unless the user asks for the full plan.
