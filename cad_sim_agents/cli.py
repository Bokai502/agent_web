from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

from codex_agents.external_tool_launchers import load_simulation_outputs_in_remote_tools
from codex_agents.logging_utils import configure_logging, get_logger
from codex_agents.runner import run_bom_external_tools_pipeline
from codex_agents.step_registry import step_command_names


LEGACY_COMMANDS = ("run-all", *step_command_names(), "load-simulation-tools")
LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
DEFAULT_PYTHON_BIN = "/data/conda/bin/python"
DEFAULT_EXTRA_PYTHONPATH = "/tmp/codex_openpyxl_py313"
DEFAULT_BOM_JSON = "/data/lbk/codex_web/FreeCAD_data/v7_data/00_inputs/real_bom.json"
DEFAULT_WORKSPACE_DIR = "/data/lbk/codex_web/FreeCAD_data/v7_data"
CONFIG_PATH = Path(__file__).resolve().parents[1] / "config.json"
FREECAD_CLI_TOOLS = (
    "freecad-runtime-config",
    "freecad-layout-safe-move",
    "freecad-create-assembly",
    "freecad-create-assembly-from-component-info",
)


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _config_workspace_dir() -> str | None:
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as handle:
            config = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    top_level = config.get("WORKSPACE_DIR")
    if isinstance(top_level, str) and top_level.strip():
        return top_level
    freecad = config.get("freecad")
    if not isinstance(freecad, dict):
        return None
    value = freecad.get("workspaceDir") or freecad.get("workspace_dir")
    return value if isinstance(value, str) and value.strip() else None


def _default_workspace_dir() -> Path:
    if value := os.environ.get("WORKSPACE_DIR"):
        return Path(value)
    if value := _config_workspace_dir():
        return Path(value)
    return Path(DEFAULT_WORKSPACE_DIR)


def _workspace_dir_source(explicit: Path | None = None) -> str:
    if explicit is not None:
        return "cli"
    if "WORKSPACE_DIR" in os.environ:
        return "WORKSPACE_DIR"
    if _config_workspace_dir():
        return "config.workspaceDir"
    return "default"


def _resolve_workspace_dir(explicit: Path | None) -> Path:
    return Path(explicit) if explicit is not None else _default_workspace_dir()


def _json_print(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False))


