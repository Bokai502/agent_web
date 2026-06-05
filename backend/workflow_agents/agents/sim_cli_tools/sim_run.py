#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any


TOOL_ROOT = Path(__file__).resolve().parent
RUNTIME_ROOT = TOOL_ROOT / "runtime"
CODEX_AGENTS_ROOT = RUNTIME_ROOT / "codex_agents"
EXTRA_PYTHONPATH = Path("/tmp/codex_openpyxl_py313")

APP_CONFIG_PATH = Path(os.getenv("CODEX_WEB_CONFIG_PATH", TOOL_ROOT.parents[3] / "config.json"))
DEFAULT_PYTHON = Path("/data/conda/bin/python")
DEFAULT_SAMPLE_ID = "930001"
TOOL_NAME = "sim-run"

REQUIRED_INPUT_FILES = ("real_bom.json", "layout_topology.json", "geom.json")
REQUIRED_CAD_FILES = (
    "geometry_after.step",
    "geometry_after.geom.json",
    "geometry_after.layout_topology.json",
    "geometry_after_registry.json",
    "simulation_input.json",
    "comsol_inputs/coord.txt",
    "comsol_inputs/channels_input.npz",
)


def bootstrap_runtime() -> None:
    for path in (
        RUNTIME_ROOT,
        EXTRA_PYTHONPATH,
        CODEX_AGENTS_ROOT / "vendor",
        CODEX_AGENTS_ROOT / "vendor" / "layout_runtime",
        CODEX_AGENTS_ROOT / "vendor" / "shared_contracts",
    ):
        value = str(path)
        if value in sys.path:
            sys.path.remove(value)
        sys.path.insert(0, value)

    if "codex_agents" not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            "codex_agents",
            CODEX_AGENTS_ROOT / "__init__.py",
            submodule_search_locations=[str(CODEX_AGENTS_ROOT)],
        )
        if spec is None or spec.loader is None:
            raise RuntimeError(f"cannot load copied runtime from {CODEX_AGENTS_ROOT}")
        module = importlib.util.module_from_spec(spec)
        sys.modules["codex_agents"] = module
        spec.loader.exec_module(module)


bootstrap_runtime()

from codex_agents.config import BomExternalToolsPipelineConfig  # noqa: E402
from codex_agents.context import BomExternalToolsPipelineContext  # noqa: E402
from codex_agents.local_io import read_json, write_json  # noqa: E402
from codex_agents.logging_utils import configure_logging, step_logging_context  # noqa: E402
from codex_agents.stage_adapters import case_stage, layout_stage_result  # noqa: E402
from codex_agents.steps import AnalysisStep, CaseBuildStep, FieldExportStep, PostprocessStep, SimulationStep  # noqa: E402
from input_normalize.normalize import normalize_bom_to_components  # noqa: E402


SIMULATION_LOOP_STAGE_START_PROGRESS = {
    "simulation": ("simulation_running", 0.0),
    "field_export": ("field_export_running", 70.0),
    "postprocess": ("postprocess_running", 80.0),
    "case_build": ("case_build_running", 90.0),
    "analysis": ("analysis_running", 96.0),
}

