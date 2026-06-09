---
name: aignc-42-orchestrator
description: Coordinate the end-to-end AIGNC workflow for 42 by routing scenario analysis, capability auditing, configuration generation, static validation, configuration build/load/run smoke testing, fixed CFS_FSW requirements extraction, user-confirmed GNC interface-contract freezing, FSW architecture planning, code implementation, optional downstream FSW review when explicitly requested, and mandatory design-closure auditing before any workspace is declared closed.
---

# AIGNC 42 Orchestrator

## Path Contract

- `<workspace>` means the backend-injected `workspace_dir`; this skill must use `workspace_dir` as the only source for the active working directory.
- Shared skills live under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/`.
- Shared knowledge lives under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/`.
- Shared 42, bridge, and reference resources live under `codex_web/AIGNC/42/`, `codex_web/AIGNC/bridge/`, and `codex_web/AIGNC/ref/`.


## Overview

Use this as the top-level skill when the user wants a full AIGNC workflow rather than a single local task. This skill decides which leaf skill should run next, enforces stage gates, and keeps facts, assumptions, and blockers separated across the workflow.

This skill is a coordinator. It should not absorb the detailed reasoning or generation work of the leaf skills.

<HARD-GATE>
Do not generate 42 configuration files, write source code, or make capability claims directly from the orchestrator. Route to the appropriate leaf skill and require its output before advancing the workflow.
</HARD-GATE>

<HARD-GATE>
When `open_questions.json.must_confirm` contains configuration-blocking questions, keep routing back to `aignc-scenario-brainstorm`. Do not advance to capability audit or configuration generation until those questions are answered or explicitly deferred by the user.
</HARD-GATE>


<HARD-GATE>
For the FSW branch, do not route to `fsw-architecture-planner` or `fsw-code-author` until `<workspace>/AIGNC_Workflow/05_fsw_requirements/gnc_interface_contract.md` exists, was created from the required template in `fsw-requirements-extractor/references/gnc_interface_contract_template.md`, has all mission-relevant semantic fields fully populated, has `Status: Frozen_By_User`, and has no required `TBD`, `Unknown`, blank, unresolved-alternative, or `Pending` confirmation entries for the requested behavior. The agent may draft the contract, but must not mark it frozen without explicit user confirmation in the conversation.
</HARD-GATE>


<HARD-GATE>
Do not declare an AIGNC-for-42 workspace package complete or closed until `aignc-design-closure-auditor` has produced `<workspace>/AIGNC_Workflow/10_reports/design_closure_audit.md`, `<workspace>/AIGNC_Workflow/10_reports/design_closure_audit.json`, and `<workspace>/AIGNC_Workflow/10_reports/rework_route.json`. If the closure audit reports rework, route to the earliest indicated failed stage instead of claiming closure.
</HARD-GATE>

## When to Use

Use this skill when the user asks to:

- turn a mission description into a 42 implementation workflow
- drive analysis from raw scenario text to structured 42 artifacts
- decide the next AIGNC stage instead of invoking a leaf skill directly
- manage a staged pipeline with explicit blockers and handoffs

Do not use this skill when the request is already narrowly scoped to one leaf task.

## Inputs

Possible inputs include:

- raw mission descriptions
- task documents
- partial workspace files
- prior stage artifacts such as `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`, `<workspace>/AIGNC_Workflow/02_scenario/open_questions.json`, `<workspace>/AIGNC_Workflow/03_capability/capability_assessment.json`, `<workspace>/AIGNC_Workflow/05_fsw_requirements/fsw_requirement_spec.md`, `<workspace>/AIGNC_Workflow/05_fsw_requirements/gnc_interface_contract.md`, `<workspace>/AIGNC_Workflow/06_fsw_architecture/fsw_architecture_plan.md`, `<workspace>/AIGNC_Workflow/07_fsw_implementation/fsw_code_author_report.md`, `<workspace>/AIGNC_Workflow/08_run/run_summary.json`, or `<workspace>/AIGNC_Workflow/10_reports/design_closure_audit.json`

## Required Local Context

Read `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/aignc-42-orchestrator/references/repo-sources.md` first.

Workspace-local layout and writable-boundary rules are governed by `codex_web/AIGNC/AGENT.md`.

All AI workflow stage artifacts must be located under `<workspace>/AIGNC_Workflow/`, including `01_inputs/`, `02_scenario/`, `03_capability/`, `04_config/`, `05_fsw_requirements/`, `06_fsw_architecture/`, `07_fsw_implementation/`, `08_run/`, `09_*`, and `10_reports/`. Final validated runtime configuration is synchronized to `<workspace>/Config/`; real build and simulation execution are under `<workspace>/Output/Run/`.

