from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "loop_progress/1.0"


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def clamp_percentage(value: float) -> float:
    return round(max(0.0, min(100.0, float(value))), 2)


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
    return data


def write_progress(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    tmp_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    tmp_path.replace(path)


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
    loop["finished_at"] = loop.get("finished_at") or now if completed else None
    data["updated_at"] = now
    data.pop("heartbeat", None)
    write_progress(progress_path, data)
    return progress_path
