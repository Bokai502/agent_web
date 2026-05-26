#!/usr/bin/env python3
"""Unified command entry point for simulation CLI tools."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _tool_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _load_legacy_module():
    script_path = _tool_root() / "sim_run.py"
    spec = importlib.util.spec_from_file_location("_sim_cli_tools_legacy_sim_run", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load simulation CLI from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    module = _load_legacy_module()
    return int(module.main(sys.argv[1:]))


if __name__ == "__main__":
    sys.exit(main())
