# Skill Spec: fsw-tuning-reviewer

## Goal

Review implemented and runnable fixed `CFS_FSW` behavior after runtime execution, identify likely bug or tuning causes when mission-level performance is wrong, and produce bounded debugging directions.

This skill sits after runtime execution evidence exists.

## Core Inputs

Required:

- `run_report.md`
- `run_summary.json`

Recommended:

- `fsw_code_author_report.md`
- `fsw_change_set.json`
- `fsw_architecture_plan.md`
- `file_change_map.json`
- `fsw_requirement_spec.md`
- `mode_table.json`

## Core Outputs

- `fsw_tuning_review.md`
- `fsw_tuning_hypotheses.json`

Recommended JSON shape:

```json
{
  "primary_failure_modes": [],
  "hypotheses": [],
  "recommended_return_stage": "fsw-code-author",
  "suggested_parameter_targets": [],
  "suggested_code_focus": []
}
```

## Issue Classes

Each reviewed issue should be classified as one of:

- `logic_bug`
- `interface_mismatch`
- `estimation_or_measurement_issue`
- `gain_or_timing_tuning`
- `config_or_case_issue`
- `architecture_gap`

## Required Behavior

The skill must:

1. identify the concrete failing observable
2. compare it against the expected requirement or architecture intent
3. explicitly confirm the intended sensor, actuator, and switching strategy when runtime behavior may reflect a stale or mismatched case
4. inspect implementation consistency, including coordinate frames, guidance frames, attitude-error definitions, and FSW-versus-42 definition mismatches
5. inspect sensor and actuator validity, including occlusion, exclusion, FOV, timing, sample-and-hold behavior, rate limits, and saturation
6. inspect state-machine timing, including mode gates, hold times, timeouts, and whether the simulation horizon is long enough
7. separate tuning problems from logic or interface bugs
8. rank bounded hypotheses
9. recommend the correct return stage

## Typical Uses

- mode timing is wrong even though the case runs
- residual converges too slowly or diverges
- actuator saturates or appears to move with wrong sign
- runtime passes but performance metrics fail
- optical-link scan, coarse-hold, or fine-track behavior is inconsistent with intent
- the same implementation behaves differently because sensor validity or occlusion changes the effective closed loop
- the run may be too short for the expected transition or settling event

## Stop Conditions

Stop if runtime evidence is insufficient to observe the reported failure, or if no runnable implementation exists yet.

## Success Criteria

The skill is successful when:

1. the failing behavior is stated concretely
2. hypotheses are tied to observables rather than vague intuition
3. the review covers user-intent confirmation, implementation consistency, measurement validity, and state-machine timing before defaulting to gain tuning
4. the return stage is explicit
5. the recommendations are bounded enough for the next skill to act on
