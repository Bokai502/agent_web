#!/usr/bin/env python3
"""Safely update a component placement inside a layout dataset."""

import argparse
import json
import sys
from pathlib import Path

from freecad_cli_tools import add_connection_args
from freecad_cli_tools.artifact_registry import (
    add_registry_args,
    artifact_entry,
    build_error_payload,
    finalize_registry_run,
    start_registry_run,
)
from freecad_cli_tools.cli_support import normalize_runtime_path
from freecad_cli_tools.freecad_sync import execute_batch_sync
from freecad_cli_tools.geometry import (
    FACE_DEFINITIONS,
    analyze_position,
    build_analysis_context,
    centered_face_position,
    component_local_extents,
    component_mount_face,
    component_solid_placement,
    constrain_position_to_envelope_face,
    envelope_face,
    find_best_safe_scale,
    get_face_data,
    is_external_face,
    orientation_rows_from_component,
    project_move_to_mount_plane,
    update_component_placement,
    vector_add,
    vector_scale,
)
from freecad_cli_tools.layout_dataset import (
    load_layout_dataset_files,
    normalize_layout_dataset,
    save_layout_dataset_files,
    update_layout_dataset_component_placement,
)
from freecad_cli_tools.doc_name import add_doc_name_arg, resolve_doc_name
from freecad_cli_tools.pipeline_logging import configure_pipeline_logging, get_pipeline_logger, pipeline_step
from freecad_cli_tools.runtime_config import (
    resolve_workspace_path,
)
from freecad_cli_tools.workspace import add_workspace_arg, validate_workspace_root


DEFAULT_SAFE_MOVE_INPUT_DIR = Path("00_inputs")
DEFAULT_SAFE_MOVE_OUTPUT_DIR = Path("01_cad")
GEOMETRY_AFTER_STEM = "geometry_after"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Move a component inside layout_topology.json + geom.json, detect "
            "collisions, write updated dataset files, and optionally sync the "
            "result to FreeCAD."
        )
    )
    parser.add_argument(
        "--layout-topology",
        help=(
            "Path to the source layout_topology.json file. Defaults to "
            "'./00_inputs/layout_topology.json' under the configured workspace root."
        ),
    )
    add_workspace_arg(parser)
    parser.add_argument(
        "--geom",
        help=(
            "Path to the source geom.json file. Defaults to "
            "'./00_inputs/geom.json' under the configured workspace root."
        ),
    )
    parser.add_argument(
        "--layout-topology-output",
        help=(
            "Optional output layout_topology.json path. Defaults to "
            "'./01_cad/geometry_after.layout_topology.json' under the "
            "configured workspace root."
        ),
    )
    parser.add_argument(
        "--geom-output",
        help=(
            "Optional output geom.json path. Defaults to "
            "'./01_cad/geometry_after.geom.json' under the configured "
            "workspace root."
        ),
    )
    parser.add_argument("--component", default="P001", help="Target component id to move.")
    parser.add_argument(
        "--move",
        nargs=3,
        type=float,
        metavar=("DX", "DY", "DZ"),
        default=(50.0, 50.0, 0.0),
        help="Requested movement vector.",
    )
    parser.add_argument(
        "--install-face",
        type=int,
        choices=sorted(FACE_DEFINITIONS.keys()),
        help=(
            "Optional target envelope face for reorientation. When supplied, the component is "
            "rotated so its own mount_face is installed onto the specified envelope face and "
            "placed at the center of that face."
        ),
    )
    parser.add_argument(
        "--sync-cad",
        action="store_true",
        default=True,
        help=(
            "Sync the component position into a FreeCAD document after writing dataset files. "
            "This is enabled by default."
        ),
    )
    parser.add_argument(
        "--no-sync-cad",
        dest="sync_cad",
        action="store_false",
        help="Only write dataset JSON files; do not update FreeCAD or export STEP/GLB.",
    )
    add_doc_name_arg(parser, help_text="FreeCAD document name to update.")
    parser.add_argument(
        "--step-output",
        help=(
            "STEP export path or directory to use after CAD sync. The exported "
            "STEP/GLB filenames are always 'geometry_after.step' and "
            "'geometry_after.glb'. Defaults to './01_cad' under the "
            "configured workspace root."
        ),
    )
    parser.add_argument(
        "--component-object",
        help="Exact FreeCAD solid object name for the component. Defaults to the component id.",
    )
    parser.add_argument(
        "--part-object",
        help=(
            "Exact FreeCAD container object name for the component. "
            "Defaults to '<component>_part'."
        ),
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help=(
            "Output format. 'text' preserves the existing key/value output; "
            "'json' prints the structured result payload."
        ),
    )
    add_connection_args(parser)
    add_registry_args(parser)
    return parser.parse_args()


