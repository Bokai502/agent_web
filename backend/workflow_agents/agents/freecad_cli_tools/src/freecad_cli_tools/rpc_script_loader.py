"""Load embedded FreeCAD RPC script templates from package resources."""

from __future__ import annotations

from importlib.resources import files
from typing import Mapping

SCRIPT_PACKAGE = "freecad_cli_tools.rpc_scripts"


def load_rpc_script(script_name: str) -> str:
    """Read a packaged FreeCAD-side Python script template."""
    return files(SCRIPT_PACKAGE).joinpath(script_name).read_text(encoding="utf-8")


def render_rpc_script(script_name: str, replacements: Mapping[str, str]) -> str:
    """Render a script template by replacing placeholder tokens."""
    content = load_rpc_script(script_name)
    for key, value in replacements.items():
        content = content.replace(key, value)
    return content
