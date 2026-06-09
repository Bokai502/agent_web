# Skill Spec: aignc-42-orchestrator

## Goal

Act as the top-level workflow coordinator for the AIGNC to 42 pipeline.

It should:

- identify the current stage of work
- route to the minimum next leaf skill
- enforce stage gates and blockers
- preserve structured handoff artifacts between stages
- preserve the FSW branch handoff from requirements to architecture to implementation to build/load/run smoke testing, with optional user-requested post-run plotting and FSW review

It should not replace the specialized work of the leaf skills.

## Trigger Conditions

Use it when the user asks for a full workflow or asks what should happen next in the AIGNC pipeline.

Typical requests:

- turn a mission description into a 42 implementation workflow
- decide which skill should run next
- manage the full staged process from scenario intake to 42-ready artifacts

## Inputs

- raw mission description or task document
- or any partial artifact from earlier stages:
  - `scenario_facts.json`
  - `open_questions.json`
  - `capability_assessment.json`
  - generated 42 config files
  - `fsw_requirement_spec.md`
- `fsw_architecture_plan.md`
- `fsw_code_author_report.md`
- `run_summary.json`

## Outputs

Recommended output:

- `workflow_status.md`

Containing:

1. current stage
2. available artifacts
3. missing artifacts
4. recommended next skill
5. blockers

## Routing Rules

- raw scenario -> `aignc-scenario-brainstorm`
- structured scenario, not audited -> `42-capability-auditor`
- audited and config-supported -> `42-config-author`
- generated configuration package needing static checks -> `42-config-validator`
- statically validated package needing optional configuration build/load/run smoke test -> `42-build-run-diagnose`
- fixed `CFS_FSW` behavior request -> `fsw-requirements-extractor`
- structured FSW requirements -> `fsw-architecture-planner`
- architecture-planned FSW package -> `fsw-code-author`
- implemented FSW package needing compile/load/run smoke test -> `42-build-run-diagnose`
- runtime evidence package needing optional plots -> `42-runtime-plotter`
- user explicitly requests FSW behavior/performance review from runtime evidence -> `fsw-tuning-reviewer`
- tuning-review package with implementation-side recommendations -> `fsw-code-author`

## Stage Gates

- unresolved `must_confirm` questions block generation
- unresolved configuration-critical `must_confirm` questions keep the workflow in the scenario clarification loop
- unresolved `blocking_questions` block capability closure
- static configuration validation closes the requirements/configuration stage
- configuration build/load/run smoke testing is optional and must not be treated as a prerequisite for completing requirements analysis
- `42-build-run-diagnose` pass/fail is based only on build success, 42 load/parser success, normal run completion, and basic output presence
- missing structured FSW requirements block implementation planning
- unresolved `blocking_architecture_questions.json` block FSW implementation
- missing architecture package blocks `fsw-code-author`
- missing implementation artifacts block implementation smoke testing
- missing runtime `InOut/` evidence blocks optional standard post-run plotting
- missing runtime evidence blocks user-requested FSW review
- missing tuning-review artifacts block tuning-driven reimplementation when the user explicitly asks to iterate from the review package

## FSW Branch Dependency

The orchestrator must treat `fsw-code-author` as consuming the output of `fsw-architecture-planner`.

Required upstream package:

- `fsw_architecture_plan.md`
- `file_change_map.json`
- `blocking_architecture_questions.json`
- `truth_model_extension_boundary.json`

Recommended supporting package:

- `fsw_requirement_spec.md`
- `mode_table.json`
- `sensor_actuator_contract.json`

The orchestrator must not route into `fsw-code-author` unless the required architecture package exists.

`42-build-run-diagnose` is only a build/load/parser/run smoke test. If the case compiles, loads, runs to normal completion, and emits basic outputs, the orchestrator must treat that stage as passed even if behavior or performance is poor.

For post-run behavior or performance review, route into `fsw-tuning-reviewer` only when the user explicitly asks for that review and runtime evidence exists. `42-runtime-plotter` may be used first when standard figures would help that requested review.

After `fsw-tuning-reviewer`, the orchestrator should normally route back to `fsw-code-author` when the review identifies bounded implementation or tuning corrections. Only route back to `fsw-architecture-planner` when the review identifies an architecture gap.

## Forbidden Actions

- do not directly generate 42 config files
- do not directly write FSW code
- do not bypass blockers
- do not silently substitute for a leaf skill

## Success Criteria

1. workflow state is explicit
2. the next skill decision is minimal and justified
3. blockers remain visible
4. downstream skills can consume the resulting state directly
