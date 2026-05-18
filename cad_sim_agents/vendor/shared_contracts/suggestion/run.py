from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from core.io import read_json, write_json
from core.stages import StageResult
from formats.validators import validate_analysis_outputs


def run_stage(
    input_dir: Path,
    output_dir: Path,
    config: Mapping[str, Any] | None = None,
) -> StageResult:
    """Map diagnosis into an upper-loop suggestion task."""
    config = config or {}
    analysis_dir = Path(input_dir)
    output_dir = Path(output_dir)
    component_index_path = Path(config.get("component_index_path", analysis_dir.parent / "05_case_build" / "component_index.json"))
    result = StageResult(
        stage_name="suggestion",
        status="running",
        inputs={"analysis_dir": analysis_dir, "component_index": component_index_path, "config": dict(config)},
        outputs={"output_dir": output_dir},
    )
    try:
        observation = read_json(analysis_dir / "observation.json")
        diagnosis = read_json(analysis_dir / "diagnosis.json")
        root_cause_report = read_json(analysis_dir / "root_cause_report.json")
        component_index = read_json(component_index_path)
        component_ids = set(component_index.get("components", {}).keys())
        anomalies = observation.get("anomalies", [])
        targets = sorted({item.get("component_id") for item in anomalies if item.get("component_id")})
        if root_cause_report.get("eligible_for_solution_generation") and targets:
            candidates = [
                _candidate("A", "increase_contact_conductance", targets),
                _candidate("B", "move_component", targets),
                _candidate("C", "add_radiator", targets),
            ]
            suggestion_task = {
                "schema_version": "1.0",
                "suggestion_task_id": "suggest_contract",
                "action_type": candidates[0]["action_type"],
                "target_ids": targets,
                "candidates": candidates,
                "status": "candidate_actions_available",
            }
        else:
            candidates = []
            suggestion_task = {
                "schema_version": "1.0",
                "suggestion_task_id": "suggest_contract",
                "action_type": "no_action",
                "target_ids": [],
                "candidates": [],
                "status": "no_anomaly_no_action",
            }
        validation = validate_analysis_outputs(
            observation,
            diagnosis,
            suggestion_task,
            known_target_ids=component_ids,
        )
        result.checks["suggestion_task"] = validation.to_dict()
        if not validation.ok:
            result.errors = [check.to_dict() for check in validation.failed_checks]
            return result.finish("failed")

        output_dir.mkdir(parents=True, exist_ok=True)
        user_decision = {
            "schema_version": "1.0",
            "selected_option": None,
            "status": "pending_user_decision" if candidates else "not_required",
        }
        feedback = {
            "schema_version": "1.0",
            "has_actionable_feedback": bool(candidates),
            "suggestion_task": "suggestion_task.json",
        }
        result.outputs.update(
            {
                "solution_candidates": write_json(output_dir / "solution_candidates.json", candidates),
                "suggestion_task": write_json(output_dir / "suggestion_task.json", suggestion_task),
                "user_decision": write_json(output_dir / "user_decision.json", user_decision),
                "feedback_to_design_loop": write_json(output_dir / "feedback_to_design_loop.json", feedback),
            }
        )
        return result.finish("completed")
    except Exception as exc:
        result.errors.append({"type": exc.__class__.__name__, "message": str(exc)})
        return result.finish("failed")


def _candidate(option: str, action_type: str, targets: list[str]) -> dict[str, Any]:
    return {
        "option": option,
        "action_type": action_type,
        "target_ids": targets,
        "expected_benefit": "reduce thermal risk in next upper-loop layout iteration",
        "risk": "requires engineering validation before geometry or COMSOL execution",
    }
