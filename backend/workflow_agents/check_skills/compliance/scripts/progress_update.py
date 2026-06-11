#!/usr/bin/env python3
"""Update workspace loop progress for compliance checks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from progress_utils import update_loop_progress


def parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise argparse.ArgumentTypeError("must be true or false")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update <workspace>/logs/progress.json for check workflows.")
    parser.add_argument("--workspace-dir", required=True, type=Path, help="Workspace root.")
    parser.add_argument("--loop-name", required=True, help="Loop name to update.")
    parser.add_argument("--status", required=True, help="Current loop status.")
    parser.add_argument("--completed", required=True, type=parse_bool, help="Whether this loop has finished.")
    parser.add_argument("--percentage", required=True, type=float, help="Current progress percentage, clamped to 0..100.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace_dir = args.workspace_dir.expanduser().resolve()
    progress_path = update_loop_progress(
        workspace_dir,
        loop_name=args.loop_name,
        status=args.status,
        completed=args.completed,
        percentage=args.percentage,
    )
    print(json.dumps({
        "success": True,
        "progress_path": str(progress_path),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
