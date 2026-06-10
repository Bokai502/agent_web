# 42 Simulator Configuration Workflow, Current Version

## Scope

This document describes the current AIGNC workflow for generating 42 simulator configuration artifacts from natural-language mission input or a task document.

This version is configuration-only. It does not implement or modify `CFS_FSW` source code.

The workflow is intentionally split into two boundaries:

1. requirements/configuration closure, which ends at static validation;
2. optional runtime verification, which may be used later to prove that the validated package can execute in 42.

## Requirements and Configuration Chain

The active chain for requirements analysis and 42 configuration generation is:

```text
User natural language or task document
 -> aignc-42-orchestrator
 -> aignc-scenario-brainstorm
 -> 42-capability-auditor
 -> 42-config-author
 -> 42-config-validator
 -> statically validated 42 configuration artifacts
```

## Optional Runtime Verification Chain

If later requested, the validated package can enter a separate runtime-verification stage:

```text
validated 42 configuration artifacts
 -> 42-build-run-diagnose
 -> runtime-verified 42 workspace package
```

The following skill is intentionally out of scope for this configuration-only chain:

```text
fsw-requirements-extractor
```

It remains available for later FSW work, but it is not required to complete the 42 input-file configuration flow.

## Later FSW Branch

When the user wants mission-specific `CFS_FSW` work after configuration has been statically validated, use the later branch:

```text
statically validated 42 configuration artifacts
 -> fsw-requirements-extractor
 -> fsw-architecture-planner
 -> fsw-code-author
 -> 42-build-run-diagnose
```

This branch is separate from the configuration-only closure and should not be entered before the validated configuration package exists.

## Stage 0: Orchestration

Skill:

- `open_codex_web/backend/workflow_agents/gnc_skills/skills/aignc-42-orchestrator/SKILL.md`

Purpose:

- Identify the current workflow stage.
- Route to the minimum next leaf skill.
- Prevent configuration generation while upstream blockers remain.
- Keep facts, assumptions, and blockers separate.

Inputs:

- raw mission description
- task document
- existing partial artifacts

Outputs:

- workflow stage summary
- next-skill recommendation
- blocker summary

Stage gate:

- If the user input has not yet been converted into structured facts, route to `aignc-scenario-brainstorm`.
- If structured facts exist but capability has not been audited, route to `42-capability-auditor`.
- If capability has been audited and simulation configuration is supported, route to `42-config-author`.

## Stage 1: Scenario Understanding

Skill:

- `open_codex_web/backend/workflow_agents/gnc_skills/skills/aignc-scenario-brainstorm/SKILL.md`

Purpose:

- Convert natural language into structured scenario facts.
- Separate explicit facts, assumptions, conflicts, and open questions.
- Avoid generating any 42 files at this stage.

Default knowledge sources:

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/overview.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/orbit_env.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`

Expected outputs:

- `scenario_understanding.md`
- `scenario_facts.json`
- `open_questions.json`

Key rule:

- Unknown values should remain unknown. This stage must not fill missing spacecraft, orbit, sensor, actuator, or environment data by invention.

Stage gate:

- If `open_questions.json.must_confirm` is non-empty, the workflow stops and asks the user.
- If there are only non-blocking assumptions, those assumptions must be preserved for the capability audit and generation manifest.

Clarification loop:

- Ask one mission-critical question at a time.
- Update `scenario_facts.json` and `open_questions.json` after each user answer.
- Continue until the information is sufficient to run `42-capability-auditor`.
- Do not advance to `42-config-author` while configuration-blocking `must_confirm` entries remain.

## Stage 2: Capability Audit

Skill:

- `open_codex_web/backend/workflow_agents/gnc_skills/skills/42-capability-auditor/SKILL.md`

Purpose:

- Decide whether the requested configuration is supported by current 42.
- Distinguish direct support, support with assumptions, and required extensions.
- Prevent closest-template matches from being misrepresented as native support.

Default knowledge sources:

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/orbit_env.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/limitations.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/examples.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/*.json`

Progressive disclosure:

- Use `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/` only when the audit depends on a concrete field, parameter, or model-interface rule.

Expected outputs:

- `42_capability_assessment.md`
- `capability_assessment.json`

Required verdict values:

- `supported`
- `supported_with_assumptions`
- `requires_extension`

Stage gate:

- If any configuration-critical item is `requires_extension`, `42-config-author` must not encode that item as if it already exists.
- If `blocking_questions` is non-empty, the workflow stops and asks the user.

## Stage 3: Configuration Authoring

Skill:

- `open_codex_web/backend/workflow_agents/gnc_skills/skills/42-config-author/SKILL.md`

Purpose:

