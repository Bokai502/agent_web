from __future__ import annotations

from typing import Any, Mapping

from .common import ValidationResult

WORKERS = {"geometry", "thermal_feedback"}


def validate_agent_job(data: Mapping[str, Any]) -> ValidationResult:
    result = ValidationResult(stage="agent_job")
    _require_str(result, data, "schema_version", "agent_job")
    _require_str(result, data, "job_id", "agent_job")
    _require_str(result, data, "run_id", "agent_job")
    _require_str(result, data, "generation_id", "agent_job")
    _require_worker(result, data.get("worker"), "agent_job")
    _require_str(result, data, "stage", "agent_job")
    _require_str(result, data, "generation_root", "agent_job")
    _require_str(result, data, "workspace", "agent_job")
    _require_string_list(result, data.get("readonly_inputs"), "readonly_inputs", "agent_job")
    _require_string_list(result, data.get("writable_outputs"), "writable_outputs", "agent_job")
    _require_str(result, data, "context_packet", "agent_job")
    _require_str(result, data, "prompt", "agent_job")
    _require_str(result, data, "success_marker", "agent_job")
    if data.get("status") not in {"queued", "running", "completed", "failed", "skipped"}:
        result.fail("status_allowed", "agent job status is not allowed", "agent_job")
    _require_str(result, data, "task_summary", "agent_job")
    return result


def validate_agent_context_packet(data: Mapping[str, Any]) -> ValidationResult:
    result = ValidationResult(stage="agent_context_packet")
    _require_str(result, data, "schema_version", "context_packet")
    _require_str(result, data, "run_id", "context_packet")
    _require_str(result, data, "generation_id", "context_packet")
    _require_worker(result, data.get("worker"), "context_packet")
    _require_str(result, data, "task_summary", "context_packet")
    _require_string_list(result, data.get("readonly_inputs"), "readonly_inputs", "context_packet")
    for key in ("text_artifacts", "image_artifacts", "geometry_artifacts", "constraints"):
        if not isinstance(data.get(key), list):
            result.fail(f"{key}_list", f"{key} must be a list", "context_packet")
    if not isinstance(data.get("expected_output"), Mapping):
        result.fail("expected_output_present", "expected_output must be an object", "context_packet")
    return result


def validate_agent_worker_result(data: Mapping[str, Any]) -> ValidationResult:
    result = ValidationResult(stage="agent_worker_result")
    _require_str(result, data, "schema_version", "worker_result")
    if data.get("job_id") is not None and not isinstance(data.get("job_id"), str):
        result.fail("job_id_string", "job_id must be a string or null", "worker_result")
    _require_worker(result, data.get("worker"), "worker_result")
    if data.get("status") not in {"completed", "failed", "requires_human_review", "skipped"}:
        result.fail("status_allowed", "worker result status is not allowed", "worker_result")
    if not isinstance(data.get("requires_human_review"), bool):
        result.fail("requires_human_review_bool", "requires_human_review must be a boolean", "worker_result")
    _require_str(result, data, "summary", "worker_result")
    for key in ("decision", "outputs"):
        if not isinstance(data.get(key), Mapping):
            result.fail(f"{key}_object", f"{key} must be an object", "worker_result")
    for key in ("evidence", "warnings", "errors"):
        if not isinstance(data.get(key), list):
            result.fail(f"{key}_list", f"{key} must be a list", "worker_result")
    return result


def _require_worker(result: ValidationResult, value: Any, object_id: str) -> None:
    if value not in WORKERS:
        result.fail("worker_allowed", f"worker must be one of {sorted(WORKERS)}", object_id)


def _require_str(result: ValidationResult, data: Mapping[str, Any], key: str, object_id: str) -> None:
    if not isinstance(data.get(key), str) or not data.get(key):
        result.fail(f"{key}_present", f"{key} is required", object_id)


def _require_string_list(result: ValidationResult, value: Any, key: str, object_id: str) -> None:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        result.fail(f"{key}_string_list", f"{key} must be a list of strings", object_id)
