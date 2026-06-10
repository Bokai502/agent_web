#!/usr/bin/env python3
"""Build 01_cad artifacts from 00_inputs real_bom + layout_topology + geom."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from freecad_cli_tools import add_connection_args
from freecad_cli_tools.artifact_registry import (
    add_registry_args,
    artifact_entry,
    build_error_payload,
    finalize_registry_run,
    start_registry_run,
)
from freecad_cli_tools.cad_inputs import build_cad_stage_inputs
from freecad_cli_tools.cli_support import execute_script_payload, exit_on_failure, normalize_runtime_path
from freecad_cli_tools.cli.build_component_info_assembly import (
    collect_runtime_exports,
    stage_input_data,
    stage_output_dir,
    stage_runtime_paths,
)
from freecad_cli_tools.component_info_assembly import load_and_normalize_component_info_assembly
from freecad_cli_tools.doc_name import add_doc_name_arg, resolve_doc_name
from freecad_cli_tools.pipeline_logging import configure_pipeline_logging, get_pipeline_logger, pipeline_step
from freecad_cli_tools.rpc_client import print_result as print_json
from freecad_cli_tools.rpc_script_fragments import COMPONENT_SHAPE_HELPERS, PLACEMENT_HELPERS
from freecad_cli_tools.rpc_script_loader import render_rpc_script
from freecad_cli_tools.runtime_config import (
    get_default_component_info_max_step_size_mb,
    resolve_workspace_path,
)
from freecad_cli_tools.workspace import add_workspace_arg, validate_workspace_root


def parse_args() -> argparse.Namespace:
    default_max_step_size_mb = get_default_component_info_max_step_size_mb()
    parser = argparse.ArgumentParser(
        description=(
            "Build CAD-stage artifacts from 00_inputs/real_bom.json, "
            "00_inputs/layout_topology.json, and 00_inputs/geom.json."
        )
    )
    add_workspace_arg(parser)
    parser.add_argument(
        "--input-dir",
        default="00_inputs",
        help="Input directory under the workspace. Default: 00_inputs.",
    )
    parser.add_argument(
        "--output-dir",
        default="01_cad",
        help="Output directory under the workspace. Default: 01_cad.",
    )
    parser.add_argument("--real-bom", help="Optional explicit real_bom.json path.")
    parser.add_argument("--layout-topology", help="Optional explicit layout_topology.json path.")
    parser.add_argument("--geom", help="Optional explicit geom.json path.")
    add_doc_name_arg(parser)
    parser.add_argument("--view", default="Isometric", help="Preferred GUI view after creation.")
    parser.add_argument("--no-fit-view", action="store_true", help="Skip GUI fit/view adjustment.")
    parser.add_argument(
        "--real-cad-backend",
        choices=("hybrid-link", "static", "none"),
        default="hybrid-link",
        help=(
            "Supplemental real-CAD assembly backend. The standard geometry_after.step/.glb "
            "placeholder assembly is always kept for downstream thermal simulation. "
            "'hybrid-link' additionally writes geometry_after_real_cad.step/.glb using App::Link "
            "for repeated STEP assets. 'static' writes the direct real-CAD assembly. "
            "'none' disables the supplemental real-CAD export."
        ),
    )
    parser.add_argument(
        "--max-step-size-mb",
        type=float,
        default=default_max_step_size_mb,
        help=(
            "Maximum STEP/STP size to import for the supplemental real-CAD backend before falling back to a box. "
            f"Use -1 to disable the limit. Default: {default_max_step_size_mb:g}."
        ),
    )
    parser.add_argument(
        "--grid-shape",
        nargs=3,
        type=int,
        metavar=("NX", "NY", "NZ"),
        default=(32, 32, 32),
        help=(
            "Grid shape used for comsol_inputs/coord.txt and "
            "comsol_inputs/channels_input.npz. Default: 32 32 32."
        ),
    )
    add_connection_args(parser)
    add_registry_args(parser)
    return parser.parse_args()


def _input_paths(args: argparse.Namespace) -> tuple[Path, Path, Path]:
    input_dir = resolve_workspace_path(args.input_dir)
    real_bom = resolve_workspace_path(args.real_bom) if args.real_bom else input_dir / "real_bom.json"
    layout_topology = (
        resolve_workspace_path(args.layout_topology)
        if args.layout_topology
        else input_dir / "layout_topology.json"
    )
    geom = resolve_workspace_path(args.geom) if args.geom else input_dir / "geom.json"
    return real_bom, layout_topology, geom


def _registry_inputs(
    args: argparse.Namespace,
    *,
    real_bom_path: Path,
    layout_topology_path: Path,
    geom_path: Path,
    output_dir: Path,
) -> dict[str, object]:
    return {
        "input_format": "real_bom_layout_topology_geom",
        "real_bom_path": str(real_bom_path),
        "layout_topology_path": str(layout_topology_path),
        "geom_path": str(geom_path),
        "output_dir": str(output_dir),
        "doc_name": args.doc_name,
        "rpc_host": args.host,
        "rpc_port": args.port,
        "view": args.view,
        "fit_view": not args.no_fit_view,
        "real_cad_backend": args.real_cad_backend,
        "max_step_size_mb": args.max_step_size_mb,
        "grid_shape": [int(value) for value in args.grid_shape],
    }


def main() -> None:
    args = parse_args()
    workspace_root = validate_workspace_root(args.workspace)
    configure_pipeline_logging(command="cad build", workspace=workspace_root)
    logger = get_pipeline_logger("cad_build")
    requested_doc_name = args.doc_name
    args.doc_name = resolve_doc_name(args.doc_name)
    logger.info("resolved document name: requested=%s active=%s", requested_doc_name, args.doc_name)
    real_bom_path, layout_topology_path, geom_path = _input_paths(args)
    logger.info("checking CAD inputs: real_bom=%s layout_topology=%s geom=%s", real_bom_path, layout_topology_path, geom_path)
    for path in (real_bom_path, layout_topology_path, geom_path):
        if not path.exists():
            logger.error("required input file not found: %s", path)
            raise FileNotFoundError(f"required input file not found: {path}")

    output_dir = resolve_workspace_path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    step_path = output_dir / "geometry_after.step"
    glb_path = output_dir / "geometry_after.glb"

    output_paths = {
        "step": step_path,
        "glb": glb_path,
        "real_cad_step": output_dir / "geometry_after_real_cad.step",
        "real_cad_glb": output_dir / "geometry_after_real_cad.glb",
        "real_cad_summary": output_dir / "geometry_after_real_cad.hybrid_summary.json",
        "geometry_after_layout_topology": output_dir / "geometry_after.layout_topology.json",
        "geometry_after_geom": output_dir / "geometry_after.geom.json",
        "geometry_after_registry": output_dir / "geometry_after_registry.json",
        "normalized_layout_dataset": output_dir / "normalized_layout_dataset.json",
        "simulation_input": output_dir / "simulation_input.json",
        "cad_agent_output": output_dir / "cad_agent_output.json",
        "comsol_coord": output_dir / "comsol_inputs" / "coord.txt",
        "comsol_channels_input": output_dir / "comsol_inputs" / "channels_input.npz",
    }
    registry_run = start_registry_run(
        args,
        tool="freecad-tools cad build",
        operation_type="cad_build_from_inputs",
        inputs=_registry_inputs(
            args,
            real_bom_path=real_bom_path,
            layout_topology_path=layout_topology_path,
            geom_path=geom_path,
            output_dir=output_dir,
        ),
    )

    try:
        with pipeline_step("cad_prepare_inputs"):
            logger.info("preparing normalized CAD inputs into %s", output_dir)
            prepared = build_cad_stage_inputs(
                real_bom_path=real_bom_path,
                layout_topology_path=layout_topology_path,
                geom_path=geom_path,
                output_dir=output_dir,
                step_filename=step_path.name,
                grid_shape=tuple(int(value) for value in args.grid_shape),
            )
        normalized_input_path = output_dir / "normalized_layout_dataset.json"
        normalized_input_path.write_text(
            json.dumps(prepared["normalized"], indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        logger.info("wrote normalized layout dataset: %s", normalized_input_path)
        code = render_rpc_script(
            "assembly_from_layout.py",
            {
                "__PLACEMENT_HELPERS__": PLACEMENT_HELPERS,
                "__COMPONENT_SHAPE_HELPERS__": COMPONENT_SHAPE_HELPERS,
                "__INPUT_PATH__": json.dumps(normalize_runtime_path(normalized_input_path)),
                "__DOC_NAME__": json.dumps(args.doc_name),
                "__SAVE_PATH__": json.dumps(normalize_runtime_path(step_path)),
                "__EXPORT_GLB__": "True",
                "__FIT_VIEW__": "False" if args.no_fit_view else "True",
                "__VIEW_NAME__": json.dumps(args.view),
            },
        )
        with pipeline_step("cad_freecad_export"):
            logger.info("executing FreeCAD assembly export: host=%s port=%s step=%s", args.host, args.port, step_path)
            payload = execute_script_payload(args.host, args.port, code)
            logger.info("FreeCAD export returned: success=%s error=%s", payload.get("success"), payload.get("error"))
        if payload.get("success"):
            payload["requested_doc_name"] = args.doc_name
            payload["explicit_doc_name"] = requested_doc_name
            payload["save_path"] = str(step_path)
            payload["glb_path"] = str(glb_path) if glb_path.exists() else None
            payload["placeholder_save_path"] = str(step_path)
            payload["placeholder_glb_path"] = str(glb_path) if glb_path.exists() else None

        real_cad_payload = None
        real_cad_step_path = output_paths["real_cad_step"]
        if payload.get("success") and args.real_cad_backend != "none":
            real_cad_doc_name = f"{args.doc_name}_RealCAD"
            staged_input_path, staged_output_path = stage_runtime_paths(
                Path("normalized_component_info_assembly.json"),
                real_cad_step_path,
                real_cad_doc_name,
            )
            with pipeline_step("cad_real_cad_prepare"):
                logger.info(
                    "normalizing supplemental real-CAD inputs: backend=%s output=%s",
                    args.real_cad_backend,
                    real_cad_step_path,
                )
                real_cad_normalized = load_and_normalize_component_info_assembly(
                    layout_topology_path=layout_topology_path,
                    geom_path=geom_path,
                    geom_component_info_path=None,
                    real_bom_path=real_bom_path,
                    max_step_size_mb=args.max_step_size_mb,
                )
                stage_input_data(real_cad_normalized, staged_input_path)
                stage_output_dir(staged_output_path)

            real_cad_code = render_rpc_script(
                "assembly_from_component_info.py",
                {
                    "__PLACEMENT_HELPERS__": PLACEMENT_HELPERS,
                    "__INPUT_PATH__": json.dumps(normalize_runtime_path(staged_input_path)),
                    "__DOC_NAME__": json.dumps(real_cad_doc_name),
                    "__SAVE_PATH__": json.dumps(normalize_runtime_path(staged_output_path)),
                    "__EXPORT_GLB__": "True",
                    "__FIT_VIEW__": "False" if args.no_fit_view else "True",
                    "__VIEW_NAME__": json.dumps(args.view),
                },
            )
            with pipeline_step("cad_real_cad_static_export"):
                logger.info(
                    "executing supplemental real-CAD static export: host=%s port=%s step=%s",
                    args.host,
                    args.port,
                    real_cad_step_path,
                )
                real_cad_payload = execute_script_payload(args.host, args.port, real_cad_code)
                logger.info(
                    "Supplemental real-CAD static export returned: success=%s error=%s",
                    real_cad_payload.get("success"),
                    real_cad_payload.get("error"),
                )

            if real_cad_payload.get("success") and args.real_cad_backend == "hybrid-link":
                hybrid_code = render_rpc_script(
                    "export_component_info_hybrid_link.py",
                    {
                        "__INPUT_PATH__": json.dumps(normalize_runtime_path(staged_input_path)),
                        "__DOC_NAME__": json.dumps(real_cad_doc_name),
                        "__SAVE_PATH__": json.dumps(normalize_runtime_path(staged_output_path)),
                        "__EXPORT_GLB__": "True",
                        "__INCLUDE_ENVELOPE__": "True",
                    },
                )
                with pipeline_step("cad_real_cad_hybrid_export"):
                    logger.info(
                        "executing supplemental real-CAD hybrid App::Link export: host=%s port=%s step=%s",
                        args.host,
                        args.port,
                        real_cad_step_path,
                    )
                    hybrid_payload = execute_script_payload(args.host, args.port, hybrid_code)
                    logger.info(
                        "Supplemental real-CAD hybrid export returned: success=%s error=%s",
                        hybrid_payload.get("success"),
                        hybrid_payload.get("error"),
                    )
                if hybrid_payload.get("success"):
                    real_cad_payload = {
                        **real_cad_payload,
                        "static_export": real_cad_payload,
                        **hybrid_payload,
                    }
                else:
                    real_cad_payload = hybrid_payload

            if real_cad_payload.get("success"):
                collect_runtime_exports(staged_output_path, real_cad_step_path)
                real_cad_payload["save_path"] = str(real_cad_step_path)
                real_cad_payload["glb_path"] = (
                    str(real_cad_step_path.with_suffix(".glb"))
                    if real_cad_step_path.with_suffix(".glb").exists()
                    else None
                )
                real_cad_payload["summary_path"] = (
                    str(real_cad_step_path.with_suffix(".hybrid_summary.json"))
                    if real_cad_step_path.with_suffix(".hybrid_summary.json").exists()
                    else None
                )
            else:
                logger.warning(
                    "supplemental real-CAD export failed, keeping placeholder CAD outputs for simulation: %s",
                    real_cad_payload.get("error") if isinstance(real_cad_payload, dict) else real_cad_payload,
                )

        step_exists = step_path.exists()
        glb_exists = glb_path.exists()
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
                "CAD_BUILD_FAILED",
                str(payload.get("error") or "FreeCAD CAD build failed."),
                details=payload,
            )
        logger.info("CAD build artifact status: status=%s step_exists=%s glb_exists=%s", registry_status, step_exists, glb_exists)

        payload.update(
            {
                "input_format": "real_bom_layout_topology_geom",
                "output_dir": str(output_dir),
                "simulation_input_path": str(output_paths["simulation_input"]),
                "cad_agent_output_path": str(output_paths["cad_agent_output"]),
                "comsol_coord_path": str(output_paths["comsol_coord"]),
                "comsol_channels_input_path": str(output_paths["comsol_channels_input"]),
                "geometry_after_registry_path": str(output_dir / "geometry_after_registry.json"),
                "geometry_after_geom_path": str(output_dir / "geometry_after.geom.json"),
                "geometry_after_layout_topology_path": str(
                    output_dir / "geometry_after.layout_topology.json"
                ),
                "cad_agent_output": prepared["cad_agent_output"],
                "real_cad_backend": args.real_cad_backend,
                "real_cad_output_path": str(real_cad_step_path) if real_cad_step_path.exists() else None,
                "real_cad_glb_path": (
                    str(real_cad_step_path.with_suffix(".glb"))
                    if real_cad_step_path.with_suffix(".glb").exists()
                    else None
                ),
                "real_cad_summary_path": (
                    str(real_cad_step_path.with_suffix(".hybrid_summary.json"))
                    if real_cad_step_path.with_suffix(".hybrid_summary.json").exists()
                    else None
                ),
                "real_cad_output": real_cad_payload,
            }
        )

        finalize_registry_run(
            registry_run,
            status=registry_status,
            outputs={name: str(path) for name, path in output_paths.items()},
            result=payload,
            error=registry_error,
            artifacts=[
                artifact_entry("real_bom", real_bom_path),
                artifact_entry("layout_topology", layout_topology_path),
                artifact_entry("geom", geom_path),
                artifact_entry("step", step_path),
                artifact_entry("glb", glb_path),
                artifact_entry("simulation_input", output_paths["simulation_input"]),
                artifact_entry("cad_agent_output", output_paths["cad_agent_output"]),
                artifact_entry("real_cad_step", output_paths["real_cad_step"]),
                artifact_entry("real_cad_glb", output_paths["real_cad_glb"]),
                artifact_entry("real_cad_summary", output_paths["real_cad_summary"]),
                artifact_entry("comsol_coord", output_paths["comsol_coord"]),
                artifact_entry("comsol_channels_input", output_paths["comsol_channels_input"]),
            ],
        )
        logger.info("CAD build registry finalized: status=%s output_dir=%s", registry_status, output_dir)
        print_json(payload)
        exit_on_failure(payload)
    except Exception as exc:
        logger.exception("CAD build failed: %s", exc)
        finalize_registry_run(
            registry_run,
            status="failed",
            outputs={name: str(path) for name, path in output_paths.items()},
            result={"success": False},
            error=build_error_payload("CAD_BUILD_EXCEPTION", str(exc)),
            artifacts=[artifact_entry(name, path) for name, path in output_paths.items()],
        )
        raise


if __name__ == "__main__":
    main()
