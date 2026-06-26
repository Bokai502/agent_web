from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import count_existing, get_nested


def build_output_paths(out_dir: Path, summary_path: Path) -> dict[str, Path]:
    return {
        "report": out_dir / "report.docx",
        "modifications": out_dir / "modifications.docx",
        "cad_core": out_dir / "cad_core.json",
        "sim_core": out_dir / "sim_core.json",
        "llm_analysis": out_dir / "llm_analysis.json",
        "summary_json": summary_path,
    }


def stringify_outputs(outputs: dict[str, Path]) -> dict[str, str]:
    return {key: str(path) for key, path in outputs.items()}


def build_summary(data: dict[str, Any], outputs: dict[str, Path]) -> dict[str, Any]:
    return {
        "schema_version": "cad_sim_report_summary/1.0",
        "workspace": data["workspace"],
        "outputs": stringify_outputs(outputs),
        "status": {
            "pipeline_ok": data["manifest_summary"]["ok"],
            "simulation_ok": data["status_summary"]["ok"],
            "simulation_stage": data["status_summary"]["stage"],
            "selection_ok": data["status_summary"]["selection_ok"],
            "empty_selection_count": len(data["status_summary"]["selection_empty_tags"]),
            "heat_sources_ok": data["status_summary"]["heat_sources_ok"],
        },
        "cad": {
            "status": data["cad_validation"]["status"],
            "simulation_components": data["components"]["simulation_components"],
            "registry_entities": data["components"]["registry_entities"],
            "bbox_overlap_count": data["cad_validation"]["bbox_overlap_count"],
            "contact_failure_count": data["cad_validation"]["contact_failure_count"],
            "screenshots": count_existing(data["screenshots"]),
        },
        "thermal": {
            "heat_sources": data["components"]["heat_source_count"],
            "total_power_W": data["components"]["total_power_W"],
            "field_min_K": get_nested(data["field_stats"], ["min_K"]),
            "field_max_K": get_nested(data["field_stats"], ["max_K"]),
            "field_mean_K": get_nested(data["field_stats"], ["mean_K"]),
            "postprocess_images": count_existing(data["postprocess_images"]),
            "field_sample_count": data["field_sample_summary"]["sample_count"],
            "field_sample_component_count": data["field_sample_summary"]["component_count"],
        },
        "recommendation_counts": {},
    }
