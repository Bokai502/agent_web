# 42 Config Validator Skill Spec

## Purpose

`42-config-validator` is the post-generation gate for the AIGNC-to-42 configuration workflow.

It answers one narrow question:

> Are the generated 42 configuration artifacts internally consistent enough to justify a real 42 run?

This skill does not implement FSW and does not assess control performance.

## Position in Workflow

```text
aignc-42-orchestrator
 -> aignc-scenario-brainstorm
 -> 42-capability-auditor
 -> 42-config-author
 -> 42-config-validator
 -> 42-build-run-diagnose
```

## Inputs

Required:

- `scenario_facts.json`
- `capability_assessment.json`
- `generated_config_manifest.json`
- generated `03_config/` files

Optional:

- explicit target work-package root
- repository `InOut/` target if files were written in place

## Core Responsibilities

1. Verify that all manifest-listed files exist.
2. Verify cross-file references:
   - `Inp_Sim.txt` orbit-file references
   - `Inp_Sim.txt` spacecraft-file references
   - spacecraft references to node, flex, optics, and related files
3. Check that generated artifacts respect approved support boundaries.
4. Confirm that all generation-time assumptions are captured in the manifest.
5. Emit a bounded validation verdict.

## Explicit Non-Goals

Do not:

- re-run scenario understanding
- re-audit broad 42 capability from scratch
- implement `CFS_FSW`
- tune control laws
- treat runtime physics performance as a configuration-validator concern

## Output Contract

Produce:

- `config_validation_report.md`
- `config_validation_summary.json`

Required summary fields:

- `status`: `pass`, `pass_with_warnings`, or `fail`
- `files_checked`
- `missing_files`
- `broken_references`
- `schema_shape_warnings`
- `unsupported_content_findings`
- `recommended_next_step`

## Fail Conditions

Return `fail` if any of these are true:

- a manifest-listed file is missing
- `Inp_Sim.txt` references files that do not exist
- a generated `SC_*.txt` references required local files that do not exist
- generated content contradicts `capability_assessment.json`
- generated files contain unresolved placeholders or TODO markers

## Pass-With-Warnings Conditions

Use `pass_with_warnings` when:

- the workspace package is structurally runnable
- assumptions are explicit
- remaining issues are documented approximations rather than hard blockers

## Return Paths

- `pass` or `pass_with_warnings` -> `42-build-run-diagnose`
- `fail` -> return to `42-config-author`

## Knowledge Sources

Primary:

- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`
- `agent-web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/*.json`
- relevant sensor and actuator detail schemas used by the generated case

Secondary:

- source templates and generated files themselves

## Product Rationale

This skill exists because configuration generation without an independent validation gate is too brittle. The generator should not be trusted to certify its own outputs.
