from __future__ import annotations

from pathlib import Path
from typing import Any

from ..common import count_existing, get_nested, safe_float
from .workspace_collect import first_existing, status_candidates


def cad_validation_path(workspace: Path) -> Path:
    cad_dir = workspace / "01_cad"
    return first_existing([
        cad_dir / "cad_validation_report.json",
        cad_dir / "cad_validate_report.json",
        cad_dir / "cad_validate_report_preprocessed.json",
    ]) or cad_dir / "cad_validation_report.json"


def top_components(components: list[dict[str, Any]], limit: int = 12) -> list[dict[str, Any]]:
    rows = [
        {
            "component_id": item.get("component_id"),
            "semantic_name": item.get("semantic_name"),
            "kind": item.get("kind"),
            "category": item.get("category"),
            "material_id": item.get("material_id"),
            "power_W": safe_float(item.get("power_W")),
            "mass_kg": safe_float(item.get("mass_kg")),
            "is_heat_source": bool(item.get("is_heat_source") or safe_float(item.get("power_W")) != 0),
        }
        for item in components
    ]
    return sorted(rows, key=lambda row: row["power_W"], reverse=True)[:limit]


def component_counts(components: list[dict[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in components:
        name = str(item.get(key, "unknown"))
        counts[name] = counts.get(name, 0) + 1
    return dict(sorted(counts.items()))


def build_cad_core(workspace: Path, data: dict[str, Any]) -> dict[str, Any]:
    cad_dir = workspace / "01_cad"
    simulation_input = data["simulation_input"] if isinstance(data["simulation_input"], dict) else {}
    registry = data["registry"] if isinstance(data["registry"], dict) else {}
    validation = data["cad_validation_report"] if isinstance(data["cad_validation_report"], dict) else {}
    components = simulation_input.get("components", []) if isinstance(simulation_input, dict) else []
    entities = registry.get("entities", []) if isinstance(registry, dict) else []
    cad_validation = data["cad_validation"]
    return {
        "schema_version": "cad_core_preprocessed/1.0",
        "source_files": {
            "simulation_input": str(cad_dir / "simulation_input.json"),
            "geometry_registry": str(cad_dir / "geometry_after_registry.json"),
            "cad_validation": str(cad_validation_path(workspace)),
        },
        "model": {
            "simulation_input_id": simulation_input.get("simulation_input_id"),
            "step_file": simulation_input.get("step_file"),
            "units": simulation_input.get("units", {}),
            "component_count": len(components),
            "registry_entity_count": len(entities),
            "install_face_count": len(simulation_input.get("install_faces", [])),
            "shell_count": len(simulation_input.get("shells", [])),
            "cabin_count": len(simulation_input.get("cabins", [])),
            "radiator_count": len(simulation_input.get("radiators", [])),
        },
        "component_summary": {
            "by_kind": component_counts(components, "kind"),
            "by_category": component_counts(components, "category"),
            "by_material": component_counts(components, "material_id"),
            "total_power_W": data["components"]["total_power_W"],
            "total_mass_kg": data["components"]["total_mass_kg"],
            "top_power_components": top_components(components),
        },
        "geometry_summary": {
            "coordinate_system": registry.get("coordinate_system"),
            "bbox_union": data["components"]["bbox_union"],
            "entity_count": len(entities),
            "wall_count": len(registry.get("walls", [])) if isinstance(registry, dict) else 0,
            "face_count": len(registry.get("faces", [])) if isinstance(registry, dict) else 0,
            "suspicious_geometry": data["components"]["suspicious"],
        },
        "validation": {
            "status": cad_validation.get("status"),
            "component_count": cad_validation.get("component_count"),
            "bbox_failure_count": cad_validation.get("bbox_failure_count"),
            "bbox_overlap_count": cad_validation.get("bbox_overlap_count"),
            "contact_failure_count": cad_validation.get("contact_failure_count"),
            "face_occupancy_ok": cad_validation.get("face_occupancy_ok"),
            "face_occupancy_max": cad_validation.get("face_occupancy_max"),
            "over_capacity_face_count": cad_validation.get("over_capacity_face_count"),
            "overlaps": cad_validation.get("overlaps", [])[:20],
            "contact_failures": cad_validation.get("contact_failures", [])[:20],
            "raw_status": validation.get("status"),
        },
        "artifacts": {
            "step": data["artifacts"]["step"],
            "glb": data["artifacts"]["glb"],
            "coord": data["artifacts"]["coord"],
            "channels": data["artifacts"]["channels"],
            "screenshot_count": count_existing(data["screenshots"]),
        },
        "catch_support_table": data.get("catch_support_table", {}),
    }


def build_sim_core(workspace: Path, data: dict[str, Any]) -> dict[str, Any]:
    sim_root = workspace / "02_sim"
    status_path = first_existing(status_candidates(workspace))
    status = data["status"] if isinstance(data["status"], dict) else {}
    status_summary = data["status_summary"]
    manifest = data["manifest_summary"]
    sim_manifest = data["simulation_manifest"] if isinstance(data["simulation_manifest"], dict) else {}
    field_stats = data["field_stats"] if isinstance(data["field_stats"], dict) else {}
    render_summary = data["render_summary"] if isinstance(data["render_summary"], dict) else {}
    paraview_summary = data["paraview_summary"] if isinstance(data["paraview_summary"], dict) else {}
    metrics = data["metrics_summary"] if isinstance(data["metrics_summary"], dict) else {}
    diagnosis = data["diagnosis"] if isinstance(data["diagnosis"], dict) else {}
    root_cause = data["root_cause_report"] if isinstance(data["root_cause_report"], dict) else {}
    case_validation = data["case_validation"] if isinstance(data["case_validation"], dict) else {}
    field_sample_summary = data["field_sample_summary"]
    return {
        "schema_version": "sim_core_preprocessed/1.0",
        "source_files": {
            "run_manifest": str(sim_root / "run_manifest.json"),
            "status": str(status_path) if status_path else None,
            "simulation_manifest": str(sim_root / "simulation" / "simulation_manifest.json"),
            "field_stats": str(sim_root / "postprocess" / "field_stats.json"),
            "paraview_summary": str(sim_root / "postprocess" / "summary.json"),
            "render_summary": str(sim_root / "postprocess" / "render_summary.json"),
            "metrics_summary": str(sim_root / "analysis" / "metrics_summary.json"),
            "diagnosis": str(sim_root / "analysis" / "diagnosis.json"),
            "root_cause_report": str(sim_root / "analysis" / "root_cause_report.json"),
            "case_validation": str(sim_root / "case_build" / "case_validation.json"),
        },
        "pipeline": {
            "ok": manifest.get("ok"),
            "stage_count": manifest.get("stage_count"),
            "completed": manifest.get("completed", []),
            "failed": manifest.get("failed", []),
            "errors": manifest.get("errors", []),
        },
        "solver": {
            "ok": status_summary.get("ok"),
            "stage": status_summary.get("stage"),
            "progress_percent": status_summary.get("progress_percent"),
            "error": status_summary.get("error"),
            "simulation_id": sim_manifest.get("simulation_id"),
            "backend": get_nested(sim_manifest, ["external_tools", "backend"]),
            "mesh": get_nested(sim_manifest, ["external_tools", "mesh"]),
            "mesh_type": get_nested(status, ["checks", "mesh_switch", "mesh_type"]),
            "mesh_hauto": get_nested(status, ["checks", "mesh_switch", "hauto"]),
        },
        "physics_checks": {
            "selection_ok": status_summary.get("selection_ok"),
            "selection_message": status_summary.get("selection_message"),
            "selection_expected_count": status_summary.get("selection_expected_count"),
            "selection_existing_count": status_summary.get("selection_existing_count"),
            "selection_empty_tags": status_summary.get("selection_empty_tags", []),
            "selection_min_entities": status_summary.get("selection_min_entities"),
            "selection_max_entities": status_summary.get("selection_max_entities"),
            "heat_sources_ok": status_summary.get("heat_sources_ok"),
            "heat_sources_message": status_summary.get("heat_sources_message"),
            "heat_sources_expected_count": status_summary.get("heat_sources_expected_count"),
            "heat_sources_existing_count": status_summary.get("heat_sources_existing_count"),
            "radiators_applied": get_nested(status, ["checks", "radiators", "applied"]),
            "radiators_skipped": get_nested(status, ["checks", "radiators", "skipped"]),
            "shell_radiation_applied": get_nested(status, ["checks", "shell_radiation", "applied"]),
            "shell_radiation_skipped": get_nested(status, ["checks", "shell_radiation", "skipped"]),
            "contact_resistance_applied": get_nested(status, ["checks", "contact_resistance", "applied"]),
            "contact_resistance_skipped": get_nested(status, ["checks", "contact_resistance", "skipped"]),
            "initial_temperature_K": get_nested(status, ["checks", "initial_temperature", "initial_temp_K"]),
        },
        "thermal_results": {
            "field_stats": field_stats,
            "paraview_temperature": paraview_summary.get("temperature") if isinstance(paraview_summary, dict) else {},
            "paraview_bounds": paraview_summary.get("bounds") if isinstance(paraview_summary, dict) else {},
            "render_ok": render_summary.get("ok"),
            "render_backend": render_summary.get("backend"),
            "temperature_range_K": render_summary.get("temperature_range_K"),
            "postprocess_image_count": count_existing(data["postprocess_images"]),
            "field_sample_summary": field_sample_summary,
            "thermal_control_table": data.get("thermal_control_table", {}),
        },
        "analysis": {
            "metrics": metrics,
            "diagnosis": {
                "diagnosis_id": diagnosis.get("diagnosis_id"),
                "root_causes": diagnosis.get("root_causes", []),
            },
            "root_cause_report": root_cause,
            "case_validation": case_validation,
        },
        "artifacts": {
            "work_mph": data["artifacts"]["work_mph"],
            "native_vtu": data["artifacts"]["native_vtu"],
            "data1_txt": data["artifacts"]["data1_txt"],
            "case_field_vtu": data["artifacts"]["case_field_vtu"],
        },
    }
