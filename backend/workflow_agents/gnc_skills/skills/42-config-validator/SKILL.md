---
name: 42-config-validator
description: Validate generated 42 configuration artifacts before runtime by checking file existence, cross-file references, manifest traceability, core-file field completion, and obvious unsupported content against the audited capability decision.
---

# 42 Config Validator

## Path Contract

- `<workspace>` means the backend-injected `workspace_dir`; this skill must use `workspace_dir` as the only source for the active working directory.
- Shared skills live under `open_codex_web/backend/workflow_agents/gnc_skills/skills/`.
- Shared knowledge lives under `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/`.
- Shared 42, bridge, and reference resources live under `codex_web/AIGNC/42/`, `codex_web/AIGNC/bridge/`, and `codex_web/AIGNC/ref/`.


## Overview

Use this skill after `42-config-author` and before any runtime attempt. The goal is to reject obviously broken 42 configuration packages before they are handed to the simulator.

This skill is configuration-focused. It does not implement FSW and does not assess control performance.

<HARD-GATE>
Do not approve a configuration package for runtime unless the generated files, file references, core-file field decisions, and manifest traceability have been checked and all blocking findings are resolved.
</HARD-GATE>

## When to Use

Use this skill when generated 42 files already exist and you need to determine whether they are structurally ready for a 42 run.

## Inputs

Required:

- `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`
- `<workspace>/AIGNC_Workflow/03_capability/capability_assessment.json`
- `<workspace>/AIGNC_Workflow/04_config/generated_config_manifest.json`
- generated `<workspace>/AIGNC_Workflow/04_config/` files

## Required Local Context

Read `open_codex_web/backend/workflow_agents/gnc_skills/skills/42-config-validator/references/repo-sources.md` first.

Workspace-local layout and writable-boundary rules are governed by `codex_web/AIGNC/AGENT.md`.

Load only the detailed input, sensor, and actuator schemas that correspond to the files actually present in the generated package.

## Preferred Execution Path

Use `open_codex_web/backend/workflow_agents/gnc_skills/skills/42-config-validator/scripts/validate_42_config.py` as the primary validator implementation when the required upstream artifacts exist. Fall back to manual checking only if the script is unavailable or clearly insufficient for the specific case.

Run it with the backend-injected workspace:

```bash
python3 open_codex_web/backend/workflow_agents/gnc_skills/skills/42-config-validator/scripts/validate_42_config.py --workspace-dir <workspace>
```

The script auto-discovers the project root by locating `codex_web/AIGNC` and `open_codex_web`. Pass `--project-root` only when that discovery is unavailable.

## Required Checklist

Complete these in order:

1. Confirm required upstream artifacts exist.
2. Check that every manifest-listed file exists.
3. Check `<workspace>/AIGNC_Workflow/04_config/Inp_Sim.txt` references to orbit and spacecraft files.
4. Identify the core file set: `Inp_Sim.txt`, referenced `Orb_*.txt`, and referenced `SC_*.txt`.
5. Verify manifest field-decision traceability for every mission-defining field in the core file set.
6. Check spacecraft-file references to node, flex, optics, and related local files.
7. Check that support files copied from the template were not modified unless the manifest records a scenario-driven reason.
8. Compare generated content against audited capability boundaries.
9. Confirm that all generator assumptions, conservative defaults, and retained template defaults are represented in the manifest.
10. Emit a bounded validation verdict and route.

## Output Contract

Produce under `<workspace>/AIGNC_Workflow/04_config/validation/`:

- `<workspace>/AIGNC_Workflow/04_config/validation/config_validation_report.md`
- `<workspace>/AIGNC_Workflow/04_config/validation/config_validation_summary.json`
- `<workspace>/AIGNC_Workflow/04_config/validation/requirements_trace.md`
- `<workspace>/AIGNC_Workflow/04_config/validation/requirements_trace.json`

Append step-level status entries to `<workspace>/AIGNC_Workflow/workflow_log.md` when this skill starts, after required artifact verification, manifest verification, `Inp_Sim` reference checks, spacecraft local-reference checks, capability-boundary checks, validation artifact writing, validation verdict emission, and any successful sync from `<workspace>/AIGNC_Workflow/04_config/` to `<workspace>/00_inputs/Config/`. Entries must use stage `04_config`, current skill `42-config-validator`, step id or step name, status, timestamp, concise description, key inputs checked, outputs updated, and next action or handoff target. Do not log private reasoning.
Structured progress must also be updated in `<workspace>/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>`, matching the numbered stage used for `<workspace>/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the stage run. Keep the current skill name in the `--skill` field instead of embedding it in the loop name. Set `--note` according to the shared frontend-display note contract in `open_codex_web/backend/workflow_agents/gnc_skills/skills/README.md`.


Required summary fields:

- `status`
- `files_checked`
- `core_files_checked`
- `support_files_checked`
- `missing_files`
- `broken_references`
- `missing_core_field_decisions`
- `unjustified_template_defaults`
- `unexpected_support_file_modifications`
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
- `<workspace>/AIGNC_Workflow/04_config/Inp_Sim.txt` references missing orbit or spacecraft files
- generated spacecraft files reference missing required local files
- any mission-defining field in `Inp_Sim.txt`, referenced `Orb_*.txt`, or referenced `SC_*.txt` lacks a manifest field decision, approved source, or documented applicable default
- a support file was modified without a scenario-driven reason recorded in the manifest
- generated content contradicts `<workspace>/AIGNC_Workflow/03_capability/capability_assessment.json`
- unresolved placeholders or TODO markers remain

## Self-Review

Before finishing, check:

1. Did I verify all manifest-listed files?
2. Did I verify all local references that the generated case depends on?
3. Did I verify that `Inp_Sim.txt`, referenced `Orb_*.txt`, and referenced `SC_*.txt` were fully authored rather than partially patched with silent template placeholders?
4. Did I verify that retained core-file defaults are documented as applicable defaults?
5. Did I verify that unchanged support files are distinguished from modified support files?
6. Did I catch any case where a surrogate or extension-required item was written as if it were native support?
7. Does the summary route clearly either back to `42-config-author` or forward to `42-build-run-diagnose`?

## Boundaries

Do not:

- rewrite scenario facts
- regenerate configuration files silently
- diagnose mission-level GNC performance
- modify `CFS_FSW`

## Terminal State

The terminal state is a validation report with a clear `pass`, `pass_with_warnings`, or `fail` verdict.

- `fail` returns to `42-config-author`
- `pass` or `pass_with_warnings` closes the requirements/configuration stage and copies runtime-ready configuration files from `<workspace>/AIGNC_Workflow/04_config/` to `<workspace>/00_inputs/Config/`
- `42-build-run-diagnose` is optional downstream execution verification, not a prerequisite for completing requirements analysis
