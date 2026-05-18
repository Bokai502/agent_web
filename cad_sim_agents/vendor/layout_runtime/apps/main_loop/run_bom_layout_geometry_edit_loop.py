from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any, Mapping

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from apps.main_loop.run_bom_layout_batch import run_bom_layout_batch
from core.io import read_json, write_json
from local_defaults import BOM_DIR as DEFAULT_BOM_DIR, LAYOUT3DCUBE_ROOT, LAYOUT_DIST_YAML, WORKSPACE_DIR as DEFAULT_WORKSPACE_DIR, THERMAL_DB
from pipeline.geometry_edit.validate import run_stage as run_geometry_edit


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Rerun 01_layout for a module_db BOM batch, then run a simple "
            "02_geometry_edit loop test for each generated case."
        )
    )
    parser.add_argument("--bom-dir", type=Path, default=DEFAULT_BOM_DIR)
    parser.add_argument("--workspace-dir", type=Path, default=DEFAULT_WORKSPACE_DIR)
    parser.add_argument("--layout3dcube-root", type=Path, default=LAYOUT3DCUBE_ROOT)
    parser.add_argument("--dist-yaml", type=Path, default=LAYOUT_DIST_YAML)
    parser.add_argument("--thermal-db", type=Path, default=THERMAL_DB)
    parser.add_argument("--sample-id-start", type=int, default=920001)
    parser.add_argument("--clearance-mm", type=float, default=3.0)
    parser.add_argument("--multistart", type=int, default=3)
    parser.add_argument("--target-fill-ratio", type=float, default=0.42)
    parser.add_argument("--move-mm", type=float, default=3.0)
    parser.add_argument("--max-actions-per-case", type=int, default=1)
    parser.add_argument("--output-dir-name", default=None)
    parser.add_argument("--max-cases", type=int, default=None)
    parser.add_argument(
        "--skip-layout",
        action="store_true",
        help="Reuse existing 01_layout outputs instead of regenerating them.",
    )
    parser.add_argument(
        "--sync-cad-limit",
        type=int,
        default=0,
        help=(
            "Number of successful cases to run with FreeCAD RPC STEP sync. "
            "Default 0 keeps the 50-case loop fast and dataset-only."
        ),
    )
    parser.add_argument(
        "--rebuild-cad-after-edit-limit",
        type=int,
        default=0,
        help=(
            "Number of geometry-edit cases to rebuild as real FreeCAD placeholder CAD "
            "from geometry_after.layout_topology.json + geometry_after.geom.json. "
            "Default 0 keeps runs dataset-only."
        ),
    )
    parser.add_argument("--workspace-dir", type=Path, default=None)
    parser.add_argument("--doc-name", default="LayoutAssembly")
    parser.add_argument("--timeout-seconds", type=int, default=600)
    parser.add_argument(
        "--no-skip-geometry-edit-without-unplaced",
        action="store_true",
        help=(
            "Run 02_geometry_edit even when 01_layout has no unplaced components. "
            "By default such cases are skipped."
        ),
    )
    args = parser.parse_args(argv)

    summary = run_bom_layout_geometry_edit_loop(
        bom_dir=args.bom_dir,
        run_root=args.workspace_dir,
        layout3dcube_root=args.layout3dcube_root,
        dist_yaml=args.dist_yaml,
        thermal_db=args.thermal_db,
        sample_id_start=args.sample_id_start,
        clearance_mm=args.clearance_mm,
        multistart=args.multistart,
        target_fill_ratio=args.target_fill_ratio,
        move_mm=args.move_mm,
        max_actions_per_case=args.max_actions_per_case,
        output_dir_name=args.output_dir_name,
        max_cases=args.max_cases,
        rerun_layout=not args.skip_layout,
        sync_cad_limit=args.sync_cad_limit,
        rebuild_cad_after_edit_limit=args.rebuild_cad_after_edit_limit,
        workspace_dir=args.workspace_dir,
        doc_name=args.doc_name,
        timeout_seconds=args.timeout_seconds,
        skip_geometry_edit_without_unplaced=not args.no_skip_geometry_edit_without_unplaced,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["ok"] else 1


def run_bom_layout_geometry_edit_loop(
    *,
    bom_dir: Path,
    run_root: Path,
    layout3dcube_root: Path,
    dist_yaml: Path,
    thermal_db: Path,
    sample_id_start: int,
    clearance_mm: float,
    multistart: int,
    target_fill_ratio: float,
    move_mm: float,
    max_actions_per_case: int = 1,
    output_dir_name: str | None = None,
    max_cases: int | None = None,
    rerun_layout: bool = True,
    sync_cad_limit: int = 0,
    rebuild_cad_after_edit_limit: int = 0,
    workspace_dir: Path | None = None,
    doc_name: str = "LayoutAssembly",
    timeout_seconds: int = 600,
    skip_geometry_edit_without_unplaced: bool = True,
) -> dict[str, Any]:
    run_root = Path(run_root)
    run_root.mkdir(parents=True, exist_ok=True)

    if rerun_layout:
        layout_manifest = run_bom_layout_batch(
            bom_dir=Path(bom_dir),
            run_root=run_root,
            layout3dcube_root=Path(layout3dcube_root),
            dist_yaml=Path(dist_yaml),
            sample_id_start=sample_id_start,
            clearance_mm=clearance_mm,
            multistart=multistart,
            target_fill_ratio=target_fill_ratio,
            thermal_db=Path(thermal_db),
            max_boms=max_cases,
        )
    else:
        layout_manifest_path = run_root / "batch_layout_manifest.json"
        if not layout_manifest_path.exists():
            raise FileNotFoundError(f"missing layout manifest: {layout_manifest_path}")
        layout_manifest = read_json(layout_manifest_path)

    layout_results = list(layout_manifest.get("results") or [])
    if max_cases is not None:
        layout_results = layout_results[: max(0, max_cases)]

    edit_results: list[dict[str, Any]] = []
    sync_cad_used = 0
    rebuild_cad_after_edit_used = 0
    resolved_output_dir_name = output_dir_name or "02_geometry_edit_loop_test"
    for index, layout_result in enumerate(layout_results):
        run_dir = Path(str(layout_result.get("run_dir") or ""))
        if not run_dir:
            continue
        unplaced_path = run_dir / "01_layout" / "unplaced_components.json"
        skip_no_unplaced = (
            skip_geometry_edit_without_unplaced
            and unplaced_path.exists()
            and not _has_unplaced_components(unplaced_path)
        )
        sync_cad = (
            not skip_no_unplaced
            and bool(layout_result.get("ok"))
            and sync_cad_used < max(0, sync_cad_limit)
        )
        if sync_cad:
            sync_cad_used += 1
        rebuild_cad_after_edit = (
            not skip_no_unplaced
            and rebuild_cad_after_edit_used < max(0, rebuild_cad_after_edit_limit)
        )
        if rebuild_cad_after_edit:
            rebuild_cad_after_edit_used += 1
        edit_results.append(
            _run_one_geometry_edit_loop_test(
                run_dir=run_dir,
                layout_result=layout_result,
                case_index=index,
                move_mm=move_mm,
                max_actions_per_case=max_actions_per_case,
                output_dir_name=resolved_output_dir_name,
                sync_cad=sync_cad,
                rebuild_cad_after_edit=rebuild_cad_after_edit,
                workspace_dir=workspace_dir,
                doc_name=doc_name,
                timeout_seconds=timeout_seconds,
                source_bom_path=Path(str(layout_result.get("bom"))) if layout_result.get("bom") else None,
                layout3dcube_root=layout3dcube_root,
                dist_yaml=dist_yaml,
                thermal_db=thermal_db,
                sample_id=str(layout_result.get("sample_id") or sample_id_start + index),
                seed=int(layout_result.get("seed") or layout_result.get("sample_id") or sample_id_start + index),
                clearance_mm=clearance_mm,
                multistart=multistart,
                target_fill_ratio=target_fill_ratio,
                skip_geometry_edit_without_unplaced=skip_geometry_edit_without_unplaced,
            )
        )

    summary = {
        "schema_version": "1.0",
        "ok": all(
            item.get("geometry_edit_status") in {"completed", "skipped"}
            for item in edit_results
        ),
        "all_layouts_ok": bool(layout_manifest.get("ok")),
        "bom_dir": str(bom_dir),
        "run_root": str(run_root),
        "rerun_layout": rerun_layout,
        "planner_mode": "loop_test",
        "output_dir_name": resolved_output_dir_name,
        "layout_manifest": "batch_layout_manifest.json",
        "total_cases": len(edit_results),
        "layout_completed": sum(1 for item in layout_results if item.get("ok")),
        "layout_failed": sum(1 for item in layout_results if not item.get("ok")),
        "geometry_edit_completed": sum(1 for item in edit_results if item.get("geometry_edit_status") == "completed"),
        "geometry_edit_skipped": sum(1 for item in edit_results if item.get("geometry_edit_status") == "skipped"),
        "geometry_edit_failed": sum(
            1
            for item in edit_results
            if item.get("geometry_edit_status") not in {"completed", "skipped"}
        ),
        "geometry_changed": sum(1 for item in edit_results if item.get("geometry_changed")),
        "step_file_changed": sum(1 for item in edit_results if item.get("step_file_changed")),
        "cad_synced": sum(1 for item in edit_results if item.get("cad_synced")),
        "cad_rebuilt": sum(1 for item in edit_results if item.get("cad_rebuilt")),
        "step_from_relayout": sum(1 for item in edit_results if item.get("step_from_relayout")),
        "relayout_success": sum(1 for item in edit_results if item.get("relayout_success") is True),
        "relayout_failed": sum(1 for item in edit_results if item.get("relayout_success") is False),
        "step_copied_from_source": sum(1 for item in edit_results if item.get("step_copied_from_source")),
        "planner_action_count": sum(int(item.get("action_count", 0)) for item in edit_results),
        "planner_target_count": sum(int(item.get("target_count", 0)) for item in edit_results),
        "planner_unresolved_count": sum(int(item.get("unresolved_count", 0)) for item in edit_results),
        "bad_executed_actions": sum(int(item.get("bad_executed_actions", 0)) for item in edit_results),
        "planner_execution_ok": sum(1 for item in edit_results if item.get("planner_execution_ok")),
        "planner_execution_failed": sum(
            1
            for item in edit_results
            if item.get("geometry_edit_status") == "completed"
            and not item.get("planner_execution_ok")
        ),
        "safe_move_clipped": sum(
            1
            for item in edit_results
            if item.get("geometry_edit_status") == "completed" and item.get("requested_move_is_safe") is False
        ),
        "sync_cad_limit": sync_cad_limit,
        "rebuild_cad_after_edit_limit": rebuild_cad_after_edit_limit,
        "skip_geometry_edit_without_unplaced": skip_geometry_edit_without_unplaced,
        "results": edit_results,
    }
    write_json(run_root / "batch_layout_geometry_edit_loop_manifest.json", summary)
    return summary


def _run_one_geometry_edit_loop_test(
    *,
    run_dir: Path,
    layout_result: Mapping[str, Any],
    case_index: int,
    move_mm: float,
    max_actions_per_case: int,
    output_dir_name: str,
    sync_cad: bool,
    rebuild_cad_after_edit: bool,
    workspace_dir: Path | None,
    doc_name: str,
    timeout_seconds: int,
    source_bom_path: Path | None,
    layout3dcube_root: Path,
    dist_yaml: Path,
    thermal_db: Path,
    sample_id: str,
    seed: int,
    clearance_mm: float,
    multistart: int,
    target_fill_ratio: float,
    skip_geometry_edit_without_unplaced: bool,
) -> dict[str, Any]:
    output_dir = run_dir / output_dir_name
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    layout_dir = run_dir / "01_layout"
    try:
        unplaced_path = layout_dir / "unplaced_components.json"
        if (
            skip_geometry_edit_without_unplaced
            and unplaced_path.exists()
            and not _has_unplaced_components(unplaced_path)
        ):
            case_result = _skipped_geometry_edit_result(
                run_dir=run_dir,
                output_dir=output_dir,
                layout_result=layout_result,
                unplaced_path=unplaced_path,
            )
            write_json(output_dir / "loop_case_result.json", case_result)
            return case_result

        required_paths = [
            layout_dir / "geom.json",
            layout_dir / "geometry_registry.json",
            layout_dir / "layout_topology.json",
            run_dir / "00_inputs" / "components.json",
        ]
        missing = [str(path) for path in required_paths if not path.exists()]
        if missing:
            raise FileNotFoundError("missing required 01/00 outputs: " + ", ".join(missing))
        geom = read_json(layout_dir / "geom.json")
        registry = read_json(layout_dir / "geometry_registry.json")
        topology = read_json(layout_dir / "layout_topology.json")
        components = read_json(run_dir / "00_inputs" / "components.json")
        edit_plan = _plan_geometry_edit(
            geom=geom,
            registry=registry,
            topology=topology,
            case_index=case_index,
            move_mm=move_mm,
        )
        placed_components_path = layout_dir / "placed_components.json"
        geometry_edit_components_path = (
            placed_components_path
            if placed_components_path.exists()
            else run_dir / "00_inputs" / "components.json"
        )
        config: dict[str, Any] = {
            "validation_backend": "freecad_skill_cli",
            "components_path": geometry_edit_components_path,
            "edit_plan": edit_plan,
            "sync_cad": sync_cad,
            "rebuild_cad_after_edit": rebuild_cad_after_edit,
            "doc_name": doc_name,
            "timeout_seconds": timeout_seconds,
            "source_bom_path": str(source_bom_path.resolve()) if source_bom_path else None,
            "layout3dcube_root": str(Path(layout3dcube_root).resolve()),
            "dist_yaml": str(Path(dist_yaml).resolve()),
            "thermal_db": str(Path(thermal_db).resolve()),
            "sample_id": sample_id,
            "seed": seed,
            "clearance_mm": clearance_mm,
            "multistart": multistart,
            "target_fill_ratio": target_fill_ratio,
        }
        if workspace_dir is not None:
            config["workspace_dir"] = str(Path(workspace_dir).resolve())

        stage_result = run_geometry_edit(layout_dir, output_dir, config)
        delta = read_json(output_dir / "geometry_delta_summary.json") if (output_dir / "geometry_delta_summary.json").exists() else {}
        edit_result = read_json(output_dir / "geometry_edit_result.json") if (output_dir / "geometry_edit_result.json").exists() else {}
        skill_result = read_json(output_dir / "freecad_skill_cli_result.json") if (output_dir / "freecad_skill_cli_result.json").exists() else {}
        relayout_result = read_json(output_dir / "relayout_result.json") if (output_dir / "relayout_result.json").exists() else {}
        if relayout_result:
            skill_result = {**dict(skill_result), "relayout_result_data": relayout_result}
        execution_report = _build_planner_execution_report(
            edit_plan=edit_plan,
            stage_status=stage_result.status,
            delta=delta,
            edit_result=edit_result,
            skill_result=skill_result,
            sync_cad_requested=sync_cad,
        )
        execution_report_path = write_json(output_dir / "planner_execution_report.json", execution_report)
        case_result = {
            "ok": stage_result.status == "completed",
            "run_dir": str(run_dir),
            "layout_ok": bool(layout_result.get("ok")),
            "layout_error": layout_result.get("error"),
            "geometry_edit_dir": str(output_dir),
            "geometry_edit_status": stage_result.status,
            "planner_mode": "loop_test",
            "action_count": len(edit_plan.get("actions") or []),
            "target_count": len(edit_plan.get("targets") or []),
            "unresolved_count": len(edit_plan.get("unresolved_components") or []),
            "actions_brief": execution_report["actions_brief"],
            "target_component_id": execution_report["actions_brief"][0]["component_id"] if execution_report["actions_brief"] else None,
            "target_semantic_name": execution_report["actions_brief"][0].get("semantic_name") if execution_report["actions_brief"] else None,
            "requested_delta_mm": execution_report["actions_brief"][0].get("requested_delta_mm") if execution_report["actions_brief"] else None,
            "planner_execution_ok": execution_report["summary"]["ok"],
            "planner_execution_status": execution_report["summary"]["status"],
            "covered_missing_count": execution_report["summary"].get("covered_missing_count"),
            "unresolved_missing_count": execution_report["summary"].get("unresolved_missing_count"),
            "bad_executed_actions": execution_report["summary"].get("bad_executed_actions", 0),
            "actual_delta_mm": execution_report["actions_brief"][0].get("actual_delta_mm") if execution_report["actions_brief"] else None,
            "applied_move_mm": execution_report["actions_brief"][0].get("applied_move_mm") if execution_report["actions_brief"] else None,
            "requested_move_is_safe": execution_report["actions_brief"][0].get("requested_move_is_safe") if execution_report["actions_brief"] else None,
            "requested_blockers": execution_report["actions_brief"][0].get("requested_blockers") if execution_report["actions_brief"] else [],
            "geometry_changed": bool(delta.get("geometry_changed")),
            "step_file_changed": bool(delta.get("step_file_changed")),
            "changed_component_count": int((delta.get("summary") or {}).get("changed_component_count", 0)),
            "moved_component_count": int((delta.get("summary") or {}).get("moved_component_count", 0)),
            "added_component_count": int((delta.get("summary") or {}).get("added_component_count", 0)),
            "deleted_component_count": int((delta.get("summary") or {}).get("deleted_component_count", 0)),
            "cad_synced": bool(edit_result.get("cad_synced")),
            "cad_rebuilt": bool(edit_result.get("cad_rebuilt")),
            "geometry_after_glb": edit_result.get("geometry_after_glb"),
            "step_from_relayout": bool(edit_result.get("step_from_relayout")),
            "step_copied_from_source": bool(edit_result.get("step_copied_from_source")),
            "relayout_success": bool(relayout_result.get("relayout_success")) if relayout_result else None,
            "relayout_n_unplaced": relayout_result.get("relayout_n_unplaced") if relayout_result else None,
            "relayout_result": str(output_dir / "relayout_result.json") if relayout_result else None,
            "stage_result": str(output_dir / "geometry_edit_stage_result.json"),
            "planner_execution_report": str(execution_report_path),
            "delta_summary": str(output_dir / "geometry_delta_summary.json"),
            "geometry_after_registry": str(output_dir / "geometry_after_registry.json"),
            "warnings": list(stage_result.warnings),
            "errors": list(stage_result.errors),
        }
        write_json(output_dir / "geometry_edit_stage_result.json", stage_result.to_dict())
        write_json(output_dir / "loop_case_result.json", case_result)
        return case_result
    except Exception as exc:
        result = {
            "ok": False,
            "run_dir": str(run_dir),
            "layout_ok": bool(layout_result.get("ok")),
            "layout_error": layout_result.get("error"),
            "geometry_edit_dir": str(output_dir),
            "geometry_edit_status": "failed",
            "error": f"{type(exc).__name__}: {exc}",
        }
        write_json(output_dir / "loop_case_result.json", result)
        return result


def _has_unplaced_components(unplaced_path: Path) -> bool:
    if not unplaced_path.exists():
        return False
    data = read_json(unplaced_path)
    components = data.get("components") if isinstance(data, Mapping) else None
    if isinstance(components, list):
        return len(components) > 0
    summary = data.get("summary") if isinstance(data, Mapping) else None
    if isinstance(summary, Mapping):
        return int(summary.get("unplaced_components", 0) or 0) > 0
    return False


def _skipped_geometry_edit_result(
    *,
    run_dir: Path,
    output_dir: Path,
    layout_result: Mapping[str, Any],
    unplaced_path: Path,
) -> dict[str, Any]:
    skip_report = {
        "schema_version": "1.0",
        "status": "skipped",
        "reason": "no_unplaced_components",
        "policy": "skip_geometry_edit_without_unplaced",
        "unplaced_components": str(unplaced_path),
        "note": "02_geometry_edit was not run because 01_layout placed all components.",
    }
    write_json(output_dir / "geometry_edit_skip_report.json", skip_report)
    return {
        "ok": True,
        "run_dir": str(run_dir),
        "layout_ok": bool(layout_result.get("ok")),
        "layout_error": layout_result.get("error"),
        "geometry_edit_dir": str(output_dir),
        "geometry_edit_status": "skipped",
        "skip_reason": "no_unplaced_components",
        "planner_mode": "loop_test",
        "action_count": 0,
        "target_count": 0,
        "unresolved_count": 0,
        "actions_brief": [],
        "target_component_id": None,
        "target_semantic_name": None,
        "requested_delta_mm": None,
        "planner_execution_ok": True,
        "planner_execution_status": "skipped_no_unplaced_components",
        "covered_missing_count": 0,
        "unresolved_missing_count": 0,
        "bad_executed_actions": 0,
        "actual_delta_mm": None,
        "applied_move_mm": None,
        "requested_move_is_safe": None,
        "requested_blockers": [],
        "geometry_changed": False,
        "step_file_changed": False,
        "changed_component_count": 0,
        "moved_component_count": 0,
        "added_component_count": 0,
        "deleted_component_count": 0,
        "cad_synced": False,
        "cad_rebuilt": False,
        "step_copied_from_source": False,
        "skip_report": str(output_dir / "geometry_edit_skip_report.json"),
        "warnings": [],
        "errors": [],
    }


def _plan_geometry_edit(
    *,
    geom: Mapping[str, Any],
    registry: Mapping[str, Any],
    topology: Mapping[str, Any],
    case_index: int,
    move_mm: float,
) -> dict[str, Any]:
    action = _plan_simple_safe_move(geom, registry, topology, move_mm=move_mm)
    return {
        "schema_version": "1.0",
        "planner": "simple_batch_geometry_edit_loop",
        "planner_mode": "loop_test",
        "case_index": case_index,
        "intent": "exercise 02_geometry_edit with a small safe component move",
        "actions": [action],
    }


def _plan_simple_safe_move(
    geom: Mapping[str, Any],
    registry: Mapping[str, Any],
    topology: Mapping[str, Any],
    *,
    move_mm: float,
    excluded_component_ids: set[str] | None = None,
    planner: str = "simple_batch_geometry_edit_loop",
    request: str | None = None,
    intent: str = "exercise 02_geometry_edit with a small safe component move",
) -> dict[str, Any]:
    excluded_component_ids = excluded_component_ids or set()
    inner_bbox = _inner_bbox_from_geom(geom)
    normal_axis_by_component = _placement_normal_axes(topology)
    candidates = []
    for entity in registry.get("entities", []):
        if not isinstance(entity, Mapping):
            continue
        component_id = str(entity.get("component_id") or "").strip()
        if not component_id:
            continue
        if component_id in excluded_component_ids:
            continue
        bbox = _bbox(entity.get("bbox"))
        size = [bbox["max"][axis] - bbox["min"][axis] for axis in range(3)]
        if min(size) <= 0.0:
            continue
        normal_axis = normal_axis_by_component.get(component_id)
        allowed_axes = [axis for axis in range(3) if axis != normal_axis]
        if not allowed_axes:
            allowed_axes = [0, 1, 2]
        best_axis = allowed_axes[0]
        best_sign = 1.0
        best_clearance = -1.0
        for axis in allowed_axes:
            positive_clearance = inner_bbox["max"][axis] - bbox["max"][axis]
            negative_clearance = bbox["min"][axis] - inner_bbox["min"][axis]
            if positive_clearance > best_clearance:
                best_axis = axis
                best_sign = 1.0
                best_clearance = positive_clearance
            if negative_clearance > best_clearance:
                best_axis = axis
                best_sign = -1.0
                best_clearance = negative_clearance
        kind_priority = 1 if component_id.startswith("P") else 0
        candidates.append((kind_priority, best_clearance, max(size), best_axis, best_sign, entity))

    if not candidates:
        raise RuntimeError("no component entity with component_id and valid bbox found")

    candidates.sort(key=lambda item: (item[0], item[1], -item[2]), reverse=True)
    _kind_priority, best_clearance, _size_score, axis, sign, entity = candidates[0]
    requested = max(0.1, min(float(move_mm), max(0.1, best_clearance * 0.5)))
    delta = [0.0, 0.0, 0.0]
    delta[axis] = round(sign * requested, 6)
    return {
        "type": "move_component",
        "component_id": entity["component_id"],
        "semantic_name": entity.get("semantic_name"),
        "delta_mm": delta,
        "selection_policy": {
            "planner": planner,
            "operation": "move_component",
            "candidate_filter": "valid geometry_registry component bbox; prefer internal P* components",
            "axis_policy": "choose largest free clearance axis excluding mount normal axis",
            "requested_move_limit_mm": float(move_mm),
            "selected_axis": axis,
            "selected_sign": int(sign),
            "available_clearance_mm": round(best_clearance, 6),
            "intent": intent,
            "source_request": request,
        },
        "reason": (
            "selected component with largest one-axis bbox clearance; "
            f"axis={axis}, clearance_mm={round(best_clearance, 6)}"
        ),
    }


def _build_planner_execution_report(
    *,
    edit_plan: Mapping[str, Any],
    stage_status: str,
    delta: Mapping[str, Any],
    edit_result: Mapping[str, Any],
    skill_result: Mapping[str, Any],
    sync_cad_requested: bool,
) -> dict[str, Any]:
    actions = [action for action in edit_plan.get("actions", []) if isinstance(action, Mapping)]
    targets = [target for target in edit_plan.get("targets", []) if isinstance(target, Mapping)]
    unresolved_components = [
        item for item in edit_plan.get("unresolved_components", []) if isinstance(item, Mapping)
    ]
    action_reports = []
    action_briefs = []
    for action_index, action in enumerate(actions):
        action_type = str(action.get("type") or "")
        requested_delta = _vector3(action.get("delta_mm"))
        target_component_id = str(action.get("component_id") or "")
        if action_type == "add_component":
            added_record = _changed_record_for_component(delta.get("added_objects"), target_component_id)
            requested_bbox = _bbox(action.get("bbox"))
            requested_size = [
                round(requested_bbox["max"][index] - requested_bbox["min"][index], 9)
                for index in range(3)
            ]
            actual_size = _vector3((added_record or {}).get("size"))
            checks = [
                {
                    "name": "target_component_added",
                    "ok": added_record is not None,
                    "detail": f"{target_component_id} appears in geometry_delta_summary.added_objects",
                },
                {
                    "name": "added_size_matches_plan",
                    "ok": bool(added_record) and _vectors_close(requested_size, actual_size, tolerance=1e-5),
                    "detail": f"planned size {requested_size}, actual size {actual_size}",
                },
                {
                    "name": "planned_bbox_positive",
                    "ok": min(requested_size) > 0.0,
                    "detail": f"planned bbox is {requested_bbox}",
                },
                {
                    "name": "planner_quality_ok",
                    "ok": bool((action.get("placement_quality") or {}).get("ok")),
                    "detail": f"placement_quality={action.get('placement_quality')}",
                },
            ]
            action_ok = all(check["ok"] for check in checks)
            report = {
                "action_index": action_index,
                "ok": action_ok,
                "planner_plan": {
                    "operation": action_type,
                    "component_id": target_component_id,
                    "semantic_name": action.get("semantic_name"),
                    "bbox": requested_bbox,
                    "reason": action.get("reason"),
                    "selection_policy": action.get("selection_policy"),
                    "placement_quality": action.get("placement_quality"),
                },
                "execution": {
                    "component_id": target_component_id,
                    "semantic_name": action.get("semantic_name"),
                    "component_added": added_record is not None,
                    "registry_delta_mm": [0.0, 0.0, 0.0],
                    "changed": added_record is not None,
                },
                "target_before_after": {
                    "before": None,
                    "after": added_record,
                },
                "checks": checks,
            }
            action_reports.append(report)
            action_briefs.append(
                {
                    "action_index": action_index,
                    "ok": action_ok,
                    "operation": action_type,
                    "component_id": target_component_id,
                    "semantic_name": action.get("semantic_name"),
                    "bbox": requested_bbox,
                    "added": added_record is not None,
                    "placement_quality": action.get("placement_quality"),
                }
            )
            continue

        if action_type == "expand_shell":
            command = _command_for_action(skill_result, action_index=action_index)
            checks = [
                {
                    "name": "expand_shell_command_succeeded",
                    "ok": bool(command) and int(command.get("returncode", 1)) == 0,
                    "detail": f"command={command.get('cmd') if isinstance(command, Mapping) else None}",
                },
                {
                    "name": "expand_shell_has_outer_bbox",
                    "ok": isinstance(action.get("outer_bbox"), Mapping),
                    "detail": f"outer_bbox={action.get('outer_bbox')}",
                },
            ]
            action_ok = all(check["ok"] for check in checks)
            report = {
                "action_index": action_index,
                "ok": action_ok,
                "planner_plan": {
                    "operation": action_type,
                    "outer_bbox": action.get("outer_bbox"),
                    "inner_bbox": action.get("inner_bbox"),
                    "reason": action.get("reason"),
                    "expansion_mm": action.get("expansion_mm"),
                },
                "execution": {
                    "changed": action_ok,
                    "command": command,
                },
                "target_before_after": {
                    "before": None,
                    "after": None,
                },
                "checks": checks,
            }
            action_reports.append(report)
            action_briefs.append(
                {
                    "action_index": action_index,
                    "ok": action_ok,
                    "operation": action_type,
                    "component_id": None,
                    "expansion_mm": action.get("expansion_mm"),
                }
            )
            continue

        if action_type == "expand_shell_then_relayout":
            relayout = skill_result.get("relayout_result_data")
            if not isinstance(relayout, Mapping):
                relayout = skill_result.get("relayout_result")
            if not isinstance(relayout, Mapping):
                relayout_path = Path(str(skill_result.get("relayout_result") or ""))
                relayout = read_json(relayout_path) if relayout_path.exists() else {}
            relayout_payload = relayout.get("relayout_result") if isinstance(relayout.get("relayout_result"), Mapping) else relayout
            relayout_stats = relayout_payload.get("stats") if isinstance(relayout_payload, Mapping) else {}
            after_ids = {
                str(item.get("component_id"))
                for item in delta.get("added_objects", [])
                if isinstance(item, Mapping) and item.get("component_id")
            }
            after_ids.update(
                str(item.get("component_id"))
                for item in delta.get("changed_objects", [])
                if isinstance(item, Mapping) and item.get("component_id")
            )
            after_ids.update(
                str(item.get("component_id"))
                for item in delta.get("unchanged_objects", [])
                if isinstance(item, Mapping) and item.get("component_id")
            )
            target_component_ids = [
                str(item)
                for item in action.get("target_component_ids", [])
                if item
            ]
            if not after_ids:
                after_ids = _component_ids_from_registry_path(
                    _geometry_after_registry_path_from_skill_result(skill_result)
                )
            missing_after_relayout = sorted(set(target_component_ids) - after_ids)
            relayout_ok = bool(relayout.get("relayout_success", relayout_payload.get("ok") if isinstance(relayout_payload, Mapping) else False))
            n_unplaced = int(relayout.get("relayout_n_unplaced", (relayout_stats or {}).get("n_unplaced", -1)) or 0)
            checks = [
                {
                    "name": "relayout_command_succeeded",
                    "ok": relayout_ok,
                    "detail": f"relayout_success={relayout_ok}, n_unplaced={n_unplaced}",
                },
                {
                    "name": "relayout_has_no_unplaced",
                    "ok": n_unplaced == 0,
                    "detail": f"relayout n_unplaced={n_unplaced}",
                },
                {
                    "name": "all_original_missing_placed_after_relayout",
                    "ok": not missing_after_relayout,
                    "detail": f"missing_after_relayout={missing_after_relayout}",
                },
                {
                    "name": "relayout_outer_size_positive",
                    "ok": min(_vector3(action.get("outer_size_mm"))) > 0.0,
                    "detail": f"outer_size_mm={action.get('outer_size_mm')}",
                },
            ]
            action_ok = all(check["ok"] for check in checks)
            report = {
                "action_index": action_index,
                "ok": action_ok,
                "planner_plan": {
                    "operation": action_type,
                    "outer_size_mm": action.get("outer_size_mm"),
                    "outer_bbox": action.get("outer_bbox"),
                    "expansion_mm": action.get("expansion_mm"),
                    "target_component_ids": target_component_ids,
                    "reason": action.get("reason"),
                    "selection_policy": action.get("selection_policy"),
                },
                "execution": {
                    "changed": bool(delta.get("geometry_changed")),
                    "relayout_success": relayout_ok,
                    "relayout_n_unplaced": n_unplaced,
                    "missing_after_relayout": missing_after_relayout,
                    "relayout_run_dir": relayout.get("relayout_run_dir"),
                },
                "target_before_after": {
                    "before": None,
                    "after": None,
                },
                "checks": checks,
            }
            action_reports.append(report)
            action_briefs.append(
                {
                    "action_index": action_index,
                    "ok": action_ok,
                    "operation": action_type,
                    "component_id": None,
                    "outer_size_mm": action.get("outer_size_mm"),
                    "expansion_mm": action.get("expansion_mm"),
                    "relayout_success": relayout_ok,
                    "relayout_n_unplaced": n_unplaced,
                    "missing_after_relayout": missing_after_relayout,
                }
            )
            continue

        moved_record = _changed_record_for_component(delta.get("moved_objects"), target_component_id)
        changed_record = moved_record or _changed_record_for_component(delta.get("changed_objects"), target_component_id)
        registry_delta = _vector3(((changed_record or {}).get("delta") or {}).get("center_mm"))
        command_facts = _extract_safe_move_command_facts(skill_result, action_index=action_index)
        applied_move = _vector3(command_facts.get("applied_move"))
        effective_move = _vector3(command_facts.get("effective_move"))
        requested_blockers = command_facts.get("requested_blockers")
        if not isinstance(requested_blockers, list):
            requested_blockers = []
        checks = [
            {
                "name": "target_component_changed",
                "ok": changed_record is not None,
                "detail": f"{target_component_id} appears in geometry_delta_summary.changed_objects",
            },
            {
                "name": "operation_is_move_only",
                "ok": bool(changed_record) and changed_record.get("change_types") == ["moved"],
                "detail": "target component should move without resize/add/delete",
            },
            {
                "name": "actual_delta_nonzero",
                "ok": _abs_max(registry_delta) > 1e-6,
                "detail": f"registry center delta is {registry_delta}",
            },
            {
                "name": "actual_delta_matches_safe_move",
                "ok": _vectors_close(registry_delta, applied_move, tolerance=1e-5),
                "detail": f"registry delta {registry_delta}, FreeCAD applied_move {applied_move}",
            },
            {
                "name": "safe_move_same_direction_as_request",
                "ok": _same_direction_or_zero(requested_delta, registry_delta),
                "detail": f"requested {requested_delta}, actual {registry_delta}",
            },
        ]
        action_ok = all(check["ok"] for check in checks)
        report = {
            "action_index": action_index,
            "ok": action_ok,
            "planner_plan": {
                "operation": action.get("type"),
                "component_id": target_component_id,
                "semantic_name": action.get("semantic_name"),
                "requested_delta_mm": requested_delta,
                "reason": action.get("reason"),
                "selection_policy": action.get("selection_policy"),
            },
            "freecad_safe_move": {
                "requested_move_mm": _vector3(command_facts.get("requested_move")),
                "effective_move_mm": effective_move,
                "applied_move_mm": applied_move,
                "applied_scale": command_facts.get("applied_scale"),
                "requested_move_is_safe": command_facts.get("requested_move_is_safe"),
                "requested_blockers": requested_blockers,
                "final_blockers": command_facts.get("final_blockers") if isinstance(command_facts.get("final_blockers"), list) else [],
                "normal_move_component_ignored": command_facts.get("normal_move_component_ignored"),
                "solution_found_on_requested_segment": command_facts.get("solution_found_on_requested_segment"),
            },
            "execution": {
                "component_id": target_component_id,
                "semantic_name": action.get("semantic_name"),
                "registry_delta_mm": registry_delta,
                "freecad_applied_move_mm": applied_move,
                "requested_move_is_safe": command_facts.get("requested_move_is_safe"),
                "requested_blockers": requested_blockers,
                "changed": changed_record is not None,
            },
            "target_before_after": {
                "before": (changed_record or {}).get("before"),
                "after": (changed_record or {}).get("after"),
            },
            "checks": checks,
        }
        action_reports.append(report)
        action_briefs.append(
            {
                "action_index": action_index,
                "ok": action_ok,
                "component_id": target_component_id,
                "semantic_name": action.get("semantic_name"),
                "requested_delta_mm": requested_delta,
                "actual_delta_mm": registry_delta,
                "applied_move_mm": applied_move,
                "requested_move_is_safe": command_facts.get("requested_move_is_safe"),
                "requested_blockers": requested_blockers,
            }
        )

    delta_summary = delta.get("summary") or {}
    actual_action_effect_count = (
        int(delta_summary.get("changed_component_count", 0))
        + int(delta_summary.get("added_component_count", 0))
        + int(delta_summary.get("deleted_component_count", 0))
    )
    relayout_action_count = sum(
        1
        for action in actions
        if str(action.get("type") or "") == "expand_shell_then_relayout"
    )
    non_effect_action_count = sum(
        1
        for action in actions
        if str(action.get("type") or "") in {"expand_shell"}
    )
    expected_effect_action_count = (
        actual_action_effect_count
        if relayout_action_count
        else max(0, len(actions) - non_effect_action_count)
    )
    target_ids = {str(target.get("component_id")) for target in targets if target.get("component_id")}
    added_ids = {
        str(item.get("component_id"))
        for item in delta.get("added_objects", [])
        if isinstance(item, Mapping) and item.get("component_id")
    }
    moved_ids = {
        str(item.get("component_id"))
        for item in delta.get("moved_objects", [])
        if isinstance(item, Mapping) and item.get("component_id")
    }
    deleted_ids = {
        str(item.get("component_id"))
        for item in delta.get("deleted_objects", [])
        if isinstance(item, Mapping) and item.get("component_id")
    }
    relayout_ids = set()
    if relayout_action_count:
        relayout_ids = _component_ids_from_registry_path(
            _geometry_after_registry_path_from_skill_result(skill_result)
        )
    covered_missing_ids = target_ids & (added_ids | moved_ids | deleted_ids | relayout_ids)
    unresolved_ids = {
        str(item.get("component_id"))
        for item in unresolved_components
        if item.get("component_id")
    }
    unresolved_missing_ids = target_ids & unresolved_ids
    missing_without_resolution = sorted(target_ids - covered_missing_ids - unresolved_missing_ids)
    bad_executed_actions = [
        report
        for report in action_reports
        if not report.get("ok") or not (((report.get("planner_plan") or {}).get("placement_quality") or {}).get("ok", True))
    ]
    global_checks = [
        {
            "name": "stage_completed",
            "ok": stage_status == "completed",
            "detail": f"geometry_edit stage status is {stage_status}",
        },
        {
            "name": "no_unplanned_component_changes",
            "ok": actual_action_effect_count == expected_effect_action_count,
            "detail": (
                f"changed={delta_summary.get('changed_component_count')}, "
                f"added={delta_summary.get('added_component_count')}, "
                f"deleted={delta_summary.get('deleted_component_count')}, "
                f"expected_effect_actions={expected_effect_action_count}"
            ),
        },
        {
            "name": "all_targets_resolved_or_unresolved",
            "ok": not missing_without_resolution,
            "detail": f"missing_without_resolution={missing_without_resolution}",
        },
        {
            "name": "no_bad_executed_actions",
            "ok": not bad_executed_actions,
            "detail": f"bad_executed_action_count={len(bad_executed_actions)}",
        },
    ]
    if sync_cad_requested:
        global_checks.append(
            {
                "name": "cad_synced",
                "ok": bool(edit_result.get("cad_synced")),
                "detail": "sync_cad was requested, so geometry_after.step should be exported by FreeCAD",
            }
        )

    ok = all(check["ok"] for check in global_checks) and all(report["ok"] for report in action_reports)
    if ok and unresolved_components and actions:
        status = "partially_implemented_with_unresolved"
    elif ok and unresolved_components:
        status = "planned_unresolved"
    elif ok and actions:
        status = "implemented"
    elif ok:
        status = "no_op"
    elif any(report["execution"].get("changed") for report in action_reports):
        status = "partially_implemented"
    else:
        status = "not_implemented"

    return {
        "schema_version": "1.0",
        "summary": {
            "ok": ok,
            "status": status,
            "planner": edit_plan.get("planner"),
            "planner_mode": edit_plan.get("planner_mode"),
            "action_count": len(actions),
            "target_count": len(targets),
            "covered_missing_count": len(covered_missing_ids),
            "unresolved_missing_count": len(unresolved_missing_ids),
            "missing_without_resolution_count": len(missing_without_resolution),
            "bad_executed_actions": len(bad_executed_actions),
        },
        "targets": targets,
        "unresolved_components": unresolved_components,
        "actions_brief": action_briefs,
        "action_reports": action_reports,
        "execution": {
            "stage_status": stage_status,
            "geometry_changed": bool(delta.get("geometry_changed")),
            "step_file_changed": bool(delta.get("step_file_changed")),
            "cad_synced": bool(edit_result.get("cad_synced")),
            "changed_component_count": int((delta.get("summary") or {}).get("changed_component_count", 0)),
            "moved_component_count": int((delta.get("summary") or {}).get("moved_component_count", 0)),
            "added_component_count": int((delta.get("summary") or {}).get("added_component_count", 0)),
            "deleted_component_count": int((delta.get("summary") or {}).get("deleted_component_count", 0)),
        },
        "checks": global_checks,
        "artifacts": {
            "edit_plan": "edit_plan.json",
            "freecad_skill_cli_result": "freecad_skill_cli_result.json",
            "geometry_delta_summary": "geometry_delta_summary.json",
            "geometry_after_registry": "geometry_after_registry.json",
            "geometry_after_geom": "geometry_after.geom.json",
            "geometry_after_layout_topology": "geometry_after.layout_topology.json",
        },
    }


def _geometry_after_registry_path_from_skill_result(skill_result: Mapping[str, Any]) -> str | None:
    outputs = skill_result.get("outputs")
    if isinstance(outputs, Mapping):
        value = outputs.get("geometry_after_registry") or outputs.get("output_geometry_registry")
        if value:
            return str(value)
    value = skill_result.get("output_geometry_registry") or skill_result.get("geometry_after_registry")
    return str(value) if value else None


def _component_ids_from_registry_path(path_value: Any) -> set[str]:
    if not path_value:
        return set()
    path = Path(str(path_value))
    if not path.is_absolute() or not path.exists():
        return set()
    try:
        data = read_json(path)
    except Exception:
        return set()
    return {
        str(entity.get("component_id"))
        for entity in data.get("entities", [])
        if isinstance(entity, Mapping) and entity.get("component_id")
    }


def _extract_safe_move_command_facts(skill_result: Mapping[str, Any], *, action_index: int = 0) -> dict[str, Any]:
    command = _command_for_action(skill_result, action_index=action_index)
    if not command:
        return {}
    stdout = command.get("stdout")
    if not isinstance(stdout, str):
        return {}
    facts: dict[str, Any] = {}
    for line in stdout.splitlines():
        if ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        key = key.strip()
        value = raw_value.strip()
        if key in {
            "requested_move",
            "effective_move",
            "applied_move",
            "original_position",
            "final_position",
            "requested_blockers",
            "final_blockers",
        }:
            facts[key] = _parse_cli_literal(value)
        elif key in {
            "requested_move_is_safe",
            "normal_move_component_ignored",
            "solution_found_on_requested_segment",
            "cad_sync_enabled",
        }:
            facts[key] = value.lower() == "true"
        elif key in {"applied_scale", "layout_completion_percent", "modeling_percent", "export_file_percent"}:
            try:
                facts[key] = float(value)
            except ValueError:
                facts[key] = value
        elif key in {"target_component", "target_envelope_face_label", "original_envelope_face_label"}:
            facts[key] = value
    return facts


def _command_for_action(skill_result: Mapping[str, Any], *, action_index: int) -> Mapping[str, Any]:
    commands = skill_result.get("commands")
    if not isinstance(commands, list) or not commands or action_index >= len(commands):
        return {}
    command = commands[action_index]
    return command if isinstance(command, Mapping) else {}


def _parse_cli_literal(value: str) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        pass
    try:
        import ast

        return ast.literal_eval(value)
    except (ValueError, SyntaxError):
        return value


def _changed_record_for_component(records: Any, component_id: str) -> Mapping[str, Any] | None:
    if not isinstance(records, list):
        return None
    for record in records:
        if isinstance(record, Mapping) and record.get("component_id") == component_id:
            return record
    return None


def _vectors_close(left: list[float], right: list[float], *, tolerance: float) -> bool:
    return all(abs(left[index] - right[index]) <= tolerance for index in range(3))


def _same_direction_or_zero(requested: list[float], actual: list[float]) -> bool:
    for index in range(3):
        if abs(requested[index]) <= 1e-9:
            if abs(actual[index]) > 1e-6:
                return False
            continue
        if requested[index] * actual[index] <= 0.0:
            return False
    return True


def _abs_max(values: list[float]) -> float:
    return max((abs(value) for value in values), default=0.0)


def _placement_normal_axes(topology: Mapping[str, Any]) -> dict[str, int]:
    axes: dict[str, int] = {}
    for placement in topology.get("placements", []):
        if not isinstance(placement, Mapping):
            continue
        component_id = str(placement.get("component_id") or "").strip()
        mount_face_id = str(placement.get("mount_face_id") or "")
        axis = _axis_from_face_id(mount_face_id)
        if component_id and axis is not None:
            axes[component_id] = axis
    return axes


def _axis_from_face_id(face_id: str) -> int | None:
    lowered = face_id.lower()
    for token, axis in (("xmin", 0), ("xmax", 0), (".x", 0), ("ymin", 1), ("ymax", 1), (".y", 1), ("zmin", 2), ("zmax", 2), (".z", 2)):
        if token in lowered:
            return axis
    return None


def _inner_bbox_from_geom(geom: Mapping[str, Any]) -> dict[str, list[float]]:
    outer_shell = geom.get("outer_shell") if isinstance(geom.get("outer_shell"), Mapping) else {}
    inner = outer_shell.get("inner_bbox") if isinstance(outer_shell.get("inner_bbox"), Mapping) else None
    if inner is not None:
        return _bbox(inner)

    components = geom.get("components", {})
    rows = components.values() if isinstance(components, Mapping) else components
    mins = [float("inf"), float("inf"), float("inf")]
    maxs = [float("-inf"), float("-inf"), float("-inf")]
    for component in rows or []:
        if not isinstance(component, Mapping):
            continue
        bbox = _bbox(component.get("bbox"))
        for axis in range(3):
            mins[axis] = min(mins[axis], bbox["min"][axis])
            maxs[axis] = max(maxs[axis], bbox["max"][axis])
    if any(value == float("inf") for value in mins) or any(value == float("-inf") for value in maxs):
        return {"min": [-1e9, -1e9, -1e9], "max": [1e9, 1e9, 1e9]}
    margin = 10.0
    return {
        "min": [value - margin for value in mins],
        "max": [value + margin for value in maxs],
    }


def _bbox(value: Any) -> dict[str, list[float]]:
    if not isinstance(value, Mapping):
        return {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}
    return {
        "min": _vector3(value.get("min")),
        "max": _vector3(value.get("max")),
    }


def _vector3(value: Any) -> list[float]:
    if not isinstance(value, list) or len(value) != 3:
        return [0.0, 0.0, 0.0]
    return [float(item) for item in value]


if __name__ == "__main__":
    raise SystemExit(main())