- Generate or modify valid 42 configuration files from approved scenario facts and audited capability decisions.
- Prefer patching the closest working template over unnecessary clean-room generation.
- Produce traceable metadata for all assumptions and file changes.

Default knowledge sources:

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/inputs.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/orbit_env.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/sensors.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/actuators.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/examples.md`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/inputs.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/sensors.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/actuators.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/capabilities/orbit_env.json`

Detailed schemas used on demand:

- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/inp_sim.schema.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/orb.schema.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/sc.schema.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/inp_cmd.schema.json`
- `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/inputs/output_files.schema.json`
- relevant sensor schemas under `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/sensors/`
- relevant actuator schemas under `open_codex_web/backend/workflow_agents/gnc_skills/knowledge/42/details/actuators/`

Typical generated files:

- `Inp_Sim.txt`
- `Orb_*.txt`
- `SC_*.txt`
- `Inp_Cmd.txt`
- `Inp_*Output.txt`

Required metadata outputs:

- `generated_config_manifest.json`
- `config_generation_summary.md`

Stage gate:

- All generated files must be traceable to scenario facts, audited assumptions, or explicitly selected templates.
- Unsupported or extension-required items must remain listed as follow-up work instead of being silently written into 42 input files.

## Stage 4: Configuration Validation

Skill:

- `open_codex_web/backend/workflow_agents/gnc_skills/skills/42-config-validator/SKILL.md`

Purpose:

- Check that generated files are internally consistent before a 42 run.
- Verify that all file references resolve.
- Verify that assumptions used during generation are captured in the manifest.
- Catch obvious configuration-shape mistakes before runtime.

Expected outputs:

- `config_validation_report.md`
- `config_validation_summary.json`

Stage gate:

- If validation returns `fail`, the workflow returns to `42-config-author`.
- Only `pass` and `pass_with_warnings` may proceed to runtime.

## Optional Stage 5: Build / Run / Diagnose

Skill:

- `open_codex_web/backend/workflow_agents/gnc_skills/skills/42-build-run-diagnose/SKILL.md`

Purpose:

- Run the generated case through 42.
- Detect load failures and immediate runtime failures.
- Confirm that the configuration package is actually usable by the simulator.

This stage is outside the requirements-analysis and static-configuration boundary.

Expected outputs:

- `run_report.md`
- `run_summary.json`

Stage gate:

- If the generated case cannot load, return to `42-config-author`.
- If the case runs, the configuration-only chain is considered closed.

## Recommended Work Package Layout

For repeatable use, each run should write intermediate and final artifacts into `<workspace>/AIGNC_Workflow/`:

```text
<workspace>/AIGNC_Workflow/
  02_scenario/
    scenario_understanding.md
    scenario_facts.json
    open_questions.json
  03_capability/
    42_capability_assessment.md
    capability_assessment.json
  04_config/
    Inp_Sim.txt
    Orb_<case>.txt
    SC_<case>.txt
    generated_config_manifest.json
    config_generation_summary.md
    validation/
      config_validation_report.md
      config_validation_summary.json
  08_run/
    run_report.md
    run_summary.json
```

For direct edits to the workspace `Config/` directory, the same metadata files should still be created under `<workspace>/AIGNC_Workflow/`.

## Configuration Closure Definition

In the current version, the requirements/configuration chain is considered closed when:

1. User input has been converted into structured scenario facts.
2. All blocking questions have been resolved or explicitly deferred.
3. Current 42 support has been audited.
4. Generated or modified 42 input files are internally referenced consistently.
5. The configuration validator passes without blocking findings.
6. All assumptions and template choices are recorded in `generated_config_manifest.json`.

Runtime verification is a separate optional closure:

1. A validated package is prepared for execution.
2. 42 can load and run the generated case.
3. Runtime findings are recorded without redefining requirements-stage success.

## Current Gaps

The configuration chain is sufficient to produce 42 input-file artifacts, but it is not yet a full simulation execution loop.

Missing or deferred pieces:

- A complete schema for every low-level 42 input field.
- A stronger machine-checking layer than the first-pass validator for deep semantic constraints.
- A formal policy for whether generated files should patch `InOut/` directly or be written to isolated work packages by default.

These gaps do not block a first closed loop, but they still matter for automation quality.

## Current Version Assessment

The current configuration-only chain is coherent for:

- scenario intake
- ability boundary checking
- traceable 42 input-file generation
- progressive-disclosure use of detailed schemas

It is not yet sufficient for:

- automatic FSW code implementation
- mission-level GNC performance diagnosis
- automatic retuning after a failed run

The next practical improvement after this closure is to connect the validated configuration chain to the later `CFS_FSW` requirements and implementation branch.
