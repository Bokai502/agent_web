from __future__ import annotations

from pathlib import Path
from typing import Any

from codex_agents.local_io import write_json


def select_geometry_step(layout_dir: Path, geometry_edit_dir: Path) -> Path:
    after_step = geometry_edit_dir / "geometry_after_power_filtered.step"
    if _has_complete_after_state(geometry_edit_dir, after_step):
        return after_step

    after_step = geometry_edit_dir / "geometry_after.step"
    if not _has_complete_after_state(geometry_edit_dir, after_step):
        raise RuntimeError(
            "simulation requires complete 01_cad after-state artifacts, including "
            "geometry_after_power_filtered.step or geometry_after.step"
        )
    return after_step


def _has_complete_after_state(geometry_edit_dir: Path, after_step: Path) -> bool:
    if not after_step.exists():
        return False
    required = [
        geometry_edit_dir / "geometry_after.geom.json",
        geometry_edit_dir / "geometry_after.layout_topology.json",
        geometry_edit_dir / "geometry_after_registry.json",
        geometry_edit_dir / "simulation_input.json",
        geometry_edit_dir / "comsol_inputs" / "coord.txt",
        geometry_edit_dir / "comsol_inputs" / "channels_input.npz",
    ]
    return all(path.exists() for path in required)


def layout_stage_result(layout_result: dict[str, Any]) -> dict[str, Any]:
    status = "completed" if layout_result.get("ok") else "completed_with_unplaced"
    inputs = {}
    if layout_result.get("cad_build_spec"):
        inputs["cad_build_spec"] = layout_result.get("cad_build_spec")
    elif layout_result.get("bom"):
        inputs["bom"] = layout_result.get("bom")
    return {
        "stage_name": "layout_generate",
        "status": status,
        "inputs": inputs,
        "outputs": {
            "run_dir": layout_result.get("run_dir"),
            "layout_dir": layout_result.get("layout_dir"),
            "component_info_dir": layout_result.get("component_info_dir"),
        },
        "checks": {"n_unplaced": (layout_result.get("stats") or {}).get("n_unplaced")},
        "warnings": [] if layout_result.get("ok") else [layout_result.get("error")],
        "errors": [],
    }


def case_stage(stage_name: str, case_result: dict[str, Any]) -> dict[str, Any]:
    return {
        "stage_name": stage_name,
        "status": "completed" if case_result.get("ok") else "failed",
        "inputs": {"run_dir": case_result.get("run_dir")},
        "outputs": {"geometry_edit_dir": case_result.get("geometry_edit_dir")},
        "checks": {
            "planner_execution_ok": case_result.get("planner_execution_ok"),
            "covered_missing_count": case_result.get("covered_missing_count"),
            "unresolved_missing_count": case_result.get("unresolved_missing_count"),
            "relayout_success": case_result.get("relayout_success"),
            "relayout_n_unplaced": case_result.get("relayout_n_unplaced"),
            "cad_rebuilt": case_result.get("cad_rebuilt"),
            "step_copied_from_source": case_result.get("step_copied_from_source"),
        },
        "warnings": case_result.get("warnings", []),
        "errors": case_result.get("errors", []) if not case_result.get("error") else [case_result.get("error")],
    }


def write_manifest(paths: dict[str, Path], stages: list[dict[str, Any]]) -> dict[str, Any]:
    manifest = {
        "schema_version": "1.0",
        "ok": bool(stages) and all(stage.get("status") in {"completed", "completed_with_unplaced"} for stage in stages),
        "run_root": str(paths["run_root"]),
        "stage_dirs": {
            "components": "components.json",
            "sample": "sample.yaml",
            "simulation": "simulation",
            "postprocess": "postprocess",
            "case_build": "case_build",
            "analysis": "analysis",
            "logs": str(paths["logs"]),
        },
        "stages": stages,
    }
    write_json(paths["run_root"] / "run_manifest.json", manifest)
    return manifest