Maintain `<workspace>/AIGNC_Workflow/workflow_log.md` as the design-process status log. At orchestration start, after each internal checklist step, after every routing or stage-gate action, when blocked, and at handoff/completion, append a numbered entry with timestamp, stage id, current skill, step id or step name, status, concise description, key input artifacts checked, key output artifacts written or updated, and next action or handoff target when known. Do not store chain-of-thought; log only externally useful workflow state, evidence, decisions, blockers, and handoff facts.

Default knowledge scope:

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/overview.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/cfs_fsw_architecture.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/skills/README.md`
- the leaf skill specs under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/skills/`

Do not load 42 detailed schemas unless the route decision depends on a concrete field-level limitation.

## Workflow

## Required Checklist

Complete these in order:

1. Identify the current workflow stage.
2. Check whether required upstream artifacts exist.
3. Check whether blockers or must-confirm questions remain.
4. If blockers remain, route back to the clarification loop and ask only the next blocking question.
5. Route to exactly one minimum next leaf skill.
6. State the terminal condition for the current turn.

### 1. Determine the current stage

Classify the request as one of:

- raw scenario intake
- structured scenario, not yet audited
- audited scenario, not yet configured
- simulation configuration path complete, but FSW requirements not yet structured
- structured FSW requirements, not yet user-confirmed by a frozen GNC interface contract
- structured FSW requirements with `gnc_interface_contract.md` frozen by the user, not yet architecture-planned
- architecture-planned FSW package, not yet implemented
- implemented FSW package, not yet build/load/run smoke-tested
- runtime smoke-tested package with user-requested FSW behavior review
- runtime evidence and reports ready, not yet design-closure audited
- design-closure audit passed, case ready to close
- design-closure audit found gaps and must route to an earlier stage
- reviewed FSW package ready for another implementation iteration
- blocked pending user clarification

### 2. Route to the minimum next leaf skill

Use the smallest valid next step:

- raw scenario -> `aignc-scenario-brainstorm`
- structured scenario -> `42-capability-auditor`
- audited and configuration-supported request -> `42-config-author`
- generated configuration package needing static checks -> `42-config-validator`
- statically validated package needing optional configuration build/load/run smoke test -> `42-build-run-diagnose`
- fixed `CFS_FSW` behavior request -> `fsw-requirements-extractor`
- structured FSW requirements without a frozen user-confirmed `gnc_interface_contract.md` -> stop for user confirmation or route back to `fsw-requirements-extractor` to draft/repair the contract
- structured FSW requirements with `gnc_interface_contract.md` status `Frozen_By_User` -> `fsw-architecture-planner`
- architecture package ready for implementation and still consistent with the frozen contract -> `fsw-code-author`
- implemented FSW package needing compile/load/run smoke test -> `42-build-run-diagnose`
- runtime evidence needing optional standard telemetry figures -> `42-runtime-plotter`
- user explicitly requests FSW behavior or performance review from runtime evidence -> `fsw-tuning-reviewer`
- tuning-review package recommending local implementation changes -> `fsw-code-author`
- runtime evidence plus report package ready for final closure -> `aignc-design-closure-auditor`
- closure audit passes with no rework route -> declare case closed
- closure audit reports rework -> route to the earliest failed stage named in `rework_route.json`

### 3. Enforce stage gates

Do not allow downstream generation when upstream blockers remain. Typical gates:

- unresolved `must_confirm` questions block configuration generation
- unresolved configuration-critical `must_confirm` questions block capability audit unless the audit can explicitly evaluate the missing item as unknown
- unresolved `blocking_questions` block capability closure
- static configuration validation closes the requirements/configuration stage
- configuration build/load/run smoke testing is optional and must not be treated as a prerequisite for completing requirements analysis
- `42-build-run-diagnose` pass/fail is based only on build success, 42 load/parser success, normal run completion, and basic output presence; it must not judge behavior or performance
- missing structured FSW requirements block implementation planning
- missing, non-template, incomplete, non-frozen, or user-unconfirmed `<workspace>/AIGNC_Workflow/05_fsw_requirements/gnc_interface_contract.md` blocks FSW architecture planning and FSW code implementation
- a `gnc_interface_contract.md` containing required `TBD`, `Unknown`, blank semantic fields, unresolved alternatives, `Pending` confirmations, or unresolved coordinate/sensor/environment/mode-timer/actuator/control/guidance/verification semantics blocks FSW architecture planning until repaired and re-confirmed by the user
- unresolved `<workspace>/AIGNC_Workflow/06_fsw_architecture/blocking_architecture_questions.json` entries block `fsw-code-author`
- missing architecture artifacts block FSW code implementation
- missing implementation artifacts block implementation smoke testing
- missing runtime `InOut/` evidence blocks optional standard post-run plotting
- FSW behavior/performance review requires an explicit user request plus runtime evidence artifacts such as `<workspace>/AIGNC_Workflow/08_run/run_report.md` and `<workspace>/AIGNC_Workflow/08_run/run_summary.json`
- tuning-driven reimplementation requires `<workspace>/AIGNC_Workflow/09_tuning_review/fsw_tuning_review.md` or `<workspace>/AIGNC_Workflow/09_tuning_review/fsw_tuning_hypotheses.json`
- final case closure requires `<workspace>/AIGNC_Workflow/10_reports/design_closure_audit.md`, `<workspace>/AIGNC_Workflow/10_reports/design_closure_audit.json`, and `<workspace>/AIGNC_Workflow/10_reports/rework_route.json` from `aignc-design-closure-auditor`
- a closure audit with any required rework blocks final closure and must route to the earliest failed stage recorded in `rework_route.json`

