---
name: aignc-42-orchestrator
description: Coordinate the end-to-end AIGNC workflow for 42 by routing scenario analysis, capability auditing, configuration generation, fixed CFS_FSW requirements extraction, FSW architecture planning, code implementation, runtime diagnosis, standard post-run plotting, and the iterative FSW tuning-review loop back into fsw-code-author.
---

# AIGNC 42 Orchestrator

## Overview

Use this as the top-level skill when the user wants a full AIGNC workflow rather than a single local task. This skill decides which leaf skill should run next, enforces stage gates, and keeps facts, assumptions, and blockers separated across the workflow.

This skill is a coordinator. It should not absorb the detailed reasoning or generation work of the leaf skills.

<HARD-GATE>
Do not generate 42 configuration files, write source code, or make capability claims directly from the orchestrator. Route to the appropriate leaf skill and require its output before advancing the workflow.
</HARD-GATE>

<HARD-GATE>
When `open_questions.json.must_confirm` contains configuration-blocking questions, keep routing back to `aignc-scenario-brainstorm`. Do not advance to capability audit or configuration generation until those questions are answered or explicitly deferred by the user.
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
- partial case files
- prior stage artifacts such as `scenario_facts.json`, `open_questions.json`, `capability_assessment.json`, `fsw_requirement_spec.md`, `fsw_architecture_plan.md`, `fsw_code_author_report.md`, or `run_summary.json`

## Required Local Context

Read `references/repo-sources.md` first.

Workspace-local case layout and writable-boundary rules are governed by `WORKSPACE_RULES_FOR_AI.md` at the current workspace root.

Default knowledge scope:

- `knowledge/42/overview.md`
- `knowledge/42/limitations.md`
- `knowledge/42/cfs_fsw_architecture.md`
- `knowledge/skills/README.md`
- the leaf skill specs under `knowledge/skills/`

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
- structured FSW requirements, not yet architecture-planned
- architecture-planned FSW package, not yet implemented
- implemented FSW package, not yet runtime-diagnosed
- runtime-diagnosed FSW package with unresolved performance issues
- tuning-reviewed FSW package ready for another implementation iteration
- blocked pending user clarification

### 2. Route to the minimum next leaf skill

Use the smallest valid next step:

- raw scenario -> `aignc-scenario-brainstorm`
- structured scenario -> `42-capability-auditor`
- audited and configuration-supported request -> `42-config-author`
- generated configuration package needing static checks -> `42-config-validator`
- statically validated package needing optional runtime proof -> `42-build-run-diagnose`
- fixed `CFS_FSW` behavior request -> `fsw-requirements-extractor`
- structured FSW requirements -> `fsw-architecture-planner`
- architecture package ready for implementation -> `fsw-code-author`
- implemented FSW package needing execution proof -> `42-build-run-diagnose`
- runtime evidence needing standard telemetry figures -> `42-runtime-plotter`
- runtime evidence showing performance or behavior problems -> `fsw-tuning-reviewer`
- tuning-review package recommending local implementation changes -> `fsw-code-author`

### 3. Enforce stage gates

Do not allow downstream generation when upstream blockers remain. Typical gates:

- unresolved `must_confirm` questions block configuration generation
- unresolved configuration-critical `must_confirm` questions block capability audit unless the audit can explicitly evaluate the missing item as unknown
- unresolved `blocking_questions` block capability closure
- static configuration validation closes the requirements/configuration stage
- runtime proof is optional and must not be treated as a prerequisite for completing requirements analysis
- missing structured FSW requirements block implementation planning
- unresolved `blocking_architecture_questions.json` entries block `fsw-code-author`
- missing architecture artifacts block FSW code implementation
- missing implementation artifacts block FSW runtime diagnosis
- missing runtime `InOut/` evidence blocks standard post-run plotting
- runtime performance review requires runtime evidence artifacts such as `run_report.md` and `run_summary.json`
- tuning-driven reimplementation requires `fsw_tuning_review.md` or `fsw_tuning_hypotheses.json`

### 4. Normalize handoff artifacts

Ensure each stage leaves behind artifacts the next stage can consume. If an artifact is missing or structurally weak, route back to the stage that should repair it instead of guessing.

### 5. Report the next action clearly

Always make explicit:

- the current stage
- which artifacts already exist
- what is missing
- which leaf skill should run next
- what blocker prevents further progress

If the workflow is in clarification, the next action must be exactly one user-facing question, not a list of configuration actions.

## Output Contract

Produce a concise workflow status summary, optionally as `workflow_status.md`, containing:

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

- `fsw-code-author` input is the upstream architecture package from `fsw-architecture-planner`
  - `fsw_architecture_plan.md`
  - `file_change_map.json`
  - `blocking_architecture_questions.json`
  - `truth_model_extension_boundary.json`

Do not route into `fsw-code-author` before those artifacts exist.

For the post-run FSW loop, the orchestrator must preserve this iterative dependency explicitly:

- `fsw-tuning-reviewer` consumes runtime evidence after `42-build-run-diagnose`
- `42-runtime-plotter` is the standard post-run figure generator once runtime `InOut/` data exists
- when the review points to local implementation or tuning issues, the next route is back to `fsw-code-author`
- only route back to `fsw-architecture-planner` when the review identifies an architecture gap rather than a local implementation problem

## Success Criteria

This skill is successful when:

1. workflow state is explicit
2. the next skill decision is minimal and justified
3. blockers stop the pipeline early instead of leaking into generation
4. artifacts remain traceable across stages
