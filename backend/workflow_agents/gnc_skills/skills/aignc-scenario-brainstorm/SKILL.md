---
name: aignc-scenario-brainstorm
description: Extract structured AIGNC scenario requirements from natural-language mission descriptions or task documents before any 42 configuration or CFS_FSW code is generated.
---

# AIGNC Scenario Brainstorm

## Path Contract

- `<workspace>` means the backend-injected `workspace_dir`; this skill must use `workspace_dir` as the only source for the active working directory.
- Shared skills live under `open_codex_web/backend/workflow_agents/gnc_skills/skills/`.
- Shared knowledge lives under `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/`.
- Shared 42, bridge, and reference resources live under `codex_web/AIGNC/42/`, `codex_web/AIGNC/bridge/`, and `codex_web/AIGNC/ref/`.


## Overview

Use this skill first when the user is still describing the mission, simulation scenario, or GNC intent in natural language. The job here is to convert ambiguous prose into a structured requirement set, separate facts from assumptions, and identify the smallest set of blocking questions.

This skill does not generate 42 input files and does not modify code.

<HARD-GATE>
Do not generate or modify any 42 input file, and do not start capability auditing, until `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json` and `<workspace>/AIGNC_Workflow/02_scenario/open_questions.json` have been produced and reviewed for blockers.
</HARD-GATE>

<HARD-GATE>
If required information is missing, keep the workflow in the clarification loop. Ask one mission-critical question at a time, update the scenario artifacts after each user answer, and do not hand off to `42-capability-auditor` until there are no configuration-blocking `must_confirm` questions.
</HARD-GATE>

## When to Use

Use this skill when the user asks to:

- analyze a mission description before building a 42 workspace package
- extract simulation requirements from a scenario document
- identify what orbit, sensors, actuators, modes, or outputs are implied
- brainstorm what must be clarified before configuration or FSW work starts

Do not use this skill when the facts are already structured enough to directly audit capabilities or generate files.

## Inputs

Expected inputs are one or more of:

- a natural-language mission or simulation description
- a task document
- user notes about spacecraft, environment, GNC objectives, or outputs

Optional supporting inputs:

- existing `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`
- existing `<workspace>/AIGNC_Workflow/02_scenario/open_questions.json`
- existing workspace files if the user wants a differential update

## Required Local Context

Read `open_codex_web/backend/workflow_agents/gnc_skills/skills/aignc-scenario-brainstorm/references/repo-sources.md` first. Then load only the minimum needed knowledge files it points to.

Default knowledge scope:

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/overview.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/orbit_env.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`

Do not load `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/` unless a specific ambiguity cannot be resolved from the top-level knowledge base.

## Workflow

## Required Checklist

Complete these in order:

1. Read only the minimum project and knowledge context needed.
2. Extract explicit user facts.
3. Record assumptions separately from facts.
4. Identify conflicts and must-confirm questions.
5. Ask the highest-priority missing question if any `must_confirm` item blocks configuration.
6. Update the three required artifacts after each user answer.
7. Repeat the clarification loop until the scenario is sufficient for capability audit.
8. Self-review the artifacts for hidden assumptions and ambiguity.

### 1. Extract explicit facts

Pull out only what the user clearly stated, such as:

- target world or environment
- orbit class or altitude
- spacecraft count
- sensor or actuator constraints
- required mission phases
- requested outputs and acceptance metrics

### 2. Record only minimal assumptions

If an assumption is needed to keep the analysis moving, record it explicitly as an assumption rather than silently turning it into a fact.

### 3. Detect ambiguity that changes implementation

Prioritize ambiguities that materially change the 42 mapping, for example:

- "earth-pointing" meaning LVLH tracking versus target observation
- truth-state control versus measurement-based control
- one-axis pointing versus full three-axis attitude definition
- whether a requested sensor or actuator must be physically modeled

### 4. Produce structured outputs

Return three artifacts:

- `<workspace>/AIGNC_Workflow/02_scenario/scenario_understanding.md`
- `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`
- `<workspace>/AIGNC_Workflow/02_scenario/open_questions.json`

If the environment does not require file creation, provide the same structures in the response in clearly labeled sections.

### 5. Run the clarification loop

If information is missing, ask exactly one question per assistant turn.

Question priority:

1. Target world and orbit definition.
2. Spacecraft count and template assumptions.
3. Formation geometry or relative state.
4. Propagation method or whether independent spacecraft or relative motion is intended.
5. Required sensors, actuators, and whether measurement closure is needed.
6. Required outputs and validation metrics.

After each user answer:

- update `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`
- remove or downgrade resolved entries from `<workspace>/AIGNC_Workflow/02_scenario/open_questions.json`
- add any new conflicts or must-confirm questions uncovered by the answer
- continue asking until no configuration-blocking `must_confirm` entries remain

Only then may the workflow hand off to `42-capability-auditor`.

## Output Contract

Write all output artifacts under `<workspace>/AIGNC_Workflow/02_scenario/`. AI-consumed copies, extracted text, and input inventories belong under `<workspace>/AIGNC_Workflow/01_inputs/`.

Append step-level status entries to `<workspace>/AIGNC_Workflow/workflow_log.md` when this skill starts, after input inventory/copying, fact extraction, assumption separation, conflict detection, open-question update, blocker decision, and final scenario-package handoff. Entries must record timestamp, stage `01_inputs` or `02_scenario`, current skill `aignc-scenario-brainstorm`, step id or step name, status, concise description, key inputs checked, outputs updated, and next action or handoff target. Do not log private reasoning; log only workflow state and handoff-relevant decisions.

### scenario_understanding.md

Should summarize:

1. mission objective
2. platform and environment
3. GNC intent
4. likely 42 mapping
5. unresolved questions

### scenario_facts.json

Should contain normalized, machine-usable facts. Keep it conservative. Unknown values should remain null or absent instead of being invented.

### open_questions.json

Should separate:

- `must_confirm`
- `should_confirm`
- `assumptions_if_silent`
- `conflicts_detected`

## Stop Conditions

Stop and ask for clarification if any of the following are true:

- the same mission phrase has multiple physically different interpretations
- spacecraft count, reference world, or core GNC goal is missing
- the request mixes incompatible assumptions
- the user is implicitly asking for a truth-model extension without acknowledging it

## Self-Review

Before handing off, check:

1. Does every non-user-stated value appear under assumptions rather than facts?
2. Are implementation-changing ambiguities listed in `must_confirm`?
3. Is the scenario narrow enough for one capability audit?
4. Are there any placeholders, vague fields, or contradictory statements?

Fix issues inline before declaring the scenario ready for audit.

## Boundaries

Do not:

- generate `<workspace>/AIGNC_Workflow/04_config/Inp_Sim.txt`, `Orb_*.txt`, or `SC_*.txt`
- decide final 42 support status
- modify `CFS_FSW` code
- hide uncertainty behind polished prose

The next downstream skill is typically `42-capability-auditor`.

## Terminal State

The terminal state is a scenario package ready for `42-capability-auditor`, or a single next clarification question. Do not proceed to configuration generation from this skill.

If the terminal state is clarification, ask only the next highest-priority question and wait for the user's answer.

Structured progress must also be updated in `<workspace>/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>`, matching the numbered stage used for `<workspace>/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the stage run. Keep the current skill name in the `--skill` field instead of embedding it in the loop name. Set `--note` to one concise frontend-display sentence, no more than 160 characters, describing the current action, blocker, failure, or completion result for the stage.
