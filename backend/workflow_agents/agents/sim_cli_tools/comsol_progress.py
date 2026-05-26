#!/usr/bin/env python3
"""Compatibility wrapper for the packaged COMSOL progress CLI."""

from __future__ import annotations

import sys
from pathlib import Path

_SRC_DIR = Path(__file__).resolve().parent / "src"
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from sim_cli_tools.comsol_progress import (  # noqa: E402
    default_paths,
    normalize_comsol_progress,
    read_json_file,
    sync_workspace_progress,
)
from sim_cli_tools.cli.comsol_progress import main

__all__ = [
    "default_paths",
    "main",
    "normalize_comsol_progress",
    "read_json_file",
    "sync_workspace_progress",
]


if __name__ == "__main__":
    raise SystemExit(main())
