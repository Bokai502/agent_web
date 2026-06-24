"""Progress update API for CAD builder generated runners."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cad_builders.common import read_json, write_json_atomic


FLOW_PATH = Path("00_inputs/workflow_diagram/executionFlowData.json")
PROGRESS_PATH = Path("logs/progress.json")
SCHEMA_VERSION = "loop_progress/1.0"

ROLE_NOTES = {
    "cad_box": ("CAD箱体构建中", "CAD箱体构建完成"),
    "cad_real": ("真实装配构建中", "真实装配完成"),
    "cad_sim_input": ("仿真输入构建中", "仿真输入完成"),
    "cad_validate": ("CAD输出校验中", "CAD输出校验完成"),
}


@dataclass(frozen=True)
class CadProgressRequest:
    workspace_dir: str | Path
    role: str
    percentage: float
    note: str | None = None
    status: str | None = None


class CadProgressUpdater:
    """Update workflow progress for one CAD progressRole."""

    def update(self, request: CadProgressRequest) -> dict[str, Any]:
        workspace = Path(request.workspace_dir).expanduser().resolve()
        percentage = _clamp(request.percentage)
        status = _status(request.status, percentage)
        completed = status == "completed"
        finished = status in {"completed", "failed", "blocked"}
        note = request.note or _default_note(request.role, percentage, completed)

        flow_path = workspace / FLOW_PATH
        if not flow_path.exists():
            raise FileNotFoundError(f"executionFlowData.json not found: {flow_path}")

        flow = read_json(flow_path)
        node = _find_run_node(flow, request.role)
        node["progress"] = _stored_percentage(percentage, completed)

        progress_path = workspace / PROGRESS_PATH
        progress = read_json(progress_path) if progress_path.exists() else {"schema_version": SCHEMA_VERSION, "loops": {}}
        loops = progress.setdefault("loops", {})
        now = _utc_now()
        node_id = str(node["id"])
        loop = loops.get(node_id) if isinstance(loops.get(node_id), dict) else {}
        loop.setdefault("created_at", now)
        loop.setdefault("started_at", now)
        loop.update({
            "completed": completed,
            "finished_at": now if finished else None,
            "node_id": node_id,
            "percentage": _stored_percentage(percentage, completed),
            "progress_role": request.role,
            "status": status,
            "title": str(node.get("title") or node_id),
            "updated_at": now,
            "note": note,
            "input": {
                "completed": completed,
                "loop_name": node_id,
                "node_id": node_id,
                "percentage": _stored_percentage(percentage, completed),
                "progress_role": request.role,
                "status": status,
                "note": note,
            },
        })
        loops[node_id] = loop

        write_json_atomic(flow_path, flow)
        write_json_atomic(progress_path, progress)

        return {
            "ok": True,
            "workspace_dir": str(workspace),
            "role": request.role,
            "percentage": _stored_percentage(percentage, completed),
            "status": status,
            "completed": completed,
            "note": note,
        }


def _find_run_node(flow: dict[str, Any], role: str) -> dict[str, Any]:
    if role not in ROLE_NOTES:
        raise ValueError(f"unknown CAD progress role: {role}")
    matches = [
        node for node in flow.get("nodes", [])
        if isinstance(node, dict) and node.get("kind") == "run" and node.get("progressRole") == role
    ]
    if len(matches) != 1:
        raise ValueError(f"expected exactly one run node with progressRole {role}, found {len(matches)}")
    return matches[0]


def _default_note(role: str, percentage: float, completed: bool) -> str:
    if role == "cad_sim_input" and percentage == 70.0:
        return "仿真输入STEP已生成"
    running_note, completed_note = ROLE_NOTES[role]
    return completed_note if completed else running_note


def _clamp(value: float) -> float:
    return round(max(0.0, min(100.0, float(value))), 2)


def _status(status: str | None, percentage: float) -> str:
    if status is None:
        return "completed" if percentage >= 100.0 else "running"
    normalized = status.strip().lower()
    if normalized not in {"running", "completed", "failed", "blocked"}:
        raise ValueError(f"unsupported CAD progress status: {status}")
    return normalized


def _stored_percentage(percentage: float, completed: bool) -> float:
    return 100.0 if completed else percentage


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