def resolve_step_output_path(
    args: argparse.Namespace,
    layout_topology_output_path: Path,
) -> Path | None:
    """Resolve the STEP export path used for post-move CAD exports."""
    if not args.sync_cad:
        return None
    if args.step_output:
        return resolve_safe_move_step_path(args.step_output).resolve()
    return resolve_safe_move_step_path().resolve()


def resolve_safe_move_step_path(path: str | Path | None = None) -> Path:
    if path is None:
        return resolve_workspace_path(DEFAULT_SAFE_MOVE_OUTPUT_DIR) / f"{GEOMETRY_AFTER_STEM}.step"
    candidate = resolve_workspace_path(path)
    if candidate.suffix:
        return candidate.with_name(f"{GEOMETRY_AFTER_STEM}.step")
    return candidate / f"{GEOMETRY_AFTER_STEM}.step"


def default_safe_move_layout_topology_output_path() -> Path:
    return (
        resolve_workspace_path(DEFAULT_SAFE_MOVE_OUTPUT_DIR)
        / f"{GEOMETRY_AFTER_STEM}.layout_topology.json"
    )


def default_safe_move_geom_output_path() -> Path:
    return resolve_workspace_path(DEFAULT_SAFE_MOVE_OUTPUT_DIR) / f"{GEOMETRY_AFTER_STEM}.geom.json"


def sync_layout_result_to_cad(
    args: argparse.Namespace,
    layout_topology_output_path: Path,
    geom_output_path: Path,
    component_id: str,
    component: dict,
    source_component: dict | None = None,
) -> dict:
    if not args.sync_cad:
        return {"enabled": False, "success": False}
    export_step_path = resolve_step_output_path(args, layout_topology_output_path)

    position = [float(value) for value in component["placement"]["position"]]
    orientation_rows = orientation_rows_from_component(component)
    solid_position, solid_orientation_rows = component_solid_placement(
        component_id,
        component,
        position,
        orientation_rows,
    )
    source = source_component or component
    source_position = [float(value) for value in source["placement"]["position"]]
    source_orientation_rows = orientation_rows_from_component(source)
    solid_name = args.component_object or args.component
    part_name = args.part_object or f"{args.component}_part"
    try:
        payload = execute_batch_sync(
            args.host,
            args.port,
            args.doc_name,
            [
                {
                    "component": component_id,
                    "solid_name": solid_name,
                    "part_name": part_name,
                    "position": position,
                    "orientation_rows": orientation_rows,
                    "solid_position": solid_position,
                    "solid_orientation_rows": solid_orientation_rows,
                    "source_position": source_position,
                    "source_orientation_rows": source_orientation_rows,
                }
            ],
            recompute=False,
            export_step_path=(
                normalize_runtime_path(export_step_path) if export_step_path is not None else None
            ),
        )
    except SystemExit as exc:
        raise RuntimeError(
            f"cannot connect to FreeCAD RPC server at {args.host}:{args.port}"
        ) from exc
    payload["enabled"] = True
    payload["layout_topology_path"] = str(layout_topology_output_path)
    payload["geom_path"] = str(geom_output_path)
    if export_step_path is not None:
        payload["step_path"] = str(export_step_path)
        payload["glb_path"] = str(export_step_path.with_suffix(".glb"))
    return payload


def registry_inputs(
    args: argparse.Namespace,
    layout_topology_input_path: Path,
    geom_input_path: Path,
    layout_topology_output_path: Path,
    geom_output_path: Path,
) -> dict[str, object]:
    """Build the registry input payload for layout-dataset safe-move."""
    step_output_path = resolve_step_output_path(args, layout_topology_output_path)
    return {
        "input_layout_topology_path": str(layout_topology_input_path),
        "input_geom_path": str(geom_input_path),
        "output_layout_topology_path": str(layout_topology_output_path),
        "output_geom_path": str(geom_output_path),
        "step_output_path": str(step_output_path) if step_output_path else None,
        "glb_output_path": (
            str(step_output_path.with_suffix(".glb")) if step_output_path is not None else None
        ),
        "input_format": "layout_dataset",
        "component": args.component,
        "move": [float(value) for value in args.move],
        "install_face": args.install_face,
        "sync_cad": args.sync_cad,
        "doc_name": args.doc_name,
        "rpc_host": args.host,
        "rpc_port": args.port,
    }


