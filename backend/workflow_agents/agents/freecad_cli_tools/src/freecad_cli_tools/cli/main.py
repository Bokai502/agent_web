#!/usr/bin/env python3
"""Unified command entry point for FreeCAD CLI tools."""

from __future__ import annotations

import sys
from collections.abc import Callable

from freecad_cli_tools.cli import (
    build_component_info_assembly,
    cad_build,
    cad_validate,
    layout_safe_move,
    progress,
    runtime_config,
)

CommandHandler = Callable[[], int | None]

COMMANDS: dict[tuple[str, ...], tuple[CommandHandler, str]] = {
    ("assembly", "create-from-component-info"): (
        lambda: build_component_info_assembly.main(),
        "Create a FreeCAD assembly using geom_component_info.json STEP assets when available.",
    ),
    ("layout", "safe-move"): (
        lambda: layout_safe_move.main(),
        "Move a component in the layout dataset and optionally sync CAD.",
    ),
    ("cad", "build"): (
        lambda: cad_build.main(),
        "Build 01_cad artifacts from 00_inputs real_bom, layout_topology, and geom.",
    ),
    ("cad", "validate"): (
        lambda: cad_validate.main(),
        "Validate 01_cad artifacts and update cad_agent_output.json.",
    ),
    ("config", "show"): (
        lambda: runtime_config.main(),
        "Print resolved runtime configuration.",
    ),
    ("progress", "update"): (
        lambda: progress.main(),
        "Update loop progress state in <workspace>/logs/progress.json.",
    ),
}


def _usage() -> str:
    lines = [
        "usage: freecad-tools <group> <command> [options]",
        "",
        "commands:",
    ]
    for command, (_, description) in sorted(COMMANDS.items()):
        lines.append(f"  {' '.join(command):38} {description}")
    lines.extend(
        [
            "",
            "examples:",
            "  freecad-tools config show",
            "  freecad-tools assembly create-from-component-info --doc-name DirectAssembly",
            "  freecad-tools cad build",
            "  freecad-tools cad validate",
            "  freecad-tools layout safe-move --component P001 --move 50 50 0 --format json",
            "  freecad-tools progress update --loop-name freecad --status running --completed false --percentage 25",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] in {"-h", "--help"}:
        print(_usage())
        return 0

    if len(args) < 2:
        print(_usage(), file=sys.stderr)
        return 2

    command = (args[0], args[1])
    handler = COMMANDS.get(command)
    if handler is None:
        print(f"unknown command: {' '.join(command)}", file=sys.stderr)
        print(_usage(), file=sys.stderr)
        return 2

    sys.argv = [f"freecad-tools {' '.join(command)}", *args[2:]]
    result = handler[0]()
    return int(result) if result is not None else 0


if __name__ == "__main__":
    sys.exit(main())
