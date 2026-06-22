from __future__ import annotations

import argparse
import contextlib
import importlib
import io
import json
import sys
from pathlib import Path
from typing import Any, Iterator

from . import __version__
from .spec_common import default_cad_dir, default_spec_path, freecad_rpc_settings, load_spec


TOOL_NAME = "cad_cli"


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handler = getattr(args, "handler", None)
    if handler is None:
        parser.print_help()
        return 0
    try:
        return int(handler(args))
    except Exception as exc:
        payload = {"ok": False, "error": str(exc), "tool": TOOL_NAME}
        if getattr(args, "json", False):
            print_json(payload)
        else:
            print(f"{TOOL_NAME}: error: {exc}", file=sys.stderr)
        return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=TOOL_NAME,
        description="Build CAD artifacts from 00_inputs/cad_build_spec.json.",
    )
    parser.add_argument("--json", action="store_true", help="Emit stable JSON output.")
    parser.add_argument("--version", action="version", version=f"{TOOL_NAME} {__version__}")
    sub = parser.add_subparsers(dest="command")

    doctor = sub.add_parser("doctor", help="Check local setup and selected workspace inputs.")
    add_common(doctor, require_workspace=False)
    doctor.set_defaults(handler=handle_doctor)

    paths = sub.add_parser("paths", help="Resolve standard CAD input/output paths.")
    add_common(paths, require_workspace=False)
    paths.set_defaults(handler=handle_paths)

    build = sub.add_parser("build", help="Build CAD artifacts.")
    build_sub = build.add_subparsers(dest="build_command")
    for name, help_text, handler in (
        ("box", "Build 01_cad/geometry_after.glb and FreeCAD screenshots.", handle_build_box),
        ("real-assembly", "Build 01_cad/geometry_after_real_cad.glb.", handle_build_real),
        ("sim-input", "Build geometry_after_power_filtered.step and simulation_input.json.", handle_build_sim_input),
        ("after-state", "Prepare geometry_after*.json and COMSOL grid inputs.", handle_build_after_state),
        ("all", "Run box, real-assembly, sim-input, and after-state in order.", handle_build_all),
    ):
        item = build_sub.add_parser(name, help=help_text)
        add_build_args(item)
        item.set_defaults(handler=handler)

    raw = sub.add_parser("raw", help="Escape hatch for wrapped implementation scripts.")
    raw_sub = raw.add_subparsers(dest="raw_command")
    script = raw_sub.add_parser("script", help="Run one wrapped script by name.")
    script.add_argument("name", choices=("build_box", "build_real_assembly", "build_sim_input", "prepare_after_state"))
    script.add_argument("args", nargs=argparse.REMAINDER)
    script.set_defaults(handler=handle_raw_script)

    return parser


def add_common(parser: argparse.ArgumentParser, *, require_workspace: bool) -> None:
    parser.add_argument("--workspace-dir", required=require_workspace, help="Selected version workspace directory.")
    parser.add_argument("--spec", help="cad_build_spec.json path. Defaults to <workspace-dir>/00_inputs/cad_build_spec.json.")
    parser.add_argument("--cad-dir", help="CAD output directory. Defaults to <workspace-dir>/01_cad.")


def add_build_args(parser: argparse.ArgumentParser) -> None:
    add_common(parser, require_workspace=True)
    parser.add_argument("--output-dir", help="Build output directory. Defaults to <workspace-dir>/01_cad.")
    parser.add_argument("--doc-name", help="FreeCAD document name override.")
    parser.add_argument("--host", help="FreeCAD RPC host override.")
    parser.add_argument("--port", type=int, help="FreeCAD RPC port override.")
    parser.add_argument("--grid-shape", default="32,32,32", help="after-state grid shape nx,ny,nz.")


def handle_paths(args: argparse.Namespace) -> int:
    workspace = Path(args.workspace_dir).expanduser().resolve() if args.workspace_dir else None
    spec = Path(args.spec).expanduser().resolve() if args.spec else (default_spec_path(workspace) if workspace else None)
    cad_dir = Path(args.cad_dir or args.output_dir).expanduser().resolve() if getattr(args, "cad_dir", None) or getattr(args, "output_dir", None) else (default_cad_dir(workspace) if workspace else None)
    payload = {
        "ok": True,
        "tool": TOOL_NAME,
        "workspace_dir": str(workspace) if workspace else None,
        "paths": {
            "cad_build_spec": str(spec) if spec else None,
            "cad_dir": str(cad_dir) if cad_dir else None,
            "box_glb": str(cad_dir / "geometry_after.glb") if cad_dir else None,
            "real_assembly_glb": str(cad_dir / "geometry_after_real_cad.glb") if cad_dir else None,
            "simulation_step": str(cad_dir / "geometry_after_power_filtered.step") if cad_dir else None,
            "simulation_input": str(cad_dir / "simulation_input.json") if cad_dir else None,
        },
    }
    emit(payload, args.json)
    return 0