def build_result_payload(
    *,
    success: bool,
    layout_topology_input_path: Path,
    geom_input_path: Path,
    layout_topology_output_path: Path,
    geom_output_path: Path,
    args: argparse.Namespace,
    component_contact_face: int,
    original_envelope_face: int,
    target_envelope_face: int,
    target_face_label: str,
    target_orientation_rows: list[list[float]],
    normal_component_ignored: list[float],
    original_position: list[float],
    start_position: list[float],
    move: list[float],
    effective_move: list[float],
    requested_position: list[float],
    requested_ok: bool,
    requested_blockers: list[str],
    solution_found: bool,
    applied_scale: float,
    applied_move: list[float],
    final_position: list[float],
    final_mount_point: list[float],
    final_blockers: list[str],
    cad_sync: dict,
    step_path: str | None,
    glb_path: str | None,
    step_exported: bool,
    glb_exported: bool,
) -> dict[str, object]:
    """Build a structured result payload for layout-dataset safe-move."""
    return {
        "success": success,
        "input_format": "layout_dataset",
        "input_layout_topology_path": str(layout_topology_input_path.resolve()),
        "input_geom_path": str(geom_input_path.resolve()),
        "output_layout_topology_path": str(layout_topology_output_path.resolve()),
        "output_geom_path": str(geom_output_path.resolve()),
        "step_path": step_path,
        "glb_path": glb_path,
        "step_exported": step_exported,
        "glb_exported": glb_exported,
        "target_component": args.component,
        "component_contact_face": component_contact_face,
        "component_contact_face_label": FACE_DEFINITIONS[component_contact_face][0],
        "original_envelope_face": original_envelope_face,
        "original_envelope_face_label": FACE_DEFINITIONS[original_envelope_face][0],
        "target_envelope_face": target_envelope_face,
        "target_envelope_face_label": target_face_label,
        "orientation_change_supported": True,
        "orientation_change_applied": args.install_face is not None,
        "orientation_rows": target_orientation_rows,
        "normal_move_component_ignored": normal_component_ignored,
        "original_position": original_position,
        "constrained_start_position": start_position,
        "requested_move": move,
        "effective_move": effective_move,
        "requested_position": requested_position,
        "requested_move_is_safe": requested_ok,
        "requested_blockers": requested_blockers,
        "solution_found_on_requested_segment": solution_found,
        "applied_scale": applied_scale,
        "applied_move": applied_move,
        "final_position": final_position,
        "final_mount_point": final_mount_point,
        "final_blockers": final_blockers,
        "cad_sync_enabled": args.sync_cad,
        "requested_doc_name": args.doc_name,
        "cad_sync_result": cad_sync,
    }


def emit_result_lines(payload: dict[str, object]) -> None:
    """Print the human-readable output for layout-dataset safe-move."""
    print(f"input_layout_topology_path: {payload['input_layout_topology_path']}")
    print(f"input_geom_path: {payload['input_geom_path']}")
    print(f"output_layout_topology_path: {payload['output_layout_topology_path']}")
    print(f"output_geom_path: {payload['output_geom_path']}")
    print(f"step_path: {payload['step_path']}")
    print(f"glb_path: {payload['glb_path']}")
    print(f"step_exported: {payload['step_exported']}")
    print(f"glb_exported: {payload['glb_exported']}")
    print(f"target_component: {payload['target_component']}")
    print(f"component_contact_face: {payload['component_contact_face']}")
    print(f"component_contact_face_label: {payload['component_contact_face_label']}")
    print(f"original_envelope_face: {payload['original_envelope_face']}")
    print("original_envelope_face_label: " f"{payload['original_envelope_face_label']}")
    print(f"target_envelope_face: {payload['target_envelope_face']}")
    print(f"target_envelope_face_label: {payload['target_envelope_face_label']}")
    print("orientation_change_supported: " f"{payload['orientation_change_supported']}")
    print("orientation_change_applied: " f"{payload['orientation_change_applied']}")
    print(f"orientation_rows: {payload['orientation_rows']}")
    print("normal_move_component_ignored: " f"{payload['normal_move_component_ignored']}")
    print(f"original_position: {payload['original_position']}")
    print("constrained_start_position: " f"{payload['constrained_start_position']}")
    print(f"requested_move: {payload['requested_move']}")
    print(f"effective_move: {payload['effective_move']}")
    print(f"requested_position: {payload['requested_position']}")
    print(f"requested_move_is_safe: {payload['requested_move_is_safe']}")
    print(f"requested_blockers: {payload['requested_blockers']}")
    print(
        "solution_found_on_requested_segment: " f"{payload['solution_found_on_requested_segment']}"
    )
    print(f"applied_scale: {float(payload['applied_scale']):.12f}")
    print(f"applied_move: {payload['applied_move']}")
    print(f"final_position: {payload['final_position']}")
    print(f"final_mount_point: {payload['final_mount_point']}")
    print(f"final_blockers: {payload['final_blockers']}")
    print(f"cad_sync_enabled: {payload['cad_sync_enabled']}")
    print(f"requested_doc_name: {payload['requested_doc_name']}")
    print("cad_sync_result: " f"{json.dumps(payload['cad_sync_result'], ensure_ascii=False)}")


