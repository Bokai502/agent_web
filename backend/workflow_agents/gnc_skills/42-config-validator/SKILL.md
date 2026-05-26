---
name: 42-config-validator
description: Validate generated 42 configuration artifacts before runtime by checking file existence, cross-file references, manifest traceability, and obvious unsupported content against the audited capability decision.
---

# 42 Config Validator

## Overview

Use this skill after `42-config-author` and before any runtime attempt. The goal is to reject obviously broken 42 configuration packages before they are handed to the simulator.

This skill is configuration-focused. It does not implement FSW and does not assess control performance.

<HARD-GATE>
Do not approve a configuration package for runtime unless the generated files, file references, and manifest traceability have been checked and all blocking findings are resolved.
</HARD-GATE>

## When to Use

Use this skill when generated 42 files already exist and you need to determine whether they are structurally ready for a 42 run.

## Inputs

Required:

- `scenario_facts.json`
- `capability_assessment.json`
- `generated_config_manifest.json`
- generated `04_config/` files

## Required Local Context

Read `references/repo-sources.md` first.

Workspace-local case layout and writable-boundary rules are governed by `WORKSPACE_RULES_FOR_AI.md` at the current workspace root.

Load only the detailed input, sensor, and actuator schemas that correspond to the files actually present in the generated package.

## Preferred Execution Path

Use `scripts/validate_42_config.py` as the primary validator implementation when the required upstream artifacts exist. Fall back to manual checking only if the script is unavailable or clearly insufficient for the specific case.

## Required Checklist

Complete these in order:

1. Confirm required upstream artifacts exist.
2. Check that every manifest-listed file exists.
3. Check `Inp_Sim.txt` references to orbit and spacecraft files.
4. Check spacecraft-file references to node, flex, optics, and related local files.
5. Compare generated content against audited capability boundaries.
6. Confirm that all generator assumptions are represented in the manifest.
7. Emit a bounded validation verdict and route.

## Output Contract

Produce:

- `config_validation_report.md`
- `config_validation_summary.json`
- `requirements_trace.md`
- `requirements_trace.json`

Required summary fields:

- `status`
- `files_checked`
- `missing_files`
- `broken_references`
- `schema_shape_warnings`
- `validation_warnings`
- `unsupported_content_findings`
- `requirement_trace_counts`
- `recommended_next_step`

Allowed status values:

- `pass`
- `pass_with_warnings`
- `fail`

## Stop Conditions

Return `fail` if:

- any manifest-listed file is missing
- `Inp_Sim.txt` references missing orbit or spacecraft files
- generated spacecraft files reference missing required local files
- generated content contradicts `capability_assessment.json`
- unresolved placeholders or TODO markers remain

## Self-Review

Before finishing, check:

1. Did I verify all manifest-listed files?
2. Did I verify all local references that the generated case depends on?
3. Did I catch any case where a surrogate or extension-required item was written as if it were native support?
4. Does the summary route clearly either back to `42-config-author` or forward to `42-build-run-diagnose`?

## Boundaries

Do not:

- rewrite scenario facts
- regenerate configuration files silently
- diagnose mission-level GNC performance
- modify `CFS_FSW`

## Terminal State

The terminal state is a validation report with a clear `pass`, `pass_with_warnings`, or `fail` verdict.

- `fail` returns to `42-config-author`
- `pass` or `pass_with_warnings` closes the requirements/configuration stage
- `42-build-run-diagnose` is optional downstream execution verification, not a prerequisite for completing requirements analysis