def handle_doctor(args: argparse.Namespace) -> int:
    workspace = Path(args.workspace_dir).expanduser().resolve() if args.workspace_dir else None
    spec_path = Path(args.spec).expanduser().resolve() if args.spec else (default_spec_path(workspace) if workspace else None)
    cad_dir = Path(args.cad_dir).expanduser().resolve() if args.cad_dir else (default_cad_dir(workspace) if workspace else None)
    spec_ok = False
    spec_error = None
    component_count = None
    if spec_path and spec_path.exists():
        try:
            spec = load_spec(spec_path)
            spec_ok = True
            component_count = len(spec.get("components") or [])
        except Exception as exc:
            spec_error = str(exc)
    host, port = freecad_rpc_settings(None, None)
    payload = {
        "ok": bool(spec_ok),
        "tool": TOOL_NAME,
        "version": __version__,
        "auth_required": False,
        "workspace_dir": str(workspace) if workspace else None,
        "freecad_rpc": {"host": host, "port": port, "connection_not_checked": True},
        "checks": {
            "workspace_dir_exists": workspace.exists() if workspace else None,
            "cad_build_spec_exists": spec_path.exists() if spec_path else False,
            "cad_build_spec_valid": spec_ok,
            "cad_build_spec_error": spec_error,
            "cad_dir_exists": cad_dir.exists() if cad_dir else None,
            "component_count": component_count,
        },
        "next": [
            "cad_cli --json build box --workspace-dir <workspace_dir>",
            "cad_cli --json build real-assembly --workspace-dir <workspace_dir>",
            "cad_cli --json build sim-input --workspace-dir <workspace_dir>",
            "cad_cli --json build after-state --workspace-dir <workspace_dir>",
        ],
    }
    emit(payload, args.json)
    return 0 if payload["ok"] else 1


def handle_build_box(args: argparse.Namespace) -> int:
    return run_module("cad_cli.build_box", build_argv(args))


def handle_build_real(args: argparse.Namespace) -> int:
    return run_module("cad_cli.build_real_assembly", build_argv(args))


def handle_build_sim_input(args: argparse.Namespace) -> int:
    return run_module("cad_cli.build_sim_input", build_argv(args))


def handle_build_after_state(args: argparse.Namespace) -> int:
    cad_dir = Path(args.output_dir or args.cad_dir or default_cad_dir(args.workspace_dir)).expanduser().resolve()
    argv = ["--cad-dir", str(cad_dir)]
    if args.spec:
        argv.extend(["--spec", args.spec])
    else:
        argv.extend(["--spec", str(default_spec_path(args.workspace_dir))])
    argv.extend(["--grid-shape", args.grid_shape])
    return run_module("cad_cli.prepare_simulation_after_state", argv)


def handle_build_all(args: argparse.Namespace) -> int:
    steps = [
        ("box", handle_build_box),
        ("real-assembly", handle_build_real),
        ("sim-input", handle_build_sim_input),
        ("after-state", handle_build_after_state),
    ]
    results = []
    for name, handler in steps:
        code, payload = run_step(handler, args, capture=args.json)
        result = {"step": name, "exit_code": code, "ok": code == 0}
        if payload is not None:
            result["result"] = payload
        results.append(result)
        if code != 0:
            emit({"ok": False, "tool": TOOL_NAME, "failed_step": name, "steps": results}, args.json)
            return code
    emit({"ok": True, "tool": TOOL_NAME, "steps": results}, args.json)
    return 0


def run_step(handler: Any, args: argparse.Namespace, *, capture: bool) -> tuple[int, dict[str, Any] | None]:
    if not capture:
        return int(handler(args)), None
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = int(handler(args))
    return code, parse_last_json_object(buffer.getvalue())


def parse_last_json_object(text: str) -> dict[str, Any] | None:
    decoder = json.JSONDecoder()
    best = None
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            value, _end = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            best = value
    return best


def handle_raw_script(args: argparse.Namespace) -> int:
    module_map = {
        "build_box": "cad_cli.build_box",
        "build_real_assembly": "cad_cli.build_real_assembly",
        "build_sim_input": "cad_cli.build_sim_input",
        "prepare_after_state": "cad_cli.prepare_simulation_after_state",
    }
    return run_module(module_map[args.name], list(args.args or []))


def build_argv(args: argparse.Namespace) -> list[str]:
    argv = ["--workspace-dir", args.workspace_dir]
    for attr, flag in (("spec", "--spec"), ("output_dir", "--output-dir"), ("doc_name", "--doc-name"), ("host", "--host")):
        value = getattr(args, attr, None)
        if value:
            argv.extend([flag, str(value)])
    if getattr(args, "port", None):
        argv.extend(["--port", str(args.port)])
    return argv


def run_module(module_name: str, argv: list[str]) -> int:
    module = importlib.import_module(module_name)
    with patched_argv([module_name.rsplit(".", 1)[-1], *argv]):
        return int(module.main())


@contextlib.contextmanager
def patched_argv(argv: list[str]) -> Iterator[None]:
    old = sys.argv
    sys.argv = argv
    try:
        yield
    finally:
        sys.argv = old


def emit(payload: dict[str, Any], as_json: bool) -> None:
    if as_json:
        print_json(payload)
    else:
        print_human(payload)


def print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def print_human(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    raise SystemExit(main())
