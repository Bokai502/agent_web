from __future__ import annotations

import contextlib
import fcntl
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


FLOW_PATH = Path("00_inputs/workflow_diagram/executionFlowData.json")
PROGRESS_PATH = Path("logs/progress.json")
SCHEMA_VERSION = "loop_progress/1.0"
REPORT_PROGRESS_ROLE = "report"
REPORT_NODE_IDS = ("report", "analysis")
REPORT_TITLE = "报告生成"


def update_report_progress(workspace_dir: Path | str | None, percentage: float, note: str, status: str = "running") -> None:
    if workspace_dir is None:
        return
    workspace = Path(workspace_dir).expanduser().resolve()
    flow_path = workspace / FLOW_PATH
    if not flow_path.exists():
        return
    with workspace_progress_lock(workspace):
        flow = read_json(flow_path)
        node = find_report_node(flow)
        if node is None:
            return
        completed = status == "completed"
        stored_percentage = 100.0 if completed else clamp_percentage(percentage)
        node["progress"] = stored_percentage
        node["title"] = REPORT_TITLE

        progress_path = workspace / PROGRESS_PATH
        progress = read_json(progress_path) if progress_path.exists() else {"schema_version": SCHEMA_VERSION, "loops": {}}
        progress["schema_version"] = SCHEMA_VERSION
        loops = progress.setdefault("loops", {})
        node_id = str(node["id"])
        now = utc_now()
        loop = loops.get(node_id) if isinstance(loops.get(node_id), dict) else {}
        loop.setdefault("created_at", now)
        loop.setdefault("started_at", now)
        loop.update({
            "completed": completed,
            "finished_at": now if status in {"completed", "failed", "blocked"} else None,
            "node_id": node_id,
            "note": note,
            "percentage": stored_percentage,
            "progress_role": str(node.get("progressRole") or REPORT_PROGRESS_ROLE),
            "status": status,
            "title": REPORT_TITLE,
            "updated_at": now,
            "input": {
                "completed": completed,
                "loop_name": node_id,
                "node_id": node_id,
                "note": note,
                "percentage": stored_percentage,
                "progress_role": str(node.get("progressRole") or REPORT_PROGRESS_ROLE),
                "status": status,
            },
        })
        loops[node_id] = loop
        progress["updated_at"] = now

        write_json_atomic(flow_path, flow)
        write_json_atomic(progress_path, progress)


def find_report_node(flow: dict[str, Any]) -> dict[str, Any] | None:
    nodes = flow.get("nodes")
    if not isinstance(nodes, list):
        return None
    for node in nodes:
        if isinstance(node, dict) and node.get("progressRole") == REPORT_PROGRESS_ROLE:
            return node
    for node in nodes:
        if isinstance(node, dict) and node.get("id") in REPORT_NODE_IDS:
            return node
    return None


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"{path} must contain a JSON object")
    return value


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


@contextlib.contextmanager
def workspace_progress_lock(workspace: Path):
    lock_path = workspace / "logs" / ".progress.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def clamp_percentage(value: float) -> float:
    return round(max(0.0, min(100.0, float(value))), 2)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