### 4. Normalize handoff artifacts

Ensure each stage leaves behind artifacts the next stage can consume. If an artifact is missing or structurally weak, route back to the stage that should repair it instead of guessing.

### 5. Update workflow status log

Append to `<workspace>/AIGNC_Workflow/workflow_log.md` whenever orchestration starts, identifies a current stage, checks upstream artifacts, completes a gate check, routes to a leaf skill, receives a leaf-stage result, becomes blocked, or changes the recommended next stage. Use numbered entries consistent with the workflow directories, for example `02_scenario`, `03_capability`, `04_config`, `05_fsw_requirements`, `06_fsw_architecture`, `07_fsw_implementation`, `08_run`, `09_tuning_review`, and `10_reports`.

Each entry must include:

- `timestamp`
- `stage`
- `current_skill`
- `step_id` or `step_name`
- `status`
- `description`
- `inputs_checked`
- `outputs_updated`
- `next_action`

### 6. Report the next action clearly

Always make explicit:

- the current stage
- which artifacts already exist
- what is missing
- which leaf skill should run next
- what blocker prevents further progress

If the workflow is in clarification, the next action must be exactly one user-facing question, not a list of configuration actions.

## Output Contract

Produce a concise workflow status summary, optionally as `<workspace>/AIGNC_Workflow/workflow_status.md`, containing:

1. current stage
2. available artifacts
3. missing artifacts
4. recommended next leaf skill
5. remaining blockers

If no file is needed, present the same structure directly in the response.

## Self-Review

Before finishing, check:

1. Did the route depend on an artifact that does not exist?
2. Did the response bypass a blocker?
3. Did the response do work that belongs to a leaf skill?
4. Is the next skill recommendation unambiguous?

Fix any issue before returning.

## Boundaries

Do not:

- replace a leaf skill by doing its full job inline
- generate 42 config files
- claim support verdicts without the capability auditor
- write FSW source code
- collapse assumptions and facts into one bucket

For the FSW branch, the orchestrator must preserve this handoff dependency explicitly:

- `fsw-code-author` input is the upstream architecture package from `fsw-architecture-planner`, plus the user-frozen GNC interface contract that the architecture package mapped
  - `<workspace>/AIGNC_Workflow/05_fsw_requirements/gnc_interface_contract.md` with `Status: Frozen_By_User`
  - `<workspace>/AIGNC_Workflow/06_fsw_architecture/fsw_architecture_plan.md`
  - `<workspace>/AIGNC_Workflow/06_fsw_architecture/file_change_map.json`
  - `<workspace>/AIGNC_Workflow/06_fsw_architecture/blocking_architecture_questions.json`
  - `<workspace>/AIGNC_Workflow/06_fsw_architecture/truth_model_extension_boundary.json`

Do not route into `fsw-code-author` before those artifacts exist and remain consistent with the frozen `gnc_interface_contract.md`.

For optional post-run FSW review, the orchestrator must preserve this dependency explicitly:

- `42-build-run-diagnose` only verifies that the workspace package builds, loads, parses, runs to normal completion, and emits basic outputs; a run pass is not a behavior or performance verdict
- `42-runtime-plotter` is optional evidence generation once runtime `InOut/` data exists
- route to `fsw-tuning-reviewer` only when the user explicitly asks to analyze FSW behavior/performance from runtime evidence
- when that review points to local implementation or tuning issues, the next route is back to `fsw-code-author`
- only route back to `fsw-architecture-planner` when the review identifies an architecture gap rather than a local implementation problem

## Final Closure Dependency

Before reporting that an AIGNC-for-42 workspace package is complete, the orchestrator must route through `aignc-design-closure-auditor` after runtime evidence and the final report package exist. The closure auditor is the only stage that may decide whether the workspace is closed or must return to an earlier AIGNC stage for rework. A design report, runtime plots, or successful 42 run is not by itself a closure verdict.

## Success Criteria

This skill is successful when:

1. workflow state is explicit
2. the next skill decision is minimal and justified
3. blockers stop the pipeline early instead of leaking into generation
4. artifacts remain traceable across stages
5. final closure is withheld until `aignc-design-closure-auditor` produces a pass/no-rework audit package

Structured progress must also be updated in `<workspace>/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>_<skill_name>`, matching the numbered stage used for `<workspace>/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the skill run.
