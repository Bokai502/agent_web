# Review: 42 Configuration Skill Chain

## Scope

This review checks whether the current AIGNC skill chain can support natural-language to 42 simulator configuration generation.

It compares the current local skills against two superpowers reference patterns:

- `brainstorming`
- `writing-plans`

The focus is skill structure, boundary definition, stage gates, and self-review behavior.

## Reference Patterns Observed

The superpowers skills use several strong design patterns:

1. Hard gates are explicit and near the top of the skill.
2. Each skill has a required checklist, not only a loose workflow.
3. The terminal state is clear: the skill knows what comes next and what it must not do.
4. Self-review is required before handoff.
5. Boundary violations are written as anti-patterns or forbidden actions.
6. Complex work is decomposed before implementation.

## Current AIGNC Configuration Chain

Current configuration-only chain:

```text
User natural language or task document
 -> aignc-42-orchestrator
 -> aignc-scenario-brainstorm
 -> 42-capability-auditor
 -> 42-config-author
 -> 42 configuration artifacts
```

This is the correct scope for configuration generation.

`fsw-requirements-extractor` remains outside the configuration-only chain.

## Findings

### Finding 1: The stage split is sound

The chain has the right major decomposition:

- orchestration
- scenario understanding
- capability audit
- configuration authoring

This prevents the most dangerous failure mode: generating 42 files directly from vague natural language.

### Finding 2: The original skills were too descriptive

Before this review, the skills described responsibilities well, but they did not enforce enough process.

The main missing pieces were:

- explicit hard gates
- required ordered checklists
- self-review criteria
- terminal-state wording

These are now added to:

- `agent-web/backend/workflow_agents/gnc_skills/skills/aignc-42-orchestrator/SKILL.md`
- `agent-web/backend/workflow_agents/gnc_skills/skills/aignc-scenario-brainstorm/SKILL.md`
- `agent-web/backend/workflow_agents/gnc_skills/skills/42-capability-auditor/SKILL.md`
- `agent-web/backend/workflow_agents/gnc_skills/skills/42-config-author/SKILL.md`

### Finding 3: The chain can produce normal 42 configuration, not full 42 coverage

The current knowledge base and details schemas support the common configuration set:

- `Inp_Sim.txt`
- `Orb_*.txt`
- `SC_*.txt`
- `Inp_Cmd.txt`
- output-control files
- common sensors and actuators

It does not yet cover every 42 input family with complete schema depth.

Missing or partial areas include:

- graphics configuration
- IPC configuration
- FOV configuration
- comm-link configuration
- flexible-body files
- optics files
- shaker files
- full low-level field validation for every input family

This means the current system should be described as a common 42 configuration chain, not a complete full-surface 42 configuration system.

### Finding 4: The chain still lacks runtime closure

The configuration chain closes at file generation.

It does not yet:

- compile 42
- run the generated scenario
- parse runtime failures
- check output files
- diagnose misconfiguration

This is acceptable for the current stage, but a true operational product needs a later `42-build-run-diagnose` skill.

## Optimizations Applied

The following structural improvements were applied:

1. Added hard gates to the orchestrator, brainstorm, auditor, and config-author skills.
2. Added required ordered checklists.
3. Added self-review sections.
4. Added terminal-state sections to the leaf skills.
5. Clarified that `42-config-author` must not transition into FSW implementation.

## Current Capability Assessment

The current chain can implement:

- natural-language intake
- scenario structuring
- assumption and blocker tracking
- capability-boundary checking
- traceable generation of common 42 configuration files

The current chain cannot yet fully implement:

- all possible 42 input file families
- automatic run validation
- automatic post-run diagnosis
- FSW code generation or tuning

## Recommendation

Next build step:

```text
42-build-run-diagnose
```

This should be added after `42-config-author` and should remain configuration/runtime focused, not FSW-implementation focused.

Secondary build step:

```text
42-config-validator
```

This can either be a separate skill or a script used by `42-build-run-diagnose`.