SIMULATION_LOOP_STAGE_COMPLETE_PROGRESS = {
    "simulation": ("simulation_running", 70.0),
    "field_export": ("field_export_running", 80.0),
    "postprocess": ("postprocess_running", 90.0),
    "case_build": ("case_build_running", 96.0),
    "analysis": ("analysis_running", 100.0),
}


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handler = getattr(args, "handler", None)
    if handler is None:
        parser.print_help()
        return 0
    try:
        return handler(args)
    except RuntimeError as exc:
        payload = {"ok": False, "error": str(exc)}
        if getattr(args, "json", False):
            print_json(payload)
        else:
            print(f"{TOOL_NAME}: error: {exc}", file=sys.stderr)
        return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=TOOL_NAME,
        description="Run copied cad_sim_agents runtime on 00_inputs + 01_cad and write outputs under 02_sim.",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    subparsers = parser.add_subparsers(dest="command")

    doctor = subparsers.add_parser("doctor", help="Check whether the input set can run.")
    add_common_args(doctor)
    doctor.set_defaults(handler=handle_doctor)

    run = subparsers.add_parser("run", help="Prepare 02_sim and run simulation through analysis.")
    add_common_args(run)
    run.add_argument(
        "--simulation-backend",
        choices=("comsol_local", "mock_contract"),
        default=os.environ.get("SIMULATION_BACKEND", "comsol_local"),
    )
    run.add_argument("--sample-id", default=os.environ.get("SAMPLE_ID", DEFAULT_SAMPLE_ID))
    run.add_argument("--seed", type=int, default=int(os.environ.get("SEED", "930001")))
    run.add_argument("--mph-port", type=int, default=int(os.environ.get("MPH_PORT", "32036")), help="Preferred COMSOL mphserver port. Defaults to 32036 to avoid the common 2036 port.")
    run.set_defaults(open_external_tools=True)
    run.add_argument("--open-tools", dest="open_external_tools", action="store_true", help="Open COMSOL/ParaView GUI tools after simulation. Enabled by default.")
    run.add_argument("--no-open-tools", dest="open_external_tools", action="store_false", help="Do not open COMSOL/ParaView GUI tools after simulation.")
    run.add_argument("--async-open-tools", dest="open_external_tools_async", action="store_true", help="Start COMSOL/ParaView GUI loaders asynchronously instead of waiting for launcher completion.")
    run.add_argument("--force", action="store_true", help="Ignore a stale run lock after verifying the recorded PID is not alive.")
    run.add_argument("--quiet", action="store_true")
    run.set_defaults(handler=handle_run)
    return parser


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--workspace-dir", type=Path, default=resolve_default_workspace())
    parser.add_argument("--input-dir", type=Path, default=None, help="Defaults to <workspace-dir>/00_inputs.")
    parser.add_argument("--cad-dir", type=Path, default=None, help="Defaults to <workspace-dir>/01_cad.")
    parser.add_argument("--output-dir", type=Path, default=None, help="Defaults to <workspace-dir>/02_sim.")


def resolve_default_workspace() -> Path:
    for env_name in ("SIM_WORKSPACE_DIR", "FREECAD_WORKSPACE_DIR", "WORKSPACE_DIR"):
        workspace = os.environ.get(env_name)
        if workspace:
            return Path(workspace)
    if APP_CONFIG_PATH.exists():
        try:
            config = json.loads(APP_CONFIG_PATH.read_text(encoding="utf-8"))
            workspace_config = config.get("workspace", {})
            legacy_freecad_config = config.get("freecad", {})
            workspace = None
            if isinstance(workspace_config, dict):
                workspace = workspace_config.get("workspaceDir")
            if workspace is None and isinstance(legacy_freecad_config, dict):
                workspace = legacy_freecad_config.get("workspaceDir")
            if workspace:
                return Path(workspace)
        except (OSError, json.JSONDecodeError):
            pass
    return Path.cwd()


def handle_doctor(args: argparse.Namespace) -> int:
    paths = resolve_paths(args)
    missing = missing_required_files(paths["input_dir"], paths["cad_dir"])
    payload = {
        "ok": not missing and CODEX_AGENTS_ROOT.exists(),
        "tool": TOOL_NAME,
        "runtime": str(CODEX_AGENTS_ROOT),
        "paths": {key: str(value) for key, value in paths.items()},
        "missing_files": [str(path) for path in missing],
        "outputs": {
            "root": str(paths["output_dir"]),
            "simulation": str(paths["output_dir"] / "simulation"),
            "postprocess": str(paths["output_dir"] / "postprocess"),
            "case_build": str(paths["output_dir"] / "case_build"),
            "analysis": str(paths["output_dir"] / "analysis"),
        },
    }
    emit(payload, args.json)
    return 0 if payload["ok"] else 1