def _add_pipeline_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--bom-json",
        type=Path,
        default=Path(_env("BOM_JSON", DEFAULT_BOM_JSON)),
        help="Input real_bom.json path. Defaults to BOM_JSON or the v7 data BOM.",
    )
    parser.add_argument(
        "--workspace-dir",
        type=Path,
        dest="workspace_dir",
        default=None,
        help=(
            "Workspace directory for pipeline outputs. Defaults to WORKSPACE_DIR, then config workspace settings."
        ),
    )
    parser.add_argument(
        "--simulation-backend",
        default=_env("SIMULATION_BACKEND", "comsol_local"),
        choices=("mock_contract", "comsol_local", "external_contract"),
        help="Simulation backend. mock_contract is the fastest smoke-test backend.",
    )
    parser.add_argument("--skip-postprocess", action="store_true", help="Stop after simulation.")
    parser.add_argument("--sample-id", default=_env("SAMPLE_ID", "930001"))
    parser.add_argument("--seed", type=int, default=int(_env("SEED", "930001")))
    parser.add_argument("--clearance-mm", type=float, default=float(_env("CLEARANCE_MM", "3.0")))
    parser.add_argument("--multistart", type=int, default=int(_env("MULTISTART", "1")))
    parser.add_argument("--target-fill-ratio", type=float, default=float(_env("TARGET_FILL_RATIO", "0.42")))
    parser.add_argument("--geometry-edit-dir-name", default="02_geometry_edit")
    parser.add_argument(
        "--rebuild-cad-after-edit",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Rebuild geometry_after.step/glb from geometry_after.layout_topology.json and geometry_after.geom.json.",
    )
    parser.add_argument("--max-actions-per-case", type=int, default=3)
    parser.add_argument("--connect-existing-mphserver", action="store_true")
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=LOG_LEVELS,
        help="Console log level. File logs always include DEBUG and above.",
    )
    parser.add_argument(
        "--log-file",
        type=Path,
        default=None,
        help="Runtime log file path. Defaults to <run-root>/logs/pipeline.log.",
    )
    parser.add_argument("--quiet", action="store_true", help="Disable console logs; keep file logging enabled.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cad-sim-pipeline",
        description="Run and inspect the Codex BOM external tools pipeline.",
    )
    parser.add_argument("--json", action="store_true", help="Emit stable JSON for commands that have human output.")
    subparsers = parser.add_subparsers(dest="subcommand")

    doctor = subparsers.add_parser("doctor", help="Check CLI defaults, paths, and optional auth state.")
    doctor.set_defaults(handler=_handle_doctor)

    run = subparsers.add_parser("run", help="Run the full pipeline.")
    _add_pipeline_options(run)
    run.set_defaults(handler=_handle_run, command="run-all")

    step = subparsers.add_parser("step", help="Run one named pipeline step.")
    step.add_argument("step_name", choices=step_command_names(), help="Step command name.")
    _add_pipeline_options(step)
    step.set_defaults(handler=_handle_step)

    steps = subparsers.add_parser("steps", help="Discover available pipeline steps.")
    steps_subparsers = steps.add_subparsers(dest="steps_command")
    steps_list = steps_subparsers.add_parser("list", help="List available pipeline step names.")
    steps_list.set_defaults(handler=_handle_steps_list)

    load_tools = subparsers.add_parser(
        "load-simulation-tools",
        help="Open simulation outputs in remote COMSOL/ParaView helper tools.",
    )
    load_tools.add_argument(
        "--workspace-dir",
        type=Path,
        dest="workspace_dir",
        default=None,
        help="Workspace directory containing 03_simulation.",
    )
    load_tools.set_defaults(handler=_handle_load_simulation_tools)

    raw = subparsers.add_parser("raw", help="Compatibility escape hatch for legacy pipeline commands.")
    raw.add_argument("legacy_command", choices=LEGACY_COMMANDS, help="Legacy command to run.")
    _add_pipeline_options(raw)
    raw.set_defaults(handler=_handle_raw)
    return parser


def _legacy_argv(argv: list[str]) -> list[str]:
    global_args: list[str] = []
    while argv and argv[0] == "--json":
        global_args.append(argv.pop(0))
    if argv and argv[0] in ("-h", "--help"):
        return [*global_args, *argv]
    if not argv:
        return [*global_args, "run"]
    if argv[0] == "run-all":
        return [*global_args, "run", *argv[1:]]
    if argv[0] in step_command_names():
        return [*global_args, "step", argv[0], *argv[1:]]
    if argv[0] == "load-simulation-tools":
        return [*global_args, "load-simulation-tools", *argv[1:]]
    if argv[0].startswith("--"):
        return [*global_args, "run", *argv]
    return [*global_args, *argv]


def _connect_existing_allowed() -> bool:
    return os.environ.get("CONNECT_EXISTING_MPHSERVER") == "1"


def _normalize_connect_existing(args: argparse.Namespace) -> None:
    if getattr(args, "connect_existing_mphserver", False) and not _connect_existing_allowed():
        print(
            "warning: ignoring --connect-existing-mphserver because CONNECT_EXISTING_MPHSERVER=1 is not set; "
            "comsol_local will auto-start/manage mphserver.",
            file=sys.stderr,
        )
        args.connect_existing_mphserver = False


def _freecad_cli_status() -> dict[str, Any]:
    commands = {name: shutil.which(name) for name in FREECAD_CLI_TOOLS}
    return {
        "required_for_geometry_edit": True,
        "ok": all(commands.values()),
        "commands": commands,
        "workspace_env": os.environ.get("WORKSPACE_DIR"),
        "handoff": {
            "skill": "freecad",
            "when": [
                "geometry_after.step or geometry_after.glb is missing",
                "freecad_skill_cli_result.json reports a failed command",
                "FreeCAD RPC/config/progress diagnostics are needed",
            ],
        },
    }


