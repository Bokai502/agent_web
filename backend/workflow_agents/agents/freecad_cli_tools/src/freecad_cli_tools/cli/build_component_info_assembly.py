#!/usr/bin/env python3
"""Build a new FreeCAD assembly from 00_inputs real_bom + layout_topology + geom."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

from freecad_cli_tools import add_connection_args
from freecad_cli_tools.artifact_registry import (
    add_registry_args,
    artifact_entry,
    build_error_payload,
    finalize_registry_run,
    start_registry_run,
)
from freecad_cli_tools.cli_support import (
    execute_script_payload,
    exit_on_failure,
    normalize_runtime_path,
)
from freecad_cli_tools.component_info_assembly import load_and_normalize_component_info_assembly
from freecad_cli_tools.pipeline_logging import configure_pipeline_logging, get_pipeline_logger, pipeline_step
from freecad_cli_tools.rpc_client import print_result as print_json
from freecad_cli_tools.rpc_script_fragments import PLACEMENT_HELPERS, WALL_HELPERS
from freecad_cli_tools.rpc_script_loader import render_rpc_script
from freecad_cli_tools.runtime_config import (
    get_default_component_info_max_step_size_mb,
    get_default_workspace_dir,
    resolve_workspace_path,
)
from freecad_cli_tools.workspace import add_workspace_arg, validate_workspace_root

COMPONENT_INFO_ASSEMBLY_STEM = "component_info_assembly"
DEFAULT_COMPONENT_INFO_OUTPUT_DIR = Path("01_cad")
DEFAULT_COMPONENT_INFO_INPUT_DIR = Path("00_inputs")


def parse_args() -> argparse.Namespace:
    default_max_step_size_mb = get_default_component_info_max_step_size_mb()
    parser = argparse.ArgumentParser(
        description=(
            "Create a new FreeCAD assembly from 00_inputs layout_topology.json, geom.json, "
            "and real_bom.json. STEP/STP assets are resolved from real_bom.source.template_csv "
            "when geom_component_info.json is not supplied."
        )
    )
    parser.add_argument("--layout-topology", help="Path to layout_topology.json.")
    parser.add_argument("--geom", help="Path to geom.json.")
    parser.add_argument("--real-bom", help="Path to real_bom.json.")
    add_workspace_arg(parser)
    parser.add_argument(
        "--geom-component-info",
        help=(
            "Optional path to geom_component_info.json. When omitted or missing, the command "
            "builds equivalent component info from real_bom.json and its template_csv."
        ),
    )
    parser.add_argument("--doc-name", required=True, help="Name of the FreeCAD document to create.")
    parser.add_argument(
        "--output",
        help=(
            "Optional output STEP path or directory. Exported filenames are always "
            "'component_info_assembly.step' and 'component_info_assembly.glb'. "
            "Defaults to './01_cad' under the configured workspace root."
        ),
    )
    parser.add_argument(
        "--max-step-size-mb",
        type=float,
        default=default_max_step_size_mb,
        help=(
            "Maximum STEP/STP size to import before falling back to a box placeholder. "
            "Use -1 to disable the limit. Default: %(default)s MB."
        ),
    )
    parser.add_argument("--view", default="Isometric", help="Preferred GUI view after creation.")
    parser.add_argument("--no-fit-view", action="store_true", help="Skip GUI fit/view adjustment.")
    parser.add_argument(
        "--export-backend",
        choices=("hybrid-link",),
        default="hybrid-link",
        help=(
            "CAD export backend. Only 'hybrid-link' is supported: the command first "
            "builds the direct assembly in FreeCAD, then exports through the hybrid "
            "App::Link component-node low-complexity exporter."
        ),
    )
    parser.add_argument(
        "--include-envelope",
        action="store_true",
        default=True,
        help="Keep Envelope_part in the hybrid-link export. Enabled by default.",
    )
    add_connection_args(parser)
    add_registry_args(parser)
    return parser.parse_args()


def get_default_component_info_assembly_step_path() -> Path:
    return resolve_workspace_path(DEFAULT_COMPONENT_INFO_OUTPUT_DIR) / (
        f"{COMPONENT_INFO_ASSEMBLY_STEM}.step"
    )


def resolve_component_info_assembly_step_path(path: str | Path | None = None) -> Path:
    """Resolve component-info assembly exports to a distinct fixed basename."""
    if path is None:
        return get_default_component_info_assembly_step_path()

    candidate = resolve_workspace_path(path)
    if candidate.suffix:
        return candidate.with_name(f"{COMPONENT_INFO_ASSEMBLY_STEM}.step")
    return candidate / f"{COMPONENT_INFO_ASSEMBLY_STEM}.step"


def stage_runtime_paths(input_path: Path, output_path: Path, doc_name: str) -> tuple[Path, Path]:
    safe_doc_name = (
        "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in doc_name).strip("_")
        or "assembly"
    )
    root = get_default_workspace_dir() / "assembly_builds" / safe_doc_name
    return root / "inputs" / input_path.name, root / "outputs" / output_path.name


def stage_input_data(data: dict[str, object], target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    for directory in (target.parent, target.parent.parent, target.parent.parent.parent):
        if directory.exists():
            try:
                os.chmod(directory, 0o777)
            except PermissionError:
                pass
    target.write_text(json.dumps(data, indent=2), encoding="utf-8")


def stage_output_dir(target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    for directory in (target.parent, target.parent.parent, target.parent.parent.parent):
        if directory.exists():
            try:
                os.chmod(directory, 0o777)
            except PermissionError:
                pass


def copy_runtime_export(staged_output: Path, final_output: Path) -> None:
    if staged_output.resolve() == final_output.resolve():
        return
    final_output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(staged_output, final_output)
    try:
        shutil.copymode(staged_output, final_output)
    except PermissionError:
        pass


def collect_runtime_exports(staged_output: Path, final_output: Path) -> None:
    copy_runtime_export(staged_output, final_output)
    staged_glb = staged_output.with_suffix(".glb")
    if staged_glb.exists():
        final_glb = final_output.with_suffix(".glb")
        copy_runtime_export(staged_glb, final_glb)
    staged_hybrid_summary = staged_output.with_suffix(".hybrid_summary.json")
    if staged_hybrid_summary.exists():
        final_hybrid_summary = final_output.with_suffix(".hybrid_summary.json")
        copy_runtime_export(staged_hybrid_summary, final_hybrid_summary)


def registry_inputs(
    *,
    args: argparse.Namespace,
    layout_topology_path: Path,
    geom_path: Path,
    geom_component_info_path: Path | None,
    output_path: Path,
) -> dict[str, object]:
    return {
        "doc_name": args.doc_name,
        "output_path": str(output_path),
        "rpc_host": args.host,
        "rpc_port": args.port,
        "view": args.view,
        "fit_view": not args.no_fit_view,
        "max_step_size_mb": args.max_step_size_mb,
        "export_backend": args.export_backend,
        "include_envelope": args.include_envelope,
        "layout_topology_path": str(layout_topology_path),
        "geom_path": str(geom_path),
        "geom_component_info_path": str(geom_component_info_path) if geom_component_info_path else None,
        "real_bom_path": str(getattr(args, "real_bom_path", "")),
        "input_format": "component_info_assembly",
    }


def main() -> None:
    args = parse_args()
    workspace_root = validate_workspace_root(args.workspace)
    configure_pipeline_logging(command="assembly create-from-component-info", workspace=workspace_root)
    logger = get_pipeline_logger("component_info_assembly")
    logger.info("starting component-info assembly: doc=%s output=%s", args.doc_name, args.output)
    layout_topology_path = resolve_workspace_path(
        args.layout_topology or DEFAULT_COMPONENT_INFO_INPUT_DIR / "layout_topology.json"
    )
    geom_path = resolve_workspace_path(args.geom or DEFAULT_COMPONENT_INFO_INPUT_DIR / "geom.json")
    real_bom_path = resolve_workspace_path(args.real_bom or DEFAULT_COMPONENT_INFO_INPUT_DIR / "real_bom.json")
    geom_component_info_path = (
        resolve_workspace_path(args.geom_component_info) if args.geom_component_info else None
    )
    for required_path in (layout_topology_path, geom_path, real_bom_path):
        if not required_path.exists():
            logger.error("required input file not found: %s", required_path)
            raise FileNotFoundError(f"required input file not found: {required_path}")
    if geom_component_info_path is not None and not geom_component_info_path.exists():
        logger.error("geom_component_info.json not found: %s", geom_component_info_path)
        raise FileNotFoundError(f"geom_component_info.json not found: {geom_component_info_path}")
    args.real_bom_path = real_bom_path
    output_path = resolve_component_info_assembly_step_path(args.output)
    staged_input_name = Path("normalized_component_info_assembly.json")
    staged_input_path, staged_output_path = stage_runtime_paths(
        staged_input_name,
        output_path,
        args.doc_name,
    )
    output_paths = {
        "step": output_path,
        "glb": output_path.with_suffix(".glb"),
    }
    registry_run = start_registry_run(
        args,
        tool="freecad-create-assembly-from-component-info",
        operation_type="create_component_info_assembly",
        inputs=registry_inputs(
            args=args,
            layout_topology_path=layout_topology_path,
            geom_path=geom_path,
            geom_component_info_path=geom_component_info_path or real_bom_path,
            output_path=output_path,
        ),
    )

    try:
        with pipeline_step("component_info_prepare"):
            logger.info(
                "normalizing component-info inputs: layout=%s geom=%s real_bom=%s component_info=%s",
                layout_topology_path,
                geom_path,
                real_bom_path,
                geom_component_info_path,
            )
            normalized_data = load_and_normalize_component_info_assembly(
                layout_topology_path=layout_topology_path,
                geom_path=geom_path,
                geom_component_info_path=geom_component_info_path,
                real_bom_path=real_bom_path,
                max_step_size_mb=args.max_step_size_mb,
            )
            stage_input_data(normalized_data, staged_input_path)
            stage_output_dir(staged_output_path)
            logger.info("staged component-info input: %s output=%s", staged_input_path, staged_output_path)
            code = render_rpc_script(
                "assembly_from_component_info.py",
                {
                    "__PLACEMENT_HELPERS__": PLACEMENT_HELPERS,
                    "__WALL_HELPERS__": WALL_HELPERS,
                    "__INPUT_PATH__": json.dumps(normalize_runtime_path(staged_input_path)),
                    "__DOC_NAME__": json.dumps(args.doc_name),
                    "__SAVE_PATH__": json.dumps(normalize_runtime_path(staged_output_path)),
                    "__EXPORT_STEP__": "False",
                    "__EXPORT_GLB__": "False",
                    "__FIT_VIEW__": "False" if args.no_fit_view else "True",
                    "__VIEW_NAME__": json.dumps(args.view),
                },
            )
        with pipeline_step("component_info_freecad_export"):
            logger.info("building FreeCAD component-info document without static export: host=%s port=%s", args.host, args.port)
            payload = execute_script_payload(args.host, args.port, code)
            logger.info("FreeCAD component-info document build returned: success=%s error=%s", payload.get("success"), payload.get("error"))
        if payload.get("success"):
            hybrid_code = render_rpc_script(
                "export_component_info_hybrid_link.py",
                {
                    "__INPUT_PATH__": json.dumps(normalize_runtime_path(staged_input_path)),
                    "__DOC_NAME__": json.dumps(args.doc_name),
                    "__SAVE_PATH__": json.dumps(normalize_runtime_path(staged_output_path)),
                    "__EXPORT_GLB__": "True",
                    "__INCLUDE_ENVELOPE__": "True" if args.include_envelope else "False",
                },
            )
            with pipeline_step("component_info_hybrid_link_export"):
                logger.info(
                    "executing required hybrid App::Link component-node low-complexity export: host=%s port=%s include_envelope=%s",
                    args.host,
                    args.port,
                    args.include_envelope,
                )
                hybrid_payload = execute_script_payload(args.host, args.port, hybrid_code)
                logger.info(
                    "Hybrid App::Link export returned: success=%s error=%s",
                    hybrid_payload.get("success"),
                    hybrid_payload.get("error"),
                )
            if hybrid_payload.get("success"):
                payload = {**payload, "document_build": payload, **hybrid_payload}
            else:
                payload = hybrid_payload
        if payload.get("success"):
            collect_runtime_exports(staged_output_path, output_path)
            payload["save_path"] = str(output_path)
            final_glb = output_path.with_suffix(".glb")
            payload["glb_path"] = str(final_glb) if final_glb.exists() else None
            logger.info("collected runtime exports: step=%s glb=%s", output_path, payload["glb_path"])

        step_path = payload.get("save_path")
        glb_path = payload.get("glb_path")
        step_exists = bool(step_path) and Path(step_path).exists()
        glb_exists = bool(glb_path) and Path(glb_path).exists()
        if payload.get("success") and step_exists and glb_exists:
            registry_status = "success"
            registry_error = None
        elif payload.get("success") and step_exists:
            registry_status = "partial_success"
            registry_error = build_error_payload(
                "GLB_EXPORT_INCOMPLETE",
                "STEP export succeeded but the expected GLB artifact was not found.",
                details=payload,
            )
        else:
            registry_status = "failed"
            registry_error = build_error_payload(
                "COMPONENT_INFO_ASSEMBLY_BUILD_FAILED",
                str(payload.get("error") or "FreeCAD component-info assembly build failed."),
                details=payload,
            )
        logger.info("component-info artifact status: status=%s step_exists=%s glb_exists=%s", registry_status, step_exists, glb_exists)

        finalize_registry_run(
            registry_run,
            status=registry_status,
            outputs={
                "layout_topology_path": str(layout_topology_path),
                "geom_path": str(geom_path),
                "real_bom_path": str(real_bom_path),
                "geom_component_info_path": str(geom_component_info_path) if geom_component_info_path else None,
                "step_path": str(step_path) if step_path else None,
                "glb_path": str(glb_path) if glb_path else None,
            },
            result=payload,
            error=registry_error,
            artifacts=[
                artifact_entry("layout_topology", layout_topology_path),
                artifact_entry("geom", geom_path),
                artifact_entry("real_bom", real_bom_path),
                *(
                    [artifact_entry("geom_component_info", geom_component_info_path)]
                    if geom_component_info_path
                    else []
                ),
                artifact_entry("step", step_path),
                artifact_entry("glb", glb_path),
            ],
        )
        logger.info("component-info registry finalized: status=%s", registry_status)
        print_json(payload)
        exit_on_failure(payload)
    except Exception as exc:
        logger.exception("component-info assembly failed: %s", exc)
        finalize_registry_run(
            registry_run,
            status="failed",
            outputs={
                "layout_topology_path": str(layout_topology_path),
                "geom_path": str(geom_path),
                "real_bom_path": str(real_bom_path),
                "geom_component_info_path": str(geom_component_info_path) if geom_component_info_path else None,
                "step_path": str(output_path),
                "glb_path": str(output_path.with_suffix(".glb")),
            },
            result={"success": False},
            error=build_error_payload("COMPONENT_INFO_ASSEMBLY_EXCEPTION", str(exc)),
            artifacts=[
                artifact_entry("layout_topology", layout_topology_path),
                artifact_entry("geom", geom_path),
                artifact_entry("real_bom", real_bom_path),
                *(
                    [artifact_entry("geom_component_info", geom_component_info_path)]
                    if geom_component_info_path
                    else []
                ),
                artifact_entry("step", output_path),
                artifact_entry("glb", output_path.with_suffix(".glb")),
            ],
        )
        raise


if __name__ == "__main__":
    main()