def handle_run(args: argparse.Namespace) -> int:
    paths = resolve_paths(args)
    missing = missing_required_files(paths["input_dir"], paths["cad_dir"])
    if missing:
        raise RuntimeError("missing required files: " + ", ".join(str(path) for path in missing))

    with run_lock(paths["output_dir"], force=bool(args.force)):
        config = BomExternalToolsPipelineConfig(
            bom_json=paths["input_dir"] / "real_bom.json",
            run_root=paths["output_dir"],
            sample_id=args.sample_id,
            seed=args.seed,
            simulation_backend=args.simulation_backend,
            mph_port=int(args.mph_port) if args.mph_port else None,
            open_external_tools=bool(args.open_external_tools),
            open_external_tools_async=bool(args.open_external_tools_async),
        )
        configure_logging(run_root=config.run_root, log_file=paths["workspace_dir"] / "logs" / "pipeline.log", quiet=bool(args.quiet))
        write_run_state(paths["output_dir"], args)
        ctx = BomExternalToolsPipelineContext(config, restore_existing=False)
        bind_source_paths(ctx, paths)
        prepare_contract_workspace(ctx, paths, args.sample_id, args.seed)

        for step in (SimulationStep(), FieldExportStep(), PostprocessStep(), CaseBuildStep(), AnalysisStep()):
            step_name = progress_step_name(step)
            start_simulation_loop_progress(paths["workspace_dir"], step_name)
            with step_logging_context(step_name):
                with comsol_progress_watcher(paths["workspace_dir"], step_name):
                    execution = step.run(ctx)
                ctx.append_stage(execution.stage)
                sync_simulation_loop_progress(paths["workspace_dir"], step_name, execution.stage)
                if not execution.continue_pipeline:
                    manifest = ctx.write_manifest()
                    finalize_simulation_loop_progress(paths["workspace_dir"], manifest)
                    emit(manifest, args.json)
                    return 0 if manifest.get("ok") else 1

        manifest = ctx.write_manifest()
        finalize_simulation_loop_progress(paths["workspace_dir"], manifest)
        emit(manifest, args.json)
        return 0 if manifest.get("ok") else 1


def start_simulation_loop_progress(workspace_dir: Path, step_name: str) -> None:
    progress = SIMULATION_LOOP_STAGE_START_PROGRESS.get(step_name)
    if progress is None:
        return
    status, percentage = progress
    write_simulation_loop_progress(workspace_dir, status=status, completed=False, percentage=percentage)


class comsol_progress_watcher:
    def __init__(self, workspace_dir: Path, step_name: str, *, interval_seconds: float = 1.0) -> None:
        self.workspace_dir = workspace_dir
        self.step_name = step_name
        self.interval_seconds = interval_seconds
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.started_at = time.time()

    def __enter__(self) -> "comsol_progress_watcher":
        if self.step_name != "simulation":
            return self
        self.thread = threading.Thread(target=self._run, name="comsol-progress-sync", daemon=True)
        self.thread.start()
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=max(1.0, self.interval_seconds + 0.5))
            self.thread = None
        self._sync_once()

    def _run(self) -> None:
        while not self.stop_event.is_set():
            self._sync_once()
            self.stop_event.wait(self.interval_seconds)

    def _sync_once(self) -> None:
        try:
            from sim_cli_tools.comsol_progress import (
                default_paths,
                normalize_comsol_progress,
                sync_workspace_progress,
            )

            status_path, progress_path = default_paths(self.workspace_dir)
            if not progress_path.exists():
                return
            if progress_path.stat().st_mtime < self.started_at:
                return
            payload = normalize_comsol_progress(status_path=status_path, progress_path=progress_path)
            if not payload.get("available"):
                return
            sync_workspace_progress(self.workspace_dir, payload)
        except Exception:
            return


def sync_simulation_loop_progress(workspace_dir: Path, step_name: str, stage: dict[str, Any]) -> None:
    if stage.get("status") != "completed":
        write_simulation_loop_progress(workspace_dir, status="failed", completed=True, percentage=100.0)
        return
    progress = SIMULATION_LOOP_STAGE_COMPLETE_PROGRESS.get(step_name)
    if progress is None:
        return
    status, percentage = progress
    write_simulation_loop_progress(workspace_dir, status=status, completed=False, percentage=percentage)


def finalize_simulation_loop_progress(workspace_dir: Path, manifest: dict[str, Any]) -> None:
    status = "completed" if manifest.get("ok") else "failed"
    write_simulation_loop_progress(workspace_dir, status=status, completed=True, percentage=100.0)


def write_simulation_loop_progress(
    workspace_dir: Path,
    *,
    status: str,
    completed: bool,
    percentage: float,
) -> None:
    try:
        from sim_cli_tools.progress import write_loop_progress

        write_loop_progress(
            workspace_dir,
            loop_name="simulation",
            status=status,
            completed=completed,
            percentage=percentage,
        )
    except Exception:
        return