def classify_cad_sync_result(
    cad_sync: dict,
) -> tuple[str, dict | None, str | None, str | None, bool, bool]:
    """Determine overall status from the CAD sync/export payload."""
    step_path = cad_sync.get("step_path")
    glb_path = cad_sync.get("glb_path")
    step_exists = bool(step_path) and Path(step_path).exists()
    glb_exists = bool(glb_path) and Path(glb_path).exists()

    if not cad_sync.get("enabled"):
        return "success", None, step_path, glb_path, step_exists, glb_exists

    if not cad_sync.get("success"):
        return (
            "partial_success",
            build_error_payload(
                "CAD_SYNC_FAILED",
                str(cad_sync.get("error") or "CAD sync did not complete successfully."),
                details=cad_sync,
            ),
            step_path,
            glb_path,
            step_exists,
            glb_exists,
        )

    if step_exists and glb_exists:
        return "success", None, step_path, glb_path, True, True

    if step_exists:
        return (
            "partial_success",
            build_error_payload(
                "GLB_EXPORT_INCOMPLETE",
                "STEP export succeeded but the expected GLB artifact was not found.",
                details=cad_sync,
            ),
            step_path,
            glb_path,
            True,
            False,
        )

    return (
        "partial_success",
        build_error_payload(
            "STEP_EXPORT_MISSING",
            "CAD sync completed but the expected STEP artifact was not found.",
            details=cad_sync,
        ),
        step_path,
        glb_path,
        False,
        glb_exists,
    )


