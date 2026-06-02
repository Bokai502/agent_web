---
name: 42-capability-auditor
description: Assess whether a requested mission scenario is supported by the current 42 simulator and fixed CFS_FSW architecture, and identify assumptions, gaps, or required extensions.
---

# 42 Capability Auditor

## Overview

Use this skill after scenario understanding is available. Its job is to judge what the current 42 codebase can do, what it can do only with assumptions, and what requires model or code extension.

This skill does not generate final configuration files and does not write FSW control code.

<HARD-GATE>
Do not proceed to configuration generation while any configuration-critical item is `requires_extension` or any `blocking_questions` remain unresolved.
</HARD-GATE>

## When to Use

Use this skill when the user asks:

- whether 42 can support a given task or mission
- which parts of a requested scenario are native, approximate, or unsupported
- whether a new sensor, actuator, or environment requires extension
- whether the fixed `CFS_FSW` path is sufficient for the requested GNC behavior

## Inputs

Required:

- `workspace_dir/AIGNC_Workflow/02_scenario/scenario_facts.json`
- `workspace_dir/AIGNC_Workflow/02_scenario/open_questions.json`

Optional:

- mission description text
- prior workspace configuration files
- user clarification answers

## Required Local Context

Read `skills/42-capability-auditor/references/repo-sources.md` first. Prefer the top-level capability documents and machine-readable indexes before consulting any detailed schema.

Default knowledge scope:

- `knowledge/42/inputs.md`
- `knowledge/42/sensors.md`
- `knowledge/42/actuators.md`
- `knowledge/42/cfs_fsw_architecture.md`
- `knowledge/42/cfs_fsw_interfaces.md`
- `knowledge/42/cfs_fsw_extension_rules.md`
- `knowledge/42/orbit_env.md`
- `knowledge/42/limitations.md`
- `knowledge/42/examples.md`

Use `knowledge/42/details/` only when a verdict depends on a specific field, parameter, or model-interface detail.

## Workflow

## Required Checklist

Complete these in order:

1. Verify that `workspace_dir/AIGNC_Workflow/02_scenario/scenario_facts.json` and `workspace_dir/AIGNC_Workflow/02_scenario/open_questions.json` exist or are provided.
2. Split the request into auditable items.
3. Classify each item as `supported`, `supported_with_assumptions`, or `requires_extension`.
4. Record blockers and unsupported items explicitly.
5. Recommend the next workflow route.
6. Self-review for unsupported-template overclaiming.

### 1. Break the request into audit items

Audit separately:

- orbit and environment
- spacecraft multiplicity or formation assumptions
- sensors
- actuators
- integrated payload subsystems, such as `FSM + focal-plane camera/DWS`
- `CFS_FSW` architectural fit
- required outputs or diagnostics

### 2. Assign one of three statuses per item

Every audited item must be labeled as exactly one of:

- `supported`
- `supported_with_assumptions`
- `requires_extension`

Do not use vague verdicts.

### 3. Surface blockers

Create explicit blockers when:

- the user requests a sensor or actuator that does not exist in current 42
- a task requires a truth-model extension
- a task depends on a physical interpretation that is still ambiguous
- the requested environment invalidates a native model, such as Earth-only GPS assumptions

When the request includes an optical payload with both emission and reception behavior, audit it in two layers:

- native 42 truth-model support
- current repo sidecar and FSW support

Required interpretation for current repo state:

- native 42 optical payload object with parser support in `42init.c` / `42sensors.c` / `42joints.c` is **not** native support
- current repo support for inter-satellite optical link simulation through:
  - platform `OPTICAL_BUS_HOLD`
  - `AcOpticalPayload` sidecar
  - `AcOpticalLink` scan / acquisition / hold / fine-track supervisor
  is an available supported path in this codebase

Therefore:

- if the user accepts the current repo architecture, classify `FSM + focal-plane camera/DWS optical payload` as `supported` or `supported_with_assumptions` depending on remaining mission assumptions
- if the user explicitly requires a native 42 payload object or native 42 parser/truth-model implementation, classify it as `requires_extension`

### 4. Recommend the next route

Typical routes are:

- proceed to `42-config-author`
- proceed to `fsw-requirements-extractor`
- ask the user blocking questions
- start a model-extension workflow instead of configuration generation

## Output Contract

Produce under `workspace_dir/AIGNC_Workflow/03_capability/`:

- `workspace_dir/AIGNC_Workflow/03_capability/42_capability_assessment.md`
- `workspace_dir/AIGNC_Workflow/03_capability/capability_assessment.json`

Append step-level status entries to `workspace_dir/AIGNC_Workflow/workflow_log.md` when this skill starts, after upstream artifact verification, audit item decomposition, each major support-classification pass, blocker detection, verdict artifact writing, and final route recommendation. Entries must use stage `03_capability`, current skill `42-capability-auditor`, step id or step name, status, timestamp, concise externally useful description, key inputs checked, outputs updated, and next action or handoff target. Do not log private reasoning.
Structured progress must also be updated in `workspace_dir/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>_<skill_name>`, matching the numbered stage used for `workspace_dir/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the skill run.


The JSON should include:

- overall status
- configuration support verdict
- fixed `CFS_FSW` support verdict
- whether truth-model extension is required
- supported items
- assumption-bound items
- required-extension items
- blocking questions

For optical-payload cases, include explicit fields when relevant:

- `native_42_optical_payload_support`
- `sidecar_optical_payload_support`
- `optical_link_fsw_support`
- `native_truth_model_extension_required`

## Stop Conditions

Stop and ask for clarification if:

- the requested physical meaning is still ambiguous
- support depends on a truth-model versus FSW-only boundary the user has not resolved
- multiple incompatible implementations are possible

For optical link tasks, this boundary must be made explicit:

- sidecar / FSW optical payload path
- native 42 payload path

Do not silently collapse them into one verdict.

## Self-Review

Before handing off, check:

1. Does every audited item have exactly one of the three allowed verdicts?
2. Are closest templates clearly distinguished from native support?
3. Are all `requires_extension` items prevented from silent configuration generation?
4. Are blockers phrased as actionable user questions?

Fix issues inline before marking the audit complete.

## Boundaries

Do not:

- generate configuration files
- silently downgrade `requires_extension` to a template reuse claim
- state that a closest template equals native support
- modify `CFS_FSW`

Do not report the current `AcOpticalPayload` / `AcOpticalLink` path as native 42 support.

The next downstream skill is typically `42-config-author` or `fsw-requirements-extractor`.

## Terminal State

The terminal state is a capability artifact bundle ready for `42-config-author`, or a blocker artifact bundle requiring user clarification or model-extension work.
