"""Explicit workspace helpers for FreeCAD CLI commands."""

from __future__ import annotations

import argparse
from pathlib import Path

from freecad_cli_tools.runtime_config import get_default_workspace_dir, set_workspace_override


def add_workspace_arg(parser: argparse.ArgumentParser) -> None:
    """Add a shared explicit workspace argument."""
    parser.add_argument(
        "--workspace",
        "--workspace-dir",
        dest="workspace",
        help=(
            "Workspace root for this command. Overrides FREECAD_WORKSPACE_DIR and "
            "config.json workspace.templateDir."
        ),
    )


def apply_workspace_override(workspace: str | Path | None) -> Path:
    """Apply an explicit workspace override and return the resolved workspace."""
    if workspace is not None:
        return set_workspace_override(workspace)
    set_workspace_override(None)
    return get_default_workspace_dir().expanduser().resolve()


def validate_workspace_root(workspace: str | Path | None) -> Path:
    """Resolve the workspace and ensure the root directory exists."""
    workspace_root = apply_workspace_override(workspace)
    if not workspace_root.exists():
        raise FileNotFoundError(f"workspace not found: {workspace_root}")
    if not workspace_root.is_dir():
        raise NotADirectoryError(f"workspace is not a directory: {workspace_root}")
    return workspace_root