def main() -> int:
    args = parse_args()
    workspace_root = validate_workspace_root(args.workspace)
    configure_pipeline_logging(command="layout safe-move", workspace=workspace_root)
    logger = get_pipeline_logger("layout_safe_move")
    args.doc_name = resolve_doc_name(args.doc_name)
    logger.info(
        "starting safe move: component=%s move=%s install_face=%s sync_cad=%s doc=%s",
        args.component,
        [float(value) for value in args.move],
        args.install_face,
        args.sync_cad,
        args.doc_name,
    )
    layout_topology_input_path = resolve_workspace_path(
        args.layout_topology or DEFAULT_SAFE_MOVE_INPUT_DIR / "layout_topology.json"
    )
    geom_input_path = resolve_workspace_path(args.geom or DEFAULT_SAFE_MOVE_INPUT_DIR / "geom.json")
    for input_path in (layout_topology_input_path, geom_input_path):
        if not input_path.exists():
            raise FileNotFoundError(f"required input file not found: {input_path}")
    layout_topology_output_path = resolve_workspace_path(
        args.layout_topology_output or default_safe_move_layout_topology_output_path()
    )
    geom_output_path = resolve_workspace_path(args.geom_output or default_safe_move_geom_output_path())
    if args.step_output and not args.sync_cad:
        raise ValueError("--step-output requires CAD sync; remove --no-sync-cad.")
    move = [float(value) for value in args.move]
    planned_step_output_path = resolve_step_output_path(args, layout_topology_output_path)
    output_paths = {
        "layout_topology": layout_topology_output_path,
        "geom": geom_output_path,
        "step": planned_step_output_path,
        "glb": (
            planned_step_output_path.with_suffix(".glb")
            if planned_step_output_path is not None
            else None
        ),
    }
    registry_run = start_registry_run(
        args,
        tool="freecad-layout-safe-move",
        operation_type="layout_dataset_safe_move",
        inputs=registry_inputs(
            args,
            layout_topology_input_path,
            geom_input_path,
            layout_topology_output_path,
            geom_output_path,
        ),
    )

    try:
        with pipeline_step("layout_load"):
            logger.info("loading layout dataset: layout=%s geom=%s", layout_topology_input_path, geom_input_path)
            layout_topology, geom = load_layout_dataset_files(
                layout_topology_input_path,
                geom_input_path,
            )
            data = normalize_layout_dataset(layout_topology, geom)
            logger.info("normalized layout dataset: components=%d", len(data.get("components", {})))
        components = data.get("components", {})
        if args.component not in components:
            available = ", ".join(sorted(components))
            logger.error("component not found: component=%s available=%s", args.component, available)
            raise KeyError(
                f"Component {args.component} not found. Available components: {available}"
            )

        target = components[args.component]
        component_contact_face = component_mount_face(target)
        target_extents = component_local_extents(args.component, target)
        original_envelope_face = envelope_face(target)
        target_envelope_face = (
            args.install_face if args.install_face is not None else original_envelope_face
        )
        _, target_face_label, target_axis, _ = get_face_data(target_envelope_face)

        if is_external_face(target_envelope_face):
            outer_size = data["envelope"].get("outer_size")
            if outer_size is None:
                raise ValueError(
                    f"envelope.outer_size is required to install a component on external face "
                    f"{target_envelope_face}."
                )
            wall_size = list(outer_size)
        else:
            wall_size = list(data["envelope"]["inner_size"])

        target_orientation_rows = orientation_rows_from_component(target)
        if args.install_face is not None:
            base_position, _, target_orientation_rows = centered_face_position(
                target_extents,
                wall_size,
                component_contact_face,
                target_envelope_face,
            )
            start_position = constrain_position_to_envelope_face(
                base_position,
                target_extents,
                wall_size,
                target_envelope_face,
                target_orientation_rows,
            )
        else:
            start_position = constrain_position_to_envelope_face(
                target["placement"]["position"],
                target_extents,
                wall_size,
                target_envelope_face,
                target_orientation_rows,
            )

        effective_move, normal_component_ignored = project_move_to_mount_plane(move, target_axis)
        analysis_context = build_analysis_context(
            data,
            args.component,
            target_orientation_rows,
            check_envelope=not is_external_face(target_envelope_face),
            envelope_face_id=target_envelope_face,
            wall_size=wall_size,
        )
        requested_position = vector_add(start_position, effective_move)
        with pipeline_step("layout_analyze"):
            logger.info("analyzing requested placement: requested_position=%s effective_move=%s", requested_position, effective_move)
            requested_ok, requested_blockers = analyze_position(
                analysis_context, requested_position, target_orientation_rows
            )
            logger.info("requested placement result: ok=%s blockers=%s", requested_ok, requested_blockers)

        solution_found = True
        if requested_ok:
            applied_scale = 1.0
            applied_move = effective_move
            final_position = requested_position
        else:
            with pipeline_step("layout_safe_scale"):
                logger.info("searching safe scale for move")
                best_scale = find_best_safe_scale(
                    analysis_context,
                    start_position,
                    effective_move,
                    target_orientation_rows,
                )
            if best_scale is None:
                solution_found = False
                applied_scale = 0.0
                applied_move = [0.0, 0.0, 0.0]
                final_position = start_position
            else:
                applied_scale = best_scale
                applied_move = vector_scale(effective_move, applied_scale)
                final_position = vector_add(start_position, applied_move)

        final_ok, final_blockers = analyze_position(
            analysis_context, final_position, target_orientation_rows
        )
        logger.info(
            "final placement result: solution_found=%s final_ok=%s applied_scale=%s final_position=%s blockers=%s",
            solution_found,
            final_ok,
            applied_scale,
            final_position,
            final_blockers,
        )
        if solution_found and not final_ok:
            raise RuntimeError(
                f"Failed to find a collision-free position for {args.component}. "
                f"Blockers: {final_blockers}"
            )

        updated = update_component_placement(
            data,
            args.component,
            final_position,
            target_envelope_face,
            rotation_matrix=target_orientation_rows,
        )
        updated_layout_topology, updated_geom = update_layout_dataset_component_placement(
            layout_topology,
            geom,
            args.component,
            updated["components"][args.component],
        )
        with pipeline_step("layout_write"):
            save_layout_dataset_files(
                layout_topology_output_path,
                updated_layout_topology,
                geom_output_path,
                updated_geom,
            )
            logger.info("wrote updated layout dataset: layout=%s geom=%s", layout_topology_output_path, geom_output_path)
        try:
            with pipeline_step("layout_cad_sync"):
                logger.info("syncing layout result to FreeCAD")
                cad_sync = sync_layout_result_to_cad(
                    args,
                    layout_topology_output_path,
                    geom_output_path,
                    args.component,
                    updated["components"][args.component],
                    source_component=target,
                )
                logger.info("FreeCAD sync finished: success=%s step=%s glb=%s", cad_sync.get("success"), cad_sync.get("step_path"), cad_sync.get("glb_path"))
        except Exception as exc:
            logger.exception("FreeCAD sync failed: %s", exc)
            cad_sync = {
                "enabled": True,
                "success": False,
                "error": str(exc),
                "document": args.doc_name,
                "component": args.component,
            }

        (
            registry_status,
            registry_error,
            step_path,
            glb_path,
            step_exists,
            glb_exists,
        ) = classify_cad_sync_result(cad_sync)
        logger.info("safe move artifact status: status=%s step_exists=%s glb_exists=%s", registry_status, step_exists, glb_exists)
        payload = build_result_payload(
            success=registry_status == "success",
            layout_topology_input_path=layout_topology_input_path,
            geom_input_path=geom_input_path,
            layout_topology_output_path=layout_topology_output_path,
            geom_output_path=geom_output_path,
            args=args,
            component_contact_face=component_contact_face,
            original_envelope_face=original_envelope_face,
            target_envelope_face=target_envelope_face,
            target_face_label=target_face_label,
            target_orientation_rows=target_orientation_rows,
            normal_component_ignored=normal_component_ignored,
            original_position=list(target["placement"]["position"]),
            start_position=start_position,
            move=move,
            effective_move=effective_move,
            requested_position=requested_position,
            requested_ok=requested_ok,
            requested_blockers=requested_blockers,
            solution_found=solution_found,
            applied_scale=applied_scale,
            applied_move=applied_move,
            final_position=final_position,
            final_mount_point=updated["components"][args.component]["placement"]["mount_point"],
            final_blockers=final_blockers,
            cad_sync=cad_sync,
            step_path=step_path,
            glb_path=glb_path,
            step_exported=step_exists,
            glb_exported=glb_exists,
        )
        finalize_registry_run(
            registry_run,
            status=registry_status,
            outputs={
                "layout_topology_path": str(layout_topology_output_path),
                "geom_path": str(geom_output_path),
                "step_path": step_path,
                "glb_path": glb_path,
            },
            result=payload,
            error=registry_error,
            artifacts=[
                artifact_entry("input_layout_topology", layout_topology_input_path),
                artifact_entry("input_geom", geom_input_path),
                artifact_entry("output_layout_topology", layout_topology_output_path),
                artifact_entry("output_geom", geom_output_path),
                artifact_entry("step", step_path),
                artifact_entry("glb", glb_path),
            ],
        )
        logger.info("safe move registry finalized: status=%s", registry_status)
        if args.format == "json":
            print(json.dumps(payload, indent=2, ensure_ascii=False))
        else:
            emit_result_lines(payload)
        return 2 if registry_status == "partial_success" else 0
    except Exception as exc:
        logger.exception("safe move failed: %s", exc)
        finalize_registry_run(
            registry_run,
            status="failed",
            outputs={
                "layout_topology_path": str(layout_topology_output_path),
                "geom_path": str(geom_output_path),
            },
            result={"success": False},
            error=build_error_payload("LAYOUT_DATASET_SAFE_MOVE_EXCEPTION", str(exc)),
            artifacts=[
                artifact_entry("input_layout_topology", layout_topology_input_path),
                artifact_entry("input_geom", geom_input_path),
                artifact_entry("output_layout_topology", layout_topology_output_path),
                artifact_entry("output_geom", geom_output_path),
            ],
        )
        raise


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
