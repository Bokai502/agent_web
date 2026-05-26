---
name: aignc-design-closure-auditor
description: Audit whether mission-design inputs and user-confirmed assumptions were carried through the full AIGNC-for-42 workflow correctly, completely, and with the right level of evidence. Use when Codex must independently compare design documents, scenario facts, capability decisions, 42 configuration files, validation artifacts, FSW requirement and architecture packages, code-implementation reports, and runtime evidence, then decide whether the case is closed or must be routed back to an earlier AIGNC stage for rework.
---

# AIGNC Design Closure Auditor

## Overview

Use this as an outer-layer audit skill after some or all AIGNC stages already exist. Its job is not to generate new design content first, but to verify that documented inputs and user inputs were actually propagated into configuration, FSW logic, runtime evidence, and acceptance evidence with the correct closure claim.

This skill is intentionally stricter than the normal workflow stages. It distinguishes:

- `configured`
- `implemented`
- `runtime-exercised`
- `verified_against_requirement`
- `accepted_with_assumption`

Do not collapse those into one bucket.

<HARD-GATE>
Do not claim that a requirement is closed merely because a related file exists. Require direct evidence that the requirement was either configured exactly, intentionally mapped with documented assumptions, or quantitatively verified.
</HARD-GATE>

<HARD-GATE>
Do not treat a first-pass engineering mapping as an exact design-document implementation unless the file content, parameter source, and trace record show that clearly.
</HARD-GATE>

## When To Use

Use this skill when the user asks questions like:

- "Have all design-document requirements really been configured?"
- "Which inputs were only assumed rather than implemented?"
- "Did the simulator settings actually match the design?"
- "Which performance requirements are verified and which are not?"
- "If something is missing, which AIGNC stage must I return to?"
- "Run an independent closure audit against the design requirements."

Use it after any staged AIGNC run, especially when these artifacts exist:

- `scenario_facts.json`
- `42_capability_assessment.md` or `capability_assessment.json`
- `04_config/`
- `05_fsw_requirements/`
- `06_fsw_architecture/`
- `07_fsw_implementation/`
- `08_run/run_report.md` and `run_summary.json`

Do not use this skill as the first scenario-authoring step. It is an audit stage, not a replacement for `aignc-scenario-brainstorm` or the normal orchestrator.

## Sub-Agent Delegation

This skill is intended to run as an independent outer-layer audit after the main AIGNC workflow has already reached its local closure point.

Default policy:

1. if the current session exposes a real multi-agent tool such as `multi_agent_v1`, this skill should by default spawn one independent audit sub-agent
2. if no real multi-agent tool is available in the current session, the main agent may execute the audit locally as a fallback, but it must state that the intended independent sub-agent path was unavailable

Do not wait for the user to explicitly ask for delegation. For this skill, independent audit is the default execution model because the main agent's closure claim must be checked by a separate audit pass whenever tooling permits.

When delegation is available:

- keep the main agent responsible for orchestration, artifact repair, and final integration
- assign the sub-agent one bounded responsibility:
  - independent design-to-artifact closure audit
  - artifact inventory and gap classification
  - performance-evidence review against documented metrics
- prefer `agent_type: explorer` for the audit sub-agent
- use `fork_context: true` only when the sub-agent must inherit the full current thread context
- otherwise pass only the minimum structured inputs:
  - the skill itself
  - the case root
  - the design document or extracted text
  - the exact requested audit outputs
- the sub-agent must not modify code or configuration files
- the sub-agent should write only the audit outputs and supporting inventory outputs

Recommended spawn shape:

```text
Spawn one independent audit sub-agent with this skill and ask it to:
- read the design inputs
- compare them against staged AIGNC artifacts
- produce `design_closure_audit.md`, `design_closure_audit.json`, and `rework_route.json`
- classify every gap by earliest return stage
- avoid making code or config edits itself
```

Do not delegate code or config rewrites to this audit sub-agent. Its role is independent judgment and routing.

## Required Local Context

Read `references/repo-sources.md` first.

Workspace-local case layout and writable-boundary rules are governed by `WORKSPACE_RULES_FOR_AI.md` at the current workspace root.

If a case folder is available, run:

```powershell
python scripts/collect_case_inventory.py --case-root <case-root>
```

Use the inventory only as a starting point. It does not replace reading the actual files that support or fail the audit claim.

## Required Checklist

Complete these in order:

1. Identify the authoritative design-input package.
2. Build the requirement ledger.
3. Compare the ledger against staged AIGNC artifacts.
4. Classify each item by closure status and evidence strength.
5. Route every unresolved or failed item back to the earliest correct AIGNC stage.
6. Produce the audit package.

## 1. Identify The Authoritative Design-Input Package

Use the strongest available inputs in this order:

1. user-confirmed facts in the conversation or structured scenario files
2. structured scenario artifacts such as `scenario_facts.json`
3. the original design document text or extracted notes
4. explicit deferred assumptions recorded by earlier AIGNC stages

Separate:

- `documented requirements`
- `user-confirmed overrides`
- `engineering assumptions added during AIGNC`

Never merge them silently.

## 2. Build The Requirement Ledger

Create a ledger that covers, at minimum:

- orbit and environment
- spacecraft mass and inertia
- initial attitude and body-rate envelope
- sensor inventory and count
- actuator inventory and count
- sensor parameterization
  - sample time
  - FOV
  - noise
  - bias or drift
  - exclusion angles