def _handle_doctor(args: argparse.Namespace) -> int:
    parent_dir = Path(__file__).resolve().parents[1]
    payload = {
        "ok": True,
        "tool": "cad-sim-pipeline",
        "python": sys.executable,
        "module": "codex_agents.cli",
        "paths": {
            "repo_root": str(parent_dir),
            "default_bom_json": _env("BOM_JSON", DEFAULT_BOM_JSON),
            "default_workspace_dir": str(_default_workspace_dir()),
            "extra_pythonpath": _env("EXTRA_PYTHONPATH", DEFAULT_EXTRA_PYTHONPATH),
        },
        "environment": {
            "bom_json_source": "env" if "BOM_JSON" in os.environ else "default",
            "workspace_dir_source": _workspace_dir_source(),
            "simulation_backend": _env("SIMULATION_BACKEND", "comsol_local"),
            "connect_existing_mphserver_enabled": _connect_existing_allowed(),
        },
        "commands": {
            "run": "cad-sim-pipeline run",
            "step": "cad-sim-pipeline step <step-name>",
            "steps": "cad-sim-pipeline steps list",
            "load_simulation_tools": "cad-sim-pipeline load-simulation-tools",
            "raw": "cad-sim-pipeline raw <legacy-command>",
        },
        "steps": list(step_command_names()),
        "freecad_cli": _freecad_cli_status(),
        "auth": {
            "required": False,
            "note": "Local pipeline commands do not require auth.",
        },
    }
    if args.json:
        _json_print(payload)
    else:
        print("cad-sim-pipeline: ok")
        print(f"repo_root: {payload['paths']['repo_root']}")
        print(f"default_workspace_dir: {payload['paths']['default_workspace_dir']}")
        print("steps: " + ", ".join(payload["steps"]))
    return 0


def _run_pipeline_command(args: argparse.Namespace) -> int:
    args.run_root = _resolve_workspace_dir(args.workspace_dir)
    _normalize_connect_existing(args)
    log_path = configure_logging(
        run_root=args.run_root,
        level=args.log_level,
        log_file=args.log_file,
        quiet=args.quiet,
    )
    logger = get_logger("cli")

    try:
        logger.info("starting command=%s run_root=%s log_file=%s", args.command, args.run_root, log_path)
        manifest = run_bom_external_tools_pipeline(args)
    except RuntimeError as exc:
        logger.error("command failed: %s", exc)
        print(f"cad-sim-pipeline: error: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
    logger.info("finished command=%s ok=%s", args.command, manifest.get("ok"))
    _json_print(manifest)
    return 0 if manifest.get("ok") else 1


def _handle_run(args: argparse.Namespace) -> int:
    args.command = "run-all"
    return _run_pipeline_command(args)


def _handle_step(args: argparse.Namespace) -> int:
    args.command = args.step_name
    return _run_pipeline_command(args)


def _handle_raw(args: argparse.Namespace) -> int:
    args.command = args.legacy_command
    if args.command == "load-simulation-tools":
        return _handle_load_simulation_tools(args)
    return _run_pipeline_command(args)


def _handle_steps_list(args: argparse.Namespace) -> int:
    payload = {
        "ok": True,
        "steps": [{"name": name, "run_command": f"cad-sim-pipeline step {name}"} for name in step_command_names()],
    }
    if args.json:
        _json_print(payload)
    else:
        for step in payload["steps"]:
            print(step["name"])
    return 0


def _handle_load_simulation_tools(args: argparse.Namespace) -> int:
    args.run_root = _resolve_workspace_dir(args.workspace_dir)
    manifest = load_simulation_outputs_in_remote_tools(args.run_root / "03_simulation")
    _json_print(manifest)
    return 0 if manifest.get("ok") else 1


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    argv = _legacy_argv(list(argv))
    parser = build_parser()
    args = parser.parse_args(argv)
    handler = getattr(args, "handler", None)
    if handler is None:
        parser.print_help()
        return 0
    return handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
