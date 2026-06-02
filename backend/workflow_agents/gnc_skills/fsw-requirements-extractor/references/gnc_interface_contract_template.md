# GNC Interface Contract Template

Use this template for `workspace_dir/AIGNC_Workflow/05_fsw_requirements/gnc_interface_contract.md`.

Hard rules:

- Fill every mission-relevant `Mission Value`, `Code/Artifact Anchor`, and `Verification Method` cell before asking the user to confirm.
- Do not leave `TBD`, `Unknown`, blank required cells, or unresolved alternatives in the contract. If a required value is unknown, stop and ask the user before issuing the contract for confirmation.
- Use `N/A - <reason>` only for rows that are genuinely not applicable to the mission.
- Keep `User Confirmation` as `Pending` while the contract is awaiting user review.
- Set `Status: Frozen_By_User`, `Confirmed By`, and `Confirmed At` only after explicit user confirmation in the conversation.
- Do not use this file as a long design report. It is an implementation gate and semantic contract.

```markdown
# GNC Interface Contract

Mission: <MISSION_NAME>
Version: <YYYY-MM-DD or revision id>
Status: Pending_User_Confirmation
Prepared By: Agent
Confirmed By: <TBD until explicit user confirmation>
Confirmed At: <TBD until explicit user confirmation>
Source Documents:
- <path or conversation reference>
Implementation Gate: FSW architecture planning and code authoring are blocked until Status is Frozen_By_User.

## 1. Confirmation Summary

The user must explicitly confirm or correct these items before implementation may proceed.

| ID | High-Risk Semantic | Agent Interpretation | Evidence | User Confirmation |
|---|---|---|---|---|
| C1 | Coordinate convention | <filled> | <source> | Pending |
| C2 | Primary target semantics | <filled> | <source> | Pending |
| C3 | Sensor invalid vs environment unavailable | <filled> | <source> | Pending |
| C4 | Mode dwell/timer semantics | <filled> | <source> | Pending |
| C5 | Actuator allocation boundaries | <filled> | <source> | Pending |
| C6 | Guidance profile and terminal criteria | <filled> | <source> | Pending |

## 2. Coordinate And State Semantics

| Item | Mission Value | Code/Artifact Anchor | Verification Method | User Confirmation |
|---|---|---|---|---|
| Attitude quaternion ordering | <filled> | <filled> | <filled> | Pending |
| Attitude quaternion frame direction | <filled> | <filled> | <filled> | Pending |
| Quaternion multiplication convention | <filled> | <filled> | <filled> | Pending |
| Attitude error definition | <filled> | <filled> | <filled> | Pending |
| Angular velocity frame and units | <filled> | <filled> | <filled> | Pending |
| Position/velocity frame and units | <filled> | <filled> | <filled> | Pending |
| Body axis meanings | <filled> | <filled> | <filled> | Pending |
| Orbit-frame convention | <filled> | <filled> | <filled> | Pending |
| Euler plot convention and wrap handling | <filled> | <filled> | <filled> | Pending |

## 3. Guidance Target Semantics

| Target | Mission Value | Absolute/Relative/Locked/Continuous | Code/Artifact Anchor | Verification Method | User Confirmation |
|---|---|---|---|---|---|
| Safe target | <filled or N/A - reason> | <filled> | <filled> | <filled> | Pending |
| Detumble target | <filled or N/A - reason> | <filled> | <filled> | <filled> | Pending |
| Sun-pointing target | <filled or N/A - reason> | <filled> | <filled> | <filled> | Pending |
| Earth/nadir target | <filled or N/A - reason> | <filled> | <filled> | <filled> | Pending |
| Inertial target | <filled or N/A - reason> | <filled> | <filled> | <filled> | Pending |
| Slew target | <filled or N/A - reason> | <filled> | <filled> | <filled> | Pending |
| Tracking/payload target | <filled or N/A - reason> | <filled> | <filled> | <filled> | Pending |

## 4. Sensor Validity Semantics

| Sensor/Input | Valid Condition | Invalid Condition | Invalid Handling | Code/Artifact Anchor | Verification Method | User Confirmation |
|---|---|---|---|---|---|---|
| Gyro | <filled> | <filled> | <filled> | <filled> | <filled> | Pending |
| Magnetometer | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| Coarse sun sensor | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| Fine sun sensor | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| Star tracker | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| Earth/horizon sensor | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| GPS/orbit estimate | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| Payload/tracking measurement | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |

## 5. Environment Visibility Semantics

| Condition | Detection Method | Sensor Failure? | Mode Response | Timer Behavior | Verification Method | User Confirmation |
|---|---|---|---|---|---|---|
| Eclipse / sun unavailable | <filled or N/A - reason> | <Yes/No + reason> | <filled> | <pause/continue/reset + reason> | <filled> | Pending |
| Target occultation | <filled or N/A - reason> | <Yes/No + reason> | <filled> | <filled> | <filled> | Pending |
| Exclusion-angle violation | <filled or N/A - reason> | <Yes/No + reason> | <filled> | <filled> | <filled> | Pending |
| Communication blackout | <filled or N/A - reason> | <Yes/No + reason> | <filled> | <filled> | <filled> | Pending |

## 6. Mode Semantics

| Mode | Purpose | Entry Condition | Exit Condition | Abort/Fallback Condition | Timer/Dwell Semantics | User Confirmation |
|---|---|---|---|---|---|---|
| SAFE | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| DETUMBLE | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| ACQUIRE | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| POINT | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| SLEW | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| TRACK/SCIENCE | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| REACQUIRE | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |

## 7. Actuator Allocation Semantics

| Mode/Phase | Reaction Wheels | Magnetic Torquers | Thrusters | Other Actuators | User Confirmation |
|---|---|---|---|---|---|
| SAFE | <primary/inhibited/unload-only/N/A> | <primary/inhibited/unload-only/N/A> | <filled> | <filled> | Pending |
| DETUMBLE | <filled> | <filled> | <filled> | <filled> | Pending |
| ACQUIRE | <filled> | <filled> | <filled> | <filled> | Pending |
| POINT | <filled> | <filled> | <filled> | <filled> | Pending |
| SLEW | <filled> | <filled> | <filled> | <filled> | Pending |
| TRACK/SCIENCE | <filled> | <filled> | <filled> | <filled> | Pending |

## 8. Control Law Commitments

| Controller | State Error | Rate Error | Feedforward Policy | Saturation Handling | Verification Method | User Confirmation |
|---|---|---|---|---|---|---|
| Rate damping | <filled> | <filled> | <filled> | <filled> | <filled> | Pending |
| Vector pointing | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| Quaternion PD | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| Slew tracking | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| Momentum unload | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |

## 9. Guidance Profile Commitments

| Guidance/Profile | Profile Definition | Duration | Rate Limit | Accel Limit | Terminal Condition | User Confirmation |
|---|---|---:|---:|---:|---|---|
| Fixed-angle slew | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| Search/scan | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| Retargeting | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |
| Tracking | <filled or N/A - reason> | <filled> | <filled> | <filled> | <filled> | Pending |

## 10. Verification Metrics

| Requirement | Metric | Pass Condition | Source Telemetry | Plot/Report | User Confirmation |
|---|---|---|---|---|---|
| Final mode | <filled> | <filled> | <filled> | <filled> | Pending |
| Pointing accuracy | <filled> | <filled> | <filled> | <filled> | Pending |
| Rate settling | <filled> | <filled> | <filled> | <filled> | Pending |
| Slew duration | <filled or N/A - reason> | <filled> | <filled> | <filled> | Pending |
| Slew angle | <filled or N/A - reason> | <filled> | <filled> | <filled> | Pending |
| Sensor-loss/environment response | <filled> | <filled> | <filled> | <filled> | Pending |
| Actuator saturation | <filled> | <filled> | <filled> | <filled> | Pending |
| Momentum management | <filled or N/A - reason> | <filled> | <filled> | <filled> | Pending |

## 11. Open Issues And Assumptions

This section must be empty or contain only non-blocking assumptions before user confirmation. Any blocking issue prevents confirmation.

| ID | Issue/Assumption | Impact | Blocking? | Resolution / User Confirmation |
|---|---|---|---|---|
| A1 | <filled or N/A - no open issues> | <filled> | <Yes/No> | Pending |
```
