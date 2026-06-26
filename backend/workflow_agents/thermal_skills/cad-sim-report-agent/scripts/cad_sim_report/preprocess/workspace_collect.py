from __future__ import annotations

from pathlib import Path
from typing import Any

from ..common import load_json, stat_file
from .workspace_summary import (
    summarize_cad_validation,
    summarize_components,
    summarize_field_samples,
    summarize_manifest,
    summarize_status,
)
from .xlsx_tables import build_thermal_control_table, read_xlsx_table


def first_existing(candidates: list[Path]) -> Path | None:
    for path in candidates:
        if path.exists():
            return path
    return None


def status_candidates(workspace: Path) -> list[Path]:
    sim_dir = workspace / "02_sim" / "simulation"
    return [
        sim_dir / "status.json",
        sim_dir / "_comsol_work" / "sim" / "status.json",
        sim_dir / "_comsol_work" / "status.json",
    ]


def simulation_artifact(workspace: Path, filename: str) -> Path:
    sim_dir = workspace / "02_sim" / "simulation"
    return first_existing([
        sim_dir / filename,
        sim_dir / "_comsol_work" / "sim" / filename,
        sim_dir / "_comsol_work" / filename,
    ]) or sim_dir / filename


def workspace_paths(workspace: Path) -> dict[str, Path]:
    sim_root = workspace / "02_sim"
    return {
        "inputs_dir": workspace / "00_inputs",
        "cad_dir": workspace / "01_cad",
        "sim_root": sim_root,
        "sim_dir": sim_root / "simulation",
        "post_dir": sim_root / "postprocess",
        "analysis_dir": sim_root / "analysis",
        "case_dir": sim_root / "case_build",
    }


def load_workspace_jsons(paths: dict[str, Path], status_path: Path | None) -> dict[str, Any]:
    cad_dir = paths["cad_dir"]
    sim_root = paths["sim_root"]
    sim_dir = paths["sim_dir"]
    post_dir = paths["post_dir"]
    analysis_dir = paths["analysis_dir"]
    case_dir = paths["case_dir"]
    return {
        "cad_validation_report": load_json(first_existing([
            cad_dir / "cad_validation_report.json",
            cad_dir / "cad_validate_report.json",
            cad_dir / "cad_validate_report_preprocessed.json",
        ])),
        "simulation_input": load_json(cad_dir / "simulation_input.json"),
        "registry": load_json(cad_dir / "geometry_after_registry.json"),
        "run_manifest": load_json(sim_root / "run_manifest.json"),
        "status": load_json(status_path),
        "simulation_manifest": load_json(sim_dir / "simulation_manifest.json"),
        "field_stats": load_json(post_dir / "field_stats.json"),
        "render_summary": load_json(post_dir / "render_summary.json"),
        "paraview_summary": load_json(post_dir / "summary.json"),
        "metrics_summary": load_json(analysis_dir / "metrics_summary.json"),
        "diagnosis": load_json(analysis_dir / "diagnosis.json"),
        "root_cause_report": load_json(analysis_dir / "root_cause_report.json"),
        "field_samples": load_json(sim_dir / "field_samples.json"),
        "case_validation": load_json(case_dir / "case_validation.json"),
    }


def collect_artifacts(workspace: Path, paths: dict[str, Path]) -> dict[str, Any]:
    cad_dir = paths["cad_dir"]
    case_dir = paths["case_dir"]
    return {
        "step": stat_file(cad_dir / "geometry_after.step"),
        "glb": stat_file(cad_dir / "geometry_after.glb"),
        "coord": stat_file(cad_dir / "comsol_inputs" / "coord.txt"),
        "channels": stat_file(cad_dir / "comsol_inputs" / "channels_input.npz"),
        "work_mph": stat_file(simulation_artifact(workspace, "work.mph")),
        "native_vtu": stat_file(simulation_artifact(workspace, "native.vtu")),
        "data1_txt": stat_file(simulation_artifact(workspace, "data1.txt")),
        "case_field_vtu": stat_file(case_dir / "field.vtu"),
    }


def collect_workspace(workspace: Path) -> dict[str, Any]:
    paths = workspace_paths(workspace)
    cad_dir = paths["cad_dir"]
    post_dir = paths["post_dir"]
    status_path = first_existing(status_candidates(workspace))
    screenshots = sorted(cad_dir.glob("freecad_screenshot_*.png"))
    post_images = sorted(post_dir.glob("*.png"))
    catch_support_table = read_xlsx_table(paths["inputs_dir"] / "CATCH整星配套表.xlsx")
    data = {
        "workspace": str(workspace),
        "paths": {
            "inputs_dir": str(paths["inputs_dir"]),
            "cad_dir": str(paths["cad_dir"]),
            "sim_dir": str(paths["sim_dir"]),
            "postprocess_dir": str(paths["post_dir"]),
            "analysis_dir": str(paths["analysis_dir"]),
            "case_dir": str(paths["case_dir"]),
            "status_path": str(status_path) if status_path else None,
        },
        "catch_support_table": catch_support_table,
        "thermal_control_table": build_thermal_control_table(catch_support_table),
        "artifacts": collect_artifacts(workspace, paths),
        "screenshots": [stat_file(path) for path in screenshots],
        "postprocess_images": [stat_file(path) for path in post_images],
    }
    data.update(load_workspace_jsons(paths, status_path))
    data["components"] = summarize_components(data["simulation_input"], data["registry"])
    data["manifest_summary"] = summarize_manifest(data["run_manifest"])
    data["status_summary"] = summarize_status(data["status"])
    data["cad_validation"] = summarize_cad_validation(data["cad_validation_report"], data["artifacts"])
    data["field_sample_summary"] = summarize_field_samples(data["field_samples"])
    return data
