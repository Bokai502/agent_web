"""Read COMSOL progress and heartbeat files without writing pipeline progress."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def read_json_file(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def normalize_comsol_progress(
    *,
    status_path: Path | None = None,
    progress_path: Path | None = None,
    include_raw: bool = False,
) -> dict[str, Any]:
    progress = read_json_file(progress_path) if progress_path is not None else {}
    raw_percent = progress.get("percent")
    try:
        percent = max(0.0, min(100.0, float(raw_percent or 0.0)))
    except (TypeError, ValueError):
        percent = 0.0
    mapped_percentage = round(percent * 0.7, 2)
    payload = {
        "available": bool(progress),
        "stage": progress.get("stage"),
        "percent": percent,
        "simulation_percentage": mapped_percentage,
        "ok": progress.get("ok"),
        "sample_id": progress.get("sample_id"),
        "updated_at": progress.get("updated_at"),
        "heartbeat_at": progress.get("heartbeat_at"),
        "status_path": str(status_path) if status_path is not None else None,
        "progress_path": str(progress_path) if progress_path is not None else None,
    }
    if include_raw:
        payload["progress"] = progress
    return payload


def default_paths(workspace: Path) -> tuple[Path, Path]:
    sim_dir = workspace / "02_sim" / "simulation" / "_comsol_work" / "sim"
    return sim_dir / "status.json", sim_dir / "comsol_progress.json"


def sync_workspace_progress(workspace: Path, payload: dict[str, Any]) -> None:
    from sim_cli_tools.progress import write_loop_progress

    write_loop_progress(
        workspace,
        loop_name="simulation",
        status="simulation_running",
        completed=False,
        percentage=float(payload.get("simulation_percentage") or 0.0),
    )