def resolve_paths(args: argparse.Namespace) -> dict[str, Path]:
    workspace = args.workspace_dir.expanduser().resolve()
    return {
        "workspace_dir": workspace,
        "input_dir": (args.input_dir or workspace / "00_inputs").expanduser().resolve(),
        "cad_dir": (args.cad_dir or workspace / "01_cad").expanduser().resolve(),
        "output_dir": (args.output_dir or workspace / "02_sim").expanduser().resolve(),
    }


def missing_required_files(input_dir: Path, cad_dir: Path) -> list[Path]:
    missing: list[Path] = []
    for name in REQUIRED_INPUT_FILES:
        path = input_dir / name
        if not path.exists():
            missing.append(path)
    for name in REQUIRED_CAD_FILES:
        path = cad_dir / name
        if not path.exists():
            missing.append(path)
    return missing


class run_lock:
    def __init__(self, output_dir: Path, *, force: bool = False) -> None:
        self.output_dir = output_dir
        self.lock_path = output_dir / ".run.lock"
        self.force = force
        self.fd: int | None = None

    def __enter__(self) -> "run_lock":
        self.output_dir.mkdir(parents=True, exist_ok=True)
        if self.lock_path.exists():
            lock = read_lock(self.lock_path)
            pid = int(lock.get("pid") or 0)
            if pid and pid_alive(pid):
                raise RuntimeError(f"run lock is active: {self.lock_path} pid={pid}")
            if not self.force:
                raise RuntimeError(f"stale run lock exists: {self.lock_path}; rerun with --force to remove it")
            self.lock_path.unlink()
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        self.fd = os.open(self.lock_path, flags, 0o644)
        payload = {
            "pid": os.getpid(),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "output_dir": str(self.output_dir),
        }
        os.write(self.fd, (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        os.fsync(self.fd)
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        try:
            self.lock_path.unlink()
        except FileNotFoundError:
            pass


def read_lock(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def write_run_state(output_dir: Path, args: argparse.Namespace) -> None:
    write_json(
        output_dir / "run_state.json",
        {
            "schema_version": "1.0",
            "pid": os.getpid(),
            "simulation_backend": args.simulation_backend,
            "mph_port": int(args.mph_port) if args.mph_port else None,
            "open_external_tools": bool(args.open_external_tools),
            "open_external_tools_async": bool(args.open_external_tools_async),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        },
    )


def progress_step_name(step: object) -> str:
    if isinstance(step, SimulationStep):
        return "simulation"
    if isinstance(step, FieldExportStep):
        return "field_export"
    if isinstance(step, PostprocessStep):
        return "postprocess"
    if isinstance(step, CaseBuildStep):
        return "case_build"
    if isinstance(step, AnalysisStep):
        return "analysis"
    raise RuntimeError(f"unknown progress step: {step.__class__.__name__}")


def prepare_contract_workspace(
    ctx: BomExternalToolsPipelineContext,
    paths: dict[str, Path],
    sample_id: str,
    seed: int,
) -> None:
    ctx.paths["run_root"].mkdir(parents=True, exist_ok=True)
    ensure_components(paths["input_dir"], ctx.paths["run_root"] / "components.json")
    ensure_sample_yaml(paths["cad_dir"], paths["input_dir"], ctx.paths["run_root"] / "sample.yaml", sample_id, seed)

    layout_result = {
        "ok": True,
        "bom": str(paths["input_dir"] / "real_bom.json"),
        "run_dir": str(ctx.paths["run_root"]),
        "layout_dir": str(paths["input_dir"]),
        "component_info_dir": None,
        "stats": {"n_unplaced": 0},
    }
    geometry_result = {
        "ok": True,
        "run_dir": str(ctx.paths["run_root"]),
        "geometry_edit_dir": str(paths["cad_dir"]),
        "planner_execution_ok": True,
        "covered_missing_count": 0,
        "unresolved_missing_count": 0,
        "relayout_success": None,
        "relayout_n_unplaced": None,
        "cad_rebuilt": False,
        "step_copied_from_source": str(paths["cad_dir"] / "geometry_after.step"),
        "warnings": ["geometry_validate satisfied from existing 01_cad"],
        "errors": [],
    }
    layout_stage = layout_stage_result(layout_result)
    geometry_stage = case_stage("geometry_validate", geometry_result)
    ctx.layout_result = layout_result
    ctx.geometry_result = geometry_result
    ctx.write_stage_log("layout_generate_raw_result.json", layout_result)
    ctx.write_stage_log("layout_generate_stage_result.json", layout_stage)
    ctx.write_stage_log("geometry_validate_raw_result.json", geometry_result)
    ctx.write_stage_log("geometry_validate_stage_result.json", geometry_stage)
    ctx.append_stage(layout_stage)
    ctx.append_stage(geometry_stage)
    ctx.write_manifest()


def bind_source_paths(ctx: BomExternalToolsPipelineContext, paths: dict[str, Path]) -> None:
    ctx.paths["inputs"] = paths["input_dir"]
    ctx.paths["layout"] = paths["input_dir"]
    ctx.paths["geometry_edit"] = paths["cad_dir"]
    ctx.paths["logs"] = paths["workspace_dir"] / "logs"


def ensure_components(input_dir: Path, components_path: Path) -> None:
    bom = read_json(input_dir / "real_bom.json")
    components = normalize_bom_to_components(bom, source_file="real_bom.json")
    write_json(components_path, components)


def ensure_sample_yaml(geometry_dir: Path, input_dir: Path, sample_yaml: Path, sample_id: str, seed: int) -> None:
    simulation_input = read_json(geometry_dir / "simulation_input.json")
    geom = read_json(input_dir / "geom.json")
    sample_yaml.write_text(to_yaml(sample_document(sample_id, seed, simulation_input, geom)), encoding="utf-8")


def sample_document(sample_id: str, seed: int, simulation_input: dict[str, Any], geom: dict[str, Any]) -> dict[str, Any]:
    contact_resistance_override = os.environ.get("SIM_CONTACT_RESISTANCE_OVERRIDE")
    components = {}
    for component in simulation_input.get("components", []):
        component_id = component["component_id"]
        contact_resistance = component.get("contact_resistance")
        if contact_resistance_override:
            contact_resistance = float(contact_resistance_override)
        components[component_id] = {
            "bbox": component["bbox"],
            "power": component.get("power_W", 0.0),
            "category": component.get("category", ""),
            "kind": component.get("kind", ""),
            "mount_face_id": component.get("mount_face_id"),
            "component_mount_face_id": component.get("component_mount_face_id"),
            "component_mount_face": component.get("component_mount_face"),
            "alignment": component.get("alignment", {}),
            "thermal_interface": {"contact_resistance": contact_resistance},
        }
    outer_shell = geom.get("outer_shell", {})
    return {
        "schema_version": "2.0",
        "units": {"length": "mm", "mass": "kg", "power": "W", "temperature": "K"},
        "sample_id": sample_id,
        "seed": seed,
        "outer_shell": outer_shell,
        "components": components,
        "install_faces": geom.get("install_faces", {}),
        "cabin_walls": geom.get("cabin_walls", []),
        "cabins": cabins_with_inner_bbox(geom.get("cabins", []), outer_shell),
    }


def cabins_with_inner_bbox(cabins: Any, outer_shell: dict[str, Any]) -> list[dict[str, Any]]:
    inner_bbox = outer_shell.get("inner_bbox")
    result: list[dict[str, Any]] = []
    for cabin in cabins if isinstance(cabins, list) else []:
        if not isinstance(cabin, dict):
            continue
        item = dict(cabin)
        if "inner_bbox" not in item and inner_bbox is not None:
            item["inner_bbox"] = inner_bbox
        result.append(item)
    return result


def to_yaml(value: Any, indent: int = 0) -> str:
    prefix = " " * indent
    lines: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, (dict, list)):
                lines.append(f"{prefix}{key}:")
                lines.append(to_yaml(item, indent + 2))
            else:
                lines.append(f"{prefix}{key}: {yaml_scalar(item)}")
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)):
                lines.append(f"{prefix}-")
                lines.append(to_yaml(item, indent + 2))
            else:
                lines.append(f"{prefix}- {yaml_scalar(item)}")
    else:
        lines.append(f"{prefix}{yaml_scalar(value)}")
    return "\n".join(lines) + ("\n" if indent == 0 else "")


def yaml_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(str(value), ensure_ascii=False)


def print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False))


def emit(payload: dict[str, Any], as_json: bool) -> None:
    if as_json:
        print_json(payload)
    else:
        print("ok" if payload.get("ok") else "failed")
        if payload.get("run_root"):
            print(f"run_root: {payload['run_root']}")


if __name__ == "__main__":
    raise SystemExit(main())
