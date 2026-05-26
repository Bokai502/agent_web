---
name: 42-config-author
description: Generate or modify valid 42 configuration files from approved scenario facts and audited capability decisions, using existing case templates whenever practical.
---

# 42 Config Author

## Overview

Use this skill only after scenario facts are stable and 42 support has already been audited. The job is to create the minimum valid 42 case that reflects the approved scenario without inventing unsupported capabilities.

This skill generates or updates 42 input files. It does not implement FSW algorithms.

<HARD-GATE>
Do not write or modify 42 configuration files until scenario facts are stable, capability audit is complete, and blocking questions are resolved or explicitly deferred.
</HARD-GATE>

## When to Use

Use this skill when the request has already been reduced to approved facts and the user wants:

- a new 42 case
- modifications to existing `InOut` case files
- a minimal runnable configuration based on a structured scenario

## Inputs

Required:

- `scenario_facts.json`
- `open_questions.json`
- `capability_assessment.json`

Optional:

- target output folder or file naming convention
- specific templates to reuse
- existing case files to patch rather than recreate

## Required Local Context

Read `references/repo-sources.md` first.

Workspace-local case layout and writable-boundary rules are governed by `WORKSPACE_RULES_FOR_AI.md` at the current workspace root.

Default knowledge scope:

- `knowledge/42/inputs.md`
- `knowledge/42/orbit_env.md`
- `knowledge/42/sensors.md`
- `knowledge/42/actuators.md`
- `knowledge/42/limitations.md`
- `knowledge/42/examples.md`

Default structured indexes:

- `knowledge/42/capabilities/inputs.json`
- `knowledge/42/capabilities/sensors.json`
- `knowledge/42/capabilities/actuators.json`
- `knowledge/42/capabilities/orbit_env.json`

Load detailed schemas only for the files and components that will actually be written.

## Workflow

## Required Checklist

Complete these in order:

1. Verify required upstream artifacts.
2. Select template strategy per target file.
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

### 2. Build the minimum runnable case first

Prioritize:

- valid syntax
- internally consistent cross-file references
- a runnable case structure

Do not front-load optional output files or elaborate command scripts unless the request requires them.

### 3. Apply only audited assumptions

Anything marked `requires_extension` must not be silently encoded into the files as if it already exists.

### 4. Emit traceable generation metadata

Produce:

- `generated_config_manifest.json`
- `config_generation_summary.md`

The manifest should record:

- created files
- modified files
- templates reused
- assumptions applied
- follow-up items

## Output Contract

Typical outputs include some subset of:

- `Inp_Sim.txt`
- `Orb_*.txt`
- `SC_*.txt`
- `Inp_Cmd.txt`
- `Inp_*Output.txt`

The exact set depends on the scenario scope and the user's requested deliverables.

## Stop Conditions

Stop and ask for clarification if:

- core orbit reference information is missing
- spacecraft count or file ownership is unclear
- a required field is absent from the known schema and was not pre-approved as an extension
- the user asks for mutually inconsistent file content

## Self-Review

Before handing off, check:

1. Do all file references point to files that were created, reused, or intentionally left external?
2. Is every generated value traceable to scenario facts, audited assumptions, or a named template?
3. Are all `requires_extension` items excluded from config files and listed as follow-up?
4. Does `generated_config_manifest.json` list files created, files modified, templates reused, and assumptions applied?
5. Are there any placeholders, TODOs, or unexplained defaults in generated files?

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
