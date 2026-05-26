#!/usr/bin/env python3
"""CLI for reading normalized COMSOL progress."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sim_cli_tools.comsol_progress import (
    default_paths,
    normalize_comsol_progress,
    sync_workspace_progress,
)


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


if __name__ == "__main__":
    raise SystemExit(main())