- actuator parameterization
  - wheel momentum and torque
  - MTB saturation
  - thruster presence or absence
- control mode set
- mode transition conditions
- control-style constraints
  - magnetic-only detumble
  - wheel-based inertial control
  - momentum-dump policy
- performance requirements
  - measurement accuracy
  - pointing accuracy
  - stability
  - maneuver envelope
- validation obligations
  - static trace
  - runtime proof
  - quantitative acceptance evidence

## 3. Compare Against Staged AIGNC Artifacts

Check each requirement against the correct stage artifact, not just the nearest one.

### Scenario And Intent

Use:

- `02_scenario/`
- top-level `scenario_facts.json`
- `open_questions.json`

Ask:

- was the requirement extracted at all?
- was any user correction or override preserved?

### Capability Boundary

Use:

- `03_capability/`
- `42_capability_assessment.md`
- `capability_assessment.json`

Ask:

- was every approximation or unsupported item surfaced explicitly?
- was any exact hardware claim reduced to a generic 42 mapping?

### Configuration

Use:

- `04_config/`
- generated spacecraft, orbit, and input files

Ask:

- was the item configured?
- was it configured exactly, or only approximately?
- is the approximation documented?

### Static Validation

Use:

- `04_config/validation/`
- `requirements_trace.md`
- `config_validation_report.md`

Ask:

- was the requirement traced?
- did validation prove only existence, or also semantic correctness?

### FSW Requirements And Architecture

Use:

- `05_fsw_requirements/`
- `06_fsw_architecture/`
- optional `07_fsw_implementation/`

Ask:

- did the FSW package encode the intended modes, sensors, actuators, and switching rules?
- were performance requirements translated into acceptance targets or only mentioned?

### Implementation And Runtime

Use:

- `fsw_code_author_report.md`
- `run_report.md`
- `run_summary.json`
- runtime telemetry and plots

Ask:

- did runtime exercise the relevant mode or condition?
- is there quantitative evidence for the requirement?
- does the runtime evidence pass, fail, or remain insufficient?

## 4. Use The Closure Status Taxonomy

Assign exactly one primary status per requirement:

- `exactly_implemented`
- `implemented_with_documented_assumption`
- `implemented_but_not_validated`
- `runtime_exercised_but_not_accepted`
- `verified_pass`
- `verified_fail`
- `missing_from_configuration`
- `missing_from_fsw`
- `missing_from_validation`
- `insufficient_evidence`
- `contradicted_by_runtime`

Also assign an evidence grade:

- `direct`
- `inferred`
- `weak`

State when an item is only inferred.

## 5. Route Gaps Back To The Earliest Correct Stage

For every non-closed item, return the earliest correct rework stage:

- `aignc-scenario-brainstorm`
  - requirement missing, ambiguous, or contradicted at input level
- `42-capability-auditor`
  - unsupported approximation was never audited or was over-claimed
- `42-config-author`
  - requirement exists but is not reflected in 42 configuration files
- `42-config-validator`
  - configuration exists but trace or static closure is incomplete
- `fsw-requirements-extractor`
  - mission logic or acceptance requirement never entered the FSW requirement package
- `fsw-architecture-planner`
  - requirement entered FSW requirements but was not mapped to implementation boundaries
- `fsw-code-author`
  - architecture is sound but code does not implement the intended behavior
- `42-build-run-diagnose`
  - implementation exists but runtime proof is missing
- `42-runtime-plotter`
  - runtime data exists but standard evidence plots are missing
- `fsw-tuning-reviewer`
  - runtime exists and architecture is valid, but quantitative behavior fails or remains marginal

When multiple failures exist, report:

- the earliest blocking return stage
- any downstream stages that remain contingent on that fix

## 6. Output Contract

Produce:

- `design_closure_audit.md`
- `design_closure_audit.json`
- `rework_route.json`

The markdown report must include:

1. audit scope
2. authoritative input sources
3. requirement-by-requirement closure table
4. assumptions that remain open
5. failed or unverified requirements
6. exact return stage for each gap
7. overall closure verdict

The JSON should include fields such as:

- `audit_scope`
- `authoritative_inputs`
- `requirements`
- `open_assumptions`
- `blocking_gaps`
- `earliest_return_stage`
- `follow_on_stages`
- `overall_verdict`

## Decision Rules

Use these rules consistently:

- A requirement is not `verified_pass` unless quantitative evidence exists.
- A runtime mode transition does not prove a precision requirement.
- A trace row does not prove a parameter value was configured correctly.
- A generic native 42 sensor block is acceptable only when the approximation is documented.
- If the design document states a metric but no acceptance calculation exists, classify it as `implemented_but_not_validated` or `insufficient_evidence`, not pass.

## Self-Review

Before finishing, check:

1. Did I separate document fact, user override, and AIGNC assumption?
2. Did I distinguish configuration existence from validation closure?
3. Did I route each gap to the earliest correct stage?
4. Did I avoid over-claiming performance verification?

Fix any issue before returning.

## Resources

### scripts/
- `scripts/collect_case_inventory.py`
  - build a deterministic inventory of expected AIGNC artifacts under a case root before the agent begins deeper file reading

### references/
- `references/repo-sources.md`
  - default artifact map and stage-to-file lookup for this audit skill
