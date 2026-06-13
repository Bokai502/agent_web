from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "loop_progress/1.0"

DEFAULT_LOOP_ORDER = [
    "check_compliance_prepare",
    "check_compliance_interpret",
    "check_compliance_checks",
    "check_compliance_report",
]

DEFAULT_LOOP_WEIGHTS = {
    "check_compliance_prepare": 10.0,
    "check_compliance_interpret": 26.0,
    "check_compliance_checks": 44.0,
    "check_compliance_report": 20.0,
}


def timestamp() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def clamp_percentage(value: float) -> float:
    return round(max(0.0, min(100.0, float(value))), 2)


def normalize_status(status: str, completed: bool) -> str:
    normalized = (status or "").strip().lower()
    if "fail" in normalized or "error" in normalized:
        return "failed"
    if "block" in normalized:
        return "blocked"
    if completed or "complete" in normalized or "success" in normalized:
        return "completed"
    if "run" in normalized or "progress" in normalized or normalized.endswith("_running"):
        return "running"
    if "pending" in normalized or "wait" in normalized:
        return "pending"
    return "running" if normalized else "pending"


def progress_path_for_workspace(workspace_dir: Path) -> Path:
    return workspace_dir / "logs" / "progress.json"


def read_progress(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schema_version": SCHEMA_VERSION, "loops": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("schema_version", SCHEMA_VERSION)
    loops = data.get("loops")
    if not isinstance(loops, dict):
        data["loops"] = {}
    data.pop("heartbeat", None)
    for loop in data["loops"].values():
        if isinstance(loop, dict):
            loop.pop("heartbeat_at", None)
    rebuild_progress_summary(data)
    return data


def write_progress(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    tmp_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    tmp_path.replace(path)


def loop_order(loop_name: str) -> int:
    try:
        return DEFAULT_LOOP_ORDER.index(loop_name)
    except ValueError:
        return len(DEFAULT_LOOP_ORDER)


def is_managed_loop(loop_name: str) -> bool:
    return loop_name in DEFAULT_LOOP_ORDER


def loop_weight(loop_name: str, loop: dict[str, Any]) -> float:
    value = loop.get("weight")
    if isinstance(value, (int, float)) and value > 0:
        return float(value)
    return DEFAULT_LOOP_WEIGHTS.get(loop_name, 1.0)


def rebuild_progress_summary(data: dict[str, Any]) -> None:
    loops = data.get("loops")
    if not isinstance(loops, dict):
        data["summary"] = {
            "total": 0,
            "completed": 0,
            "failed": 0,
            "running": 0,
            "pending": 0,
            "blocked": 0,
            "percentage": 0.0,
            "status": "pending",
            "active_loop": None,
        }
        return

    weighted_done = 0.0
    total_weight = 0.0
    counts = {"completed": 0, "failed": 0, "running": 0, "pending": 0, "blocked": 0}
    active_loop: dict[str, Any] | None = None
    latest_update: str | None = None

    managed_loops = [
        (name, value) for name, value in loops.items() if is_managed_loop(name)
    ]

    for name, value in sorted(managed_loops, key=lambda item: loop_order(item[0])):
        if not isinstance(value, dict):
            continue
        completed = value.get("completed") is True
        percent = clamp_percentage(
            100.0 if completed else float(value.get("percentage") or 0.0)
        )
        status = normalize_status(str(value.get("status") or ""), completed)
        weight = loop_weight(name, value)
        order = loop_order(name)
        value["percentage"] = percent
        value["status_type"] = status
        value["weight"] = weight
        value["order"] = order
        if value.get("started_at") is None:
            value["started_at"] = value.get("created_at")
        value.pop("duration_seconds", None)

        counts[status] = counts.get(status, 0) + 1
        total_weight += weight
        weighted_done += weight * percent / 100.0
        updated_at = value.get("updated_at")
        if isinstance(updated_at, str) and (
            latest_update is None or updated_at > latest_update
        ):
            latest_update = updated_at
        if status in {"running", "failed", "blocked"} and (
            active_loop is None or order >= int(active_loop.get("order") or -1)
        ):
            active_loop = {
                "key": name,
                "status": status,
                "status_label": value.get("status"),
                "percentage": percent,
                "order": order,
            }

    if active_loop is None:
        pending = [
            (name, loop)
            for name, loop in managed_loops
            if isinstance(loop, dict) and loop.get("status_type") == "pending"
        ]
        if pending:
            name, loop = sorted(pending, key=lambda item: loop_order(item[0]))[0]
            active_loop = {
                "key": name,
                "status": "pending",
                "status_label": loop.get("status"),
                "percentage": loop.get("percentage") or 0.0,
                "order": loop_order(name),
            }

    if counts["failed"]:
        overall_status = "failed"
    elif counts["blocked"]:
        overall_status = "blocked"
    elif counts["running"]:
        overall_status = "running"
    elif total_weight > 0 and counts["completed"] == sum(counts.values()):
        overall_status = "completed"
    else:
        overall_status = "pending"

    data["summary"] = {
        "total": sum(counts.values()),
        **counts,
        "percentage": clamp_percentage(
            (weighted_done / total_weight * 100.0) if total_weight else 0.0
        ),
        "status": overall_status,
        "active_loop": active_loop,
        "updated_at": latest_update or data.get("updated_at"),
    }


def update_loop_progress(
    workspace_dir: Path | None,
    *,
    loop_name: str,
    status: str,
    completed: bool,
    percentage: float,
) -> Path | None:
    if workspace_dir is None:
        return None
    progress_path = progress_path_for_workspace(workspace_dir)
    data = read_progress(progress_path)
    now = timestamp()
    loops = data.setdefault("loops", {})
    if not isinstance(loops, dict):
        loops = {}
        data["loops"] = loops

    loop = loops.get(loop_name)
    if not isinstance(loop, dict):
        loop = {}
        loops[loop_name] = loop

    loop.setdefault("created_at", now)
    if not completed and normalize_status(status, completed) == "running":
        loop["started_at"] = now
    else:
        loop.setdefault("started_at", loop.get("created_at", now))
    loop["updated_at"] = now
    loop["status"] = status
    loop["completed"] = completed
    loop["percentage"] = 100.0 if completed else clamp_percentage(percentage)
    loop["input"] = {
        "loop_name": loop_name,
        "status": status,
        "completed": completed,
        "percentage": percentage,
    }
    loop["finished_at"] = now if completed else None
    data["updated_at"] = now
    data.pop("heartbeat", None)
    rebuild_progress_summary(data)
    try:
        write_progress(progress_path, data)
    except OSError:
        return None
    return progress_path
