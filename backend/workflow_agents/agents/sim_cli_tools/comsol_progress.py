#!/usr/bin/env python3
"""Read COMSOL progress and heartbeat files without writing pipeline progress."""

from __future__ import annotations

import argparse
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read COMSOL status/progress files and print normalized JSON."
    )
    parser.add_argument("--workspace-dir", type=Path, help="Workspace root containing 02_sim.")
    parser.add_argument("--status-json", type=Path, help="Explicit COMSOL status.json path.")
    parser.add_argument("--progress-json", type=Path, help="Explicit COMSOL comsol_progress.json path.")
    parser.add_argument("--include-raw", action="store_true", help="Include raw status/progress payloads.")
    parser.add_argument(
        "--sync-progress",
        action="store_true",
        help="Write mapped COMSOL progress to <workspace>/logs/progress.json.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    status_path = args.status_json
    progress_path = args.progress_json
    if args.workspace_dir is not None:
        default_status, default_progress = default_paths(args.workspace_dir.expanduser().resolve())
        status_path = status_path or default_status
        progress_path = progress_path or default_progress
    if status_path is None and progress_path is None:
        raise SystemExit("pass --workspace-dir or at least one of --status-json/--progress-json")
    payload = normalize_comsol_progress(
        status_path=status_path,
        progress_path=progress_path,
        include_raw=bool(args.include_raw),
    )
    if args.sync_progress:
        if args.workspace_dir is None:
            raise SystemExit("--sync-progress requires --workspace-dir")
        sync_workspace_progress(args.workspace_dir.expanduser().resolve(), payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


def sync_workspace_progress(workspace: Path, payload: dict[str, Any]) -> None:
    from freecad_cli_tools.cli.progress import (
        progress_path_for_workspace,
        read_progress,
        update_loop_progress,
        write_progress,
    )

    data = read_progress(progress_path_for_workspace(workspace))
    update_loop_progress(
        data,
        loop_name="simulation",
        status="simulation_running",
        completed=False,
        percentage=float(payload.get("simulation_percentage") or 0.0),
    )
    write_progress(progress_path_for_workspace(workspace), data)


if __name__ == "__main__":
    raise SystemExit(main())
