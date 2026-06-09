---
name: 42-config-author
description: Generate or modify valid 42 configuration files from approved scenario facts and audited capability decisions, using existing workspace templates whenever practical.
---

# 42 Config Author

## Path Contract

- `<workspace>` means the backend-injected `workspace_dir`; this skill must use `workspace_dir` as the only source for the active working directory.
- Shared skills live under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/`.
- Shared knowledge lives under `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/`.
- Shared 42, bridge, and reference resources live under `codex_web/AIGNC/42/`, `codex_web/AIGNC/bridge/`, and `codex_web/AIGNC/ref/`.


## Overview

Use this skill only after scenario facts are stable and 42 support has already been audited. The job is to create the minimum valid 42 workspace package that reflects the approved scenario without inventing unsupported capabilities.

This skill generates or updates 42 input files. It does not implement FSW algorithms.

<HARD-GATE>
Do not write or modify 42 configuration files until scenario facts are stable, capability audit is complete, and blocking questions are resolved or explicitly deferred.
</HARD-GATE>

## When to Use

Use this skill when the request has already been reduced to approved facts and the user wants:

- a new 42 workspace package
- modifications to existing `InOut` workspace files
- a minimal runnable configuration based on a structured scenario

## Inputs

Required:

- `<workspace>/AIGNC_Workflow/02_scenario/scenario_facts.json`
- `<workspace>/AIGNC_Workflow/02_scenario/open_questions.json`
- `<workspace>/AIGNC_Workflow/03_capability/capability_assessment.json`

Optional:

- target output folder or file naming convention
- specific templates to reuse
- existing workspace files to patch rather than recreate

## Required Local Context

Read `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/42-config-author/references/repo-sources.md` first.

Workspace-local layout and writable-boundary rules are governed by `codex_web/AIGNC/AGENT.md`.

Default knowledge scope:

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/orbit_env.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/examples.md`

Default structured indexes:

- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/inputs.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/sensors.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/actuators.json`
- `demo_server/open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/orbit_env.json`

Load detailed schemas only for the files and components that will actually be written.

## Workflow

## Required Checklist

Complete these in order:

1. Verify required upstream artifacts.
2. Select template strategy and identify the minimal mutable file set.
3. Load only the detailed schemas for files and components being written.
4. Generate the minimum runnable configuration.
5. Check cross-file references.
6. Write manifest and summary.
7. Self-review for unsupported assumptions and missing traceability.

### 1. Choose a template strategy

For each target file, decide whether to:

- reuse and patch an existing `InOut` file
- adapt a `Demo` template
- generate a minimal file from scratch

Prefer the closest working template over unnecessary clean-room regeneration.

For ordinary satellite scenarios, use the current workspace template as a complete configuration package and keep the mutable set narrow by default. Copy or reuse the ancillary template files unchanged, then fully author the core configuration files:

- `<workspace>/AIGNC_Workflow/04_config/Inp_Sim.txt`
- the `Orb_*.txt` files referenced by `Inp_Sim.txt`
- the `SC_*.txt` files referenced by `Inp_Sim.txt`

These core files must not be treated as partial patches with unrelated template placeholders left in place. Fill every required line in each core file deliberately from one of these sources:

- explicit user requirement or `scenario_facts.json` value
- audited assumption from `capability_assessment.json`
- documented default from the selected template that is physically applicable to the requested satellite
- explicit conservative default recorded in the manifest and summary

If a required core-file field materially changes the mission interpretation and cannot be derived from those sources, stop and ask the user one blocking question rather than leaving the template value as a silent placeholder.

Treat these as template-support files that should usually be copied unchanged unless the user request explicitly touches their function:

- `Inp_Cmd.txt`
- `Inp_AcOutput.txt`
- `Inp_ScOutput.txt`
- `Inp_Graphics.txt`
- `Inp_CommLink.txt`
- `Inp_FOV.txt`
- `Inp_IPC.txt`
- `Inp_Region.txt`
- `Inp_Shaker.txt`
- `Inp_TDRS.txt`
- `Flex_*.txt`
- `Readme.txt`

Only expand the mutable set when scenario facts or user instructions require a command timeline, output telemetry change, graphics/FOV change, comm-link model, IPC setup, region/contact model, shaker/flex model, TDRS setup, or another ancillary feature. Record unchanged copied files in `generated_config_manifest.json` as reused template support files rather than modified files.

### 2. Fully author the core runnable case first

Prioritize:

- valid syntax
- internally consistent cross-file references
- a runnable case structure
- complete mission-specific values in `Inp_Sim.txt`, referenced `Orb_*.txt`, and referenced `SC_*.txt`

For the core files, inspect and decide each required field line-by-line. Do not preserve template values merely because the user did not mention that line. Either map the field to the user-approved scenario, retain it as a documented applicable default, or ask a blocking question when the value is mission-defining and unknown.

Do not front-load optional output files or elaborate command scripts unless the request requires them.

### 3. Apply only audited assumptions

Anything marked `requires_extension` must not be silently encoded into the files as if it already exists.

### 4. Emit traceable generation metadata

Produce under `<workspace>/AIGNC_Workflow/04_config/`:

- `<workspace>/AIGNC_Workflow/04_config/generated_config_manifest.json`
- `<workspace>/AIGNC_Workflow/04_config/config_generation_summary.md`

Append step-level status entries to `<workspace>/AIGNC_Workflow/workflow_log.md` when this skill starts, after upstream verification, template selection, each config file generation or patching group, cross-file reference check, manifest emission, summary writing, and final handoff to validation. Entries must use stage `04_config`, current skill `42-config-author`, step id or step name, status, timestamp, concise description, key inputs checked, outputs updated, and next action or handoff target. Do not log private reasoning.
Structured progress must also be updated in `<workspace>/AIGNC_Workflow/loop_progress.json` at the same checkpoints using `python3 demo_server/open_codex_web/backend/workflow_agents/gnc_skills/skills/common/scripts/update_loop_progress.py`. Use loop name `<stage_id>_<skill_name>`, matching the numbered stage used for `<workspace>/AIGNC_Workflow/workflow_log.md`, and keep percentage monotonic within the skill run.


The manifest should record:

- created files
- modified files
- templates reused
- core-file field decisions for `Inp_Sim.txt`, referenced `Orb_*.txt`, and referenced `SC_*.txt`
- assumptions applied
- conservative defaults retained and why they are applicable
- follow-up items

## Output Contract

For ordinary satellite scenarios, the primary generated or patched files are normally:

- `<workspace>/AIGNC_Workflow/04_config/Inp_Sim.txt`
- `<workspace>/AIGNC_Workflow/04_config/Orb_*.txt` referenced by `Inp_Sim.txt`
- `<workspace>/AIGNC_Workflow/04_config/SC_*.txt` referenced by `Inp_Sim.txt`

The config package may also include copied support files from the selected template, such as `Inp_Cmd.txt`, `Inp_AcOutput.txt`, `Inp_ScOutput.txt`, `Inp_Graphics.txt`, `Inp_CommLink.txt`, `Inp_FOV.txt`, `Inp_IPC.txt`, `Inp_Region.txt`, `Inp_Shaker.txt`, `Inp_TDRS.txt`, `Flex_*.txt`, and `Readme.txt`. Do not modify those support files unless the scenario explicitly requires it.

The exact set depends on the scenario scope and the user's requested deliverables, but the manifest must distinguish files created or modified from files copied unchanged as template support. For the core files, the manifest and summary must also show that every mission-defining field was either set from user-approved facts, retained as an applicable documented default, or deferred behind a user-facing blocking question.

## Stop Conditions

Stop and ask for clarification if:

- core orbit reference information is missing
- spacecraft count or file ownership is unclear
- a mission-defining `Inp_Sim.txt`, `Orb_*.txt`, or `SC_*.txt` field cannot be traced to an approved fact, audited assumption, or applicable documented default
- a required field is absent from the known schema and was not pre-approved as an extension
- the user asks for mutually inconsistent file content

## Self-Review

Before handing off, check:

1. Do all file references point to files that were created, reused, or intentionally left external?
2. Is every generated value traceable to scenario facts, audited assumptions, or a named template?
3. Were all required lines in `Inp_Sim.txt`, referenced `Orb_*.txt`, and referenced `SC_*.txt` reviewed and deliberately set or retained?
4. Are all `requires_extension` items excluded from config files and listed as follow-up?
5. Does `<workspace>/AIGNC_Workflow/04_config/generated_config_manifest.json` list files created, files modified, templates reused, core-file field decisions, assumptions applied, and retained defaults?
6. Are there any placeholders, TODOs, or unexplained defaults in generated files?

Fix issues inline before marking configuration generation complete.

## Boundaries

Do not:

- re-audit 42 capabilities from scratch
- write unsupported models into configuration as if they exist
- generate complex command timelines without enough basis
- modify `CFS_FSW` source code

The next downstream skill is typically `42-config-validator`.

## Terminal State

The terminal state is a traceable 42 configuration artifact set plus metadata, ready for `42-config-validator`. Do not transition to FSW implementation from this skill.

Do not write final runtime configuration files directly to `<workspace>/Config/`; that directory is populated only after `42-config-validator` passes.

