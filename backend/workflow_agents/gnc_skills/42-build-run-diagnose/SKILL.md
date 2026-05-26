---
name: 42-build-run-diagnose
description: Run a validated 42 configuration package, capture load or runtime failures, verify expected outputs appear, and return a bounded diagnosis that routes either back to configuration authoring or forward as configuration-chain complete.
---

# 42 Build Run Diagnose

## Overview

Use this skill after `42-config-validator` passes. The goal is to prove that the generated 42 case can actually load and execute.

This skill is a downstream execution-verification step. It does not define success for the requirements-analysis or static-configuration stage, and it still does not implement or tune `CFS_FSW`.

When runtime telemetry exists, use `$42-runtime-plotter` after the run to generate the standard post-run figures.

## When to Use

Use this skill only when a generated 42 case has already passed structural validation and runtime confirmation is explicitly desired.

## Inputs

Required:

- validated case package
- `config_validation_summary.json`

Optional:

- preferred run mode
- permission to rebuild 42 if needed
- `fsw_code_author_report.md`
- `fsw_change_set.json`

When this skill is used after `fsw-code-author`, treat those implementation artifacts as supporting diagnosis context only. They do not replace the validated case package.

## Required Local Context

Read `references/repo-sources.md` first.

Workspace-local case layout and writable-boundary rules are governed by `WORKSPACE_RULES_FOR_AI.md` at the current workspace root.

Load only the minimum repository context needed to execute the case and interpret failures.

## Required Checklist

Complete these in order:

1. Confirm validator output allows runtime.
2. Decide whether existing build artifacts are usable or whether rebuild is needed.
3. Select the lowest-risk runtime mode for validation.
4. Run the case.
5. Generate standard post-run figures with `$42-runtime-plotter` when runtime telemetry exists.
6. Capture load failures, runtime failures, and basic output presence.
7. Classify the failure or pass status.
8. Emit a bounded diagnosis and route.

## Output Contract

Produce:

- `run_report.md`
- `run_summary.json`

When standard runtime telemetry exists, also generate and show:

- `gnc_body_angular_velocity_xyz.png`
- `gnc_orbit_attitude_error_xyz.png`
- `gnc_reaction_wheel_speed.png`

Required summary fields:

- `status`
- `build_action_taken`
- `run_mode`
- `output_files_detected`
- `primary_failure_cause`
- `recommended_return_stage`

Allowed status values:

- `run_pass`
- `run_pass_needs_followup`
- `run_fail_config`
- `run_fail_runtime`

## Stop Conditions

If the case cannot load due to configuration problems, stop and route back to `42-config-author`.

If the case loads and runs but mission-level GNC work remains, record runtime proof and note follow-up work rather than overreaching into FSW tuning.

If the case loads and runs but implemented `CFS_FSW` behavior or mission-level performance is wrong, route the next stage to `fsw-tuning-reviewer` rather than trying to tune inside this skill.

## Self-Review

Before finishing, check:

1. Did I clearly separate configuration failure from later FSW-performance concerns?
2. Did I avoid silently patching case files during diagnosis?
3. Does the summary clearly separate runtime proof from requirements/configuration-stage success?

## Boundaries

Do not:

- redesign the scenario
- retune control laws
- perform post-run FSW tuning review
- claim mission success from mere runtime pass
- modify `CFS_FSW` source code in this stage

## Terminal State

The terminal state is a runtime verdict plus a route: either runtime proof is recorded, or the case returns to configuration authoring for correction.
