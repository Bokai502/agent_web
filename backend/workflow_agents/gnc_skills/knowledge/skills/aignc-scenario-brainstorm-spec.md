# Skill Spec: aignc-scenario-brainstorm

## Goal

Extract structured simulation and GNC scenario requirements from natural-language mission input or task documents.

The skill must separate:

- confirmed facts
- assumptions
- conflicts
- open questions

It must not generate 42 configuration files or modify code.

## Trigger Conditions

Use this skill when the user provides a raw or partially specified mission scenario and expects the AIGNC workflow to understand it before generation.

Typical requests:

- build a 42 scenario from a mission description
- analyze what information is needed for a simulation case
- convert a task document into structured 42/GNC requirements

## Inputs

Required:

- user natural-language mission description or task document

Optional:

- existing scenario facts
- existing open questions
- existing workspace files for comparison

## Outputs

Required artifacts:

- `scenario_understanding.md`
- `scenario_facts.json`
- `open_questions.json`

## Required Workflow

Complete these steps in order:

1. Read only the minimum project and knowledge context needed.
2. Extract explicit user facts.
3. Record assumptions separately from facts.
4. Identify conflicts and must-confirm questions.
5. Ask the highest-priority missing question if any `must_confirm` item blocks configuration.
6. Update the three required artifacts after each user answer.
7. Repeat the clarification loop until the scenario is sufficient for capability audit.
8. Self-review the artifacts for hidden assumptions and ambiguity.

## Clarification Loop

If required information is missing, the skill must keep asking the user questions.

Rules:

- Ask exactly one mission-critical question per assistant turn.
- After each answer, update `scenario_facts.json` and `open_questions.json`.
- Continue until no configuration-blocking `must_confirm` questions remain.
- Do not silently fill missing information with defaults unless the user explicitly accepts the default.
- Do not hand off to `42-capability-auditor` until the scenario has enough information for a meaningful audit.

Question priority:

1. Target world and orbit definition.
2. Spacecraft count and template assumptions.
3. Formation geometry or relative state.
4. Propagation method or independent-versus-relative motion intent.
5. Sensors, actuators, and measurement-closure requirements.
6. Output and validation requirements.

## Stop Conditions

Stop and ask the next clarification question when:

- the same phrase has multiple physical meanings
- spacecraft count, reference world, or orbit definition is missing
- formation geometry is missing for a formation task
- the user mixes incompatible assumptions
- the request implies a truth-model extension but does not acknowledge it

## Self-Review

Before handoff, check:

1. Does every non-user-stated value appear under assumptions rather than facts?
2. Are implementation-changing ambiguities listed in `must_confirm`?
3. Is the scenario narrow enough for one capability audit?
4. Are there placeholders, vague fields, or contradictions?

Fix issues before declaring the scenario ready for audit.

## Forbidden Actions

- Do not generate `Inp_Sim.txt`, `Orb_*.txt`, or `SC_*.txt`.
- Do not decide final 42 support status.
- Do not modify `CFS_FSW` code.
- Do not hide uncertainty behind polished prose.

## Terminal State

The terminal state is either:

- a scenario package ready for `42-capability-auditor`
- exactly one next clarification question for the user
