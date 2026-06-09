# AIGNC Skill Specs

This directory stores product-level skill specifications for the local AIGNC-to-42 workflow.

Current specs:

- `aignc-42-orchestrator-spec.md`
- `aignc-scenario-brainstorm-spec.md`
- `42-capability-auditor-spec.md`
- `42-config-author-spec.md`
- `42-config-validator-spec.md`
- `42-build-run-diagnose-spec.md`
- `42-runtime-plotter-spec.md`
- `fsw-requirements-extractor-spec.md`
- `fsw-architecture-planner-spec.md`
- `fsw-code-author-spec.md`
- `fsw-tuning-reviewer-spec.md`
- `42-config-workflow-current.md`
- `42-config-chain-review.md`
- `aignc-42-orchestrator-workflow-diagram.md`

Current top-level workflow view:

```text
User scenario or task document
 -> aignc-42-orchestrator
 -> aignc-scenario-brainstorm
 -> 42-capability-auditor
 -> 42-config-author
 -> 42-config-validator
 -> statically validated 42 configuration artifacts
```

Optional runtime proof branch:

```text
validated 42 configuration artifacts
 -> 42-build-run-diagnose
 -> 42-runtime-plotter
 -> runtime-verified 42 workspace package
```

Optional FSW branch:

```text
validated 42 configuration artifacts
 -> fsw-requirements-extractor
 -> fsw-architecture-planner
 -> fsw-code-author
 -> 42-build-run-diagnose
 -> 42-runtime-plotter
 -> fsw-tuning-reviewer
 -> fsw-code-author (iterate when the review recommends implementation-side correction)
```

The orchestrator is the top-level coordinator. The other skills are leaf or near-leaf workflow stages.

For configuration-only work, use:

```text
User scenario or task document
 -> aignc-42-orchestrator
 -> aignc-scenario-brainstorm
 -> 42-capability-auditor
 -> 42-config-author
 -> 42-config-validator
 -> statically validated 42 configuration artifacts
```

`fsw-requirements-extractor` is intentionally outside the configuration-only closure.
