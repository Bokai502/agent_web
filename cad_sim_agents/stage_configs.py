from __future__ import annotations

from pathlib import Path
from typing import Any

from codex_agents.config import BomExternalToolsPipelineConfig


def layout_call_kwargs(
    config: BomExternalToolsPipelineConfig,
    run_root: Path,
    bom_json: Path | None = None,
) -> dict[str, Any]:
    return {
        "bom_path": bom_json or config.bom_json,
        "run_dir": run_root,
        "layout3dcube_root": config.layout3dcube_root,
        "dist_yaml": config.dist_yaml,
        "sample_id": config.sample_id,
        "seed": config.seed,
        "clearance_mm": config.clearance_mm,
        "multistart": config.multistart,
        "target_fill_ratio": config.target_fill_ratio,
        "thermal_db": config.thermal_db,
    }


def geometry_edit_call_kwargs(
    config: BomExternalToolsPipelineConfig,
    paths: dict[str, Path],
    layout_result: dict[str, Any],
    bom_json: Path | None = None,
) -> dict[str, Any]:
    return {
        "run_dir": paths["run_root"],
        "layout_result": layout_result,
        "case_index": 0,
        "move_mm": 3.0,
        "max_actions_per_case": config.max_actions_per_case,
        "output_dir_name": config.geometry_edit_dir_name,
        "sync_cad": False,
        "rebuild_cad_after_edit": config.rebuild_cad_after_edit,
        "workspace_dir": paths["run_root"],
        "doc_name": "LayoutAssembly",
        "timeout_seconds": 600,
        "source_bom_path": bom_json or config.bom_json,
        "layout3dcube_root": config.layout3dcube_root,
        "dist_yaml": config.dist_yaml,
        "thermal_db": config.thermal_db,
        "sample_id": config.sample_id,
        "seed": config.seed,
        "clearance_mm": config.clearance_mm,
        "multistart": config.multistart,
        "target_fill_ratio": config.target_fill_ratio,
        "skip_geometry_edit_without_unplaced": True,
    }


def simulation_stage_config(
    config: BomExternalToolsPipelineConfig,
    paths: dict[str, Path],
    geometry_step_path: Path,
) -> dict[str, Any]:
    simulation_input_path = paths["layout"] / "simulation_input.json"
    if geometry_step_path.name == "geometry_after.step":
        simulation_input_path = geometry_step_path.parent / "simulation_input.json"

    stage_config: dict[str, Any] = {
        "execution_backend": config.simulation_backend,
        "layout_dir": paths["layout"],
        "simulation_input_path": simulation_input_path,
        "geometry_step_path": geometry_step_path,
        "pipeline_progress_path": paths["run_root"] / "logs" / "progress_percentages.json",
    }
    if config.simulation_backend == "comsol_local":
        stage_config.update(
            {
                "thermal_sim_config": str(config.thermal_sim_config.resolve()),
                "comsol_connection_config": str(config.comsol_connection_config.resolve()),
                "comsol_runtime_root": str(config.comsol_runtime_root.resolve()),
                "connect_existing_mphserver": config.connect_existing_mphserver,
            }
        )
    return stage_config


def postprocess_stage_config(config: BomExternalToolsPipelineConfig, paths: dict[str, Path]) -> dict[str, Any]:
    if config.simulation_backend != "comsol_local":
        return {}
    return {
        "render_backend": "paraview",
        "render_script": str(config.paraview_render.resolve()),
        "native_vtu": paths["simulation"] / "native.vtu",
        "array_name": "T",
        "use_xvfb": True,
    }
